import 'server-only';

import { createHmac, randomBytes, randomUUID } from 'node:crypto';

import { db, sql, type VercelPoolClient } from '@/app/lib/db';
import { getAuthenticationHmacSecret } from './secrets';
import { enqueueSecurityNotificationWithinTransaction } from './security-notification-outbox';
import { RECENT_MFA_WINDOW_SECONDS } from './session-policy';

const RECOVERY_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const RECOVERY_CODE_PATTERN = /^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{24}$/;
const RECOVERY_GRANT_TTL_SECONDS = 10 * 60;

export const PRIVILEGED_RECOVERY_CODE_COUNT = 10;
export const PRIVILEGED_RECOVERY_LIMITS = {
  ipFailures: 20,
  sessionFailures: 5,
  userFailures: 5,
  windowMinutes: 15,
} as const;

type DatabaseClient = VercelPoolClient;
type RecoveryCodeSetMode = 'initial' | 'regenerate';

export type RecoveryCodeSummary = {
  createdAt: string;
  remainingCodes: number;
  totalCodes: number;
};

export type RecoveryCodeSetResult =
  | ({
      status: 'issued';
      codes: string[];
      setId: string;
      notification: {
        changeId: string;
        occurredAt: string;
        reason: RecoveryCodeSetMode;
        setId: string;
      };
    } & RecoveryCodeSummary)
  | { status: 'already_exists' | 'step_up_required' | 'unavailable' };

export type RecoveryGrantSummary = {
  expiresAt: string;
  grantId: string;
};

export type RecoveryCodeUseResult =
  | {
      status: 'used';
      grant: RecoveryGrantSummary;
      notification: {
        changeId: string;
        occurredAt: string;
        remainingCodes: number;
      };
      remainingCodes: number;
    }
  | { status: 'invalid' | 'limited' | 'unavailable' };

export type RecoveryCompletion = {
  codes: string[];
  createdAt: string;
  notification: {
    changeId: string;
    occurredAt: string;
    recoveryGrantId: string;
    setId: string;
  };
  remainingCodes: number;
  setId: string;
  totalCodes: number;
};

function encodeRecoveryCode(bytes: Buffer) {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of Array.from(bytes)) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += RECOVERY_CODE_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }

    value &= bits === 0 ? 0 : (1 << bits) - 1;
  }

  if (bits > 0) {
    output += RECOVERY_CODE_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

export function generateRecoveryCode() {
  const encoded = encodeRecoveryCode(randomBytes(15));
  const groups = encoded.match(/.{4}/g);

  if (!groups || groups.length !== 6) {
    throw new Error('Recovery-code generation failed.');
  }

  return `FA-${groups.join('-')}`;
}

export function normalizeRecoveryCode(value: string) {
  const compact = value
    .trim()
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  const withoutPrefix = compact.startsWith('FA') ? compact.slice(2) : compact;

  return RECOVERY_CODE_PATTERN.test(withoutPrefix) ? withoutPrefix : null;
}

export function hashRecoveryCode(userId: string, normalizedCode: string) {
  return createHmac('sha256', getAuthenticationHmacSecret())
    .update(`privileged-recovery-code:v1:${userId}:${normalizedCode}`)
    .digest('hex');
}

export function isPrivilegedRecoveryAttemptAllowed(
  sessionFailures: number,
  userFailures: number,
  ipFailures: number,
) {
  return (
    sessionFailures < PRIVILEGED_RECOVERY_LIMITS.sessionFailures &&
    userFailures < PRIVILEGED_RECOVERY_LIMITS.userFailures &&
    ipFailures < PRIVILEGED_RECOVERY_LIMITS.ipFailures
  );
}

function createRecoveryCodeMaterial(userId: string) {
  const codes = Array.from(
    { length: PRIVILEGED_RECOVERY_CODE_COUNT },
    generateRecoveryCode,
  );
  const hashes = codes.map((code) => {
    const normalized = normalizeRecoveryCode(code);

    if (!normalized) throw new Error('Generated recovery code was invalid.');
    return hashRecoveryCode(userId, normalized);
  });

  if (new Set(hashes).size !== hashes.length) {
    throw new Error('Recovery-code generation produced a duplicate.');
  }

  return { codes, hashes };
}

async function insertDurableRecoveryEvent(
  client: DatabaseClient,
  event:
    | 'passkey.recovery_codes_generated'
    | 'passkey.recovery_code_used'
    | 'passkey.recovery_completed',
  actorUserId: string,
  details: Record<string, boolean | number | string>,
) {
  const eventId = randomUUID();
  const occurredAt = new Date().toISOString();
  const safeDetails = { actorUserId, ...details };

  await client.query(
    `
      INSERT INTO auth_security_events (
        event_id,
        occurred_at,
        category,
        event,
        outcome,
        actor_user_id,
        details
      )
      VALUES ($1, $2, 'authentication', $3, 'success', $4, $5::jsonb)
    `,
    [eventId, occurredAt, event, actorUserId, JSON.stringify(safeDetails)],
  );

  return { eventId, occurredAt };
}

async function replaceRecoveryCodeSetWithinTransaction(
  client: DatabaseClient,
  userId: string,
) {
  const generated = createRecoveryCodeMaterial(userId);

  // Replacing the offline recovery material is a security-boundary change.
  // Any previously redeemed grant (and any registration ceremony begun from
  // it) must become unusable in the same transaction as the rotation.
  await client.sql`
    UPDATE privileged_passkey_recovery_grants
    SET consumed_at = COALESCE(consumed_at, clock_timestamp())
    WHERE user_id = ${userId}
      AND consumed_at IS NULL
  `;
  await client.sql`
    UPDATE webauthn_challenges
    SET used_at = COALESCE(used_at, clock_timestamp())
    WHERE user_id = ${userId}
      AND purpose = 'registration'
      AND used_at IS NULL
  `;
  await client.sql`
    UPDATE privileged_recovery_code_sets
    SET revoked_at = COALESCE(revoked_at, clock_timestamp())
    WHERE user_id = ${userId}
      AND revoked_at IS NULL
  `;
  const insertedSet = await client.sql<{ created_at: Date; id: string }>`
    INSERT INTO privileged_recovery_code_sets (user_id)
    VALUES (${userId})
    RETURNING id, created_at
  `;
  const codeSet = insertedSet.rows[0];

  if (!codeSet) throw new Error('Recovery-code set was not created.');

  await client.query(
    `
      INSERT INTO privileged_recovery_codes (set_id, code_hash, position)
      SELECT $1::uuid, code_hash, position::smallint
      FROM UNNEST($2::text[]) WITH ORDINALITY AS generated(code_hash, position)
    `,
    [codeSet.id, generated.hashes],
  );

  return {
    codes: generated.codes,
    createdAt: codeSet.created_at.toISOString(),
    remainingCodes: generated.codes.length,
    setId: codeSet.id,
    totalCodes: generated.codes.length,
  };
}

export async function getRecoveryCodeSummary(
  userId: string,
): Promise<RecoveryCodeSummary | null> {
  const result = await sql<{
    created_at: Date;
    remaining_codes: string;
    total_codes: string;
  }>`
    SELECT
      code_set.created_at,
      COUNT(code.id) FILTER (WHERE code.used_at IS NULL)::text AS remaining_codes,
      COUNT(code.id)::text AS total_codes
    FROM privileged_recovery_code_sets AS code_set
    INNER JOIN privileged_recovery_codes AS code
      ON code.set_id = code_set.id
    WHERE code_set.user_id = ${userId}
      AND code_set.revoked_at IS NULL
    GROUP BY code_set.id, code_set.created_at
    LIMIT 1
  `;
  const row = result.rows[0];

  if (!row) return null;

  return {
    createdAt: row.created_at.toISOString(),
    remainingCodes: Number(row.remaining_codes),
    totalCodes: Number(row.total_codes),
  };
}

export async function getActiveRecoveryGrant({
  userId,
  sessionReference,
}: {
  userId: string;
  sessionReference: string;
}): Promise<RecoveryGrantSummary | null> {
  const result = await sql<{ expires_at: Date; id: string }>`
    SELECT recovery_grant.id, recovery_grant.expires_at
    FROM privileged_passkey_recovery_grants AS recovery_grant
    INNER JOIN auth_sessions
      ON auth_sessions.session_hash = recovery_grant.session_hash
    INNER JOIN users ON users.id = recovery_grant.user_id
    WHERE recovery_grant.user_id = ${userId}
      AND recovery_grant.session_hash = ${sessionReference}
      AND recovery_grant.consumed_at IS NULL
      AND recovery_grant.expires_at > NOW()
      AND auth_sessions.user_id = ${userId}
      AND auth_sessions.revoked_at IS NULL
      AND auth_sessions.absolute_expires_at > NOW()
      AND users.role IN ('admin', 'owner')
      AND users.email_verified_at IS NOT NULL
      AND users.account_status = 'active'
    LIMIT 1
  `;
  const grant = result.rows[0];

  return grant
    ? { grantId: grant.id, expiresAt: grant.expires_at.toISOString() }
    : null;
}

async function issueRecoveryCodeSet({
  userId,
  sessionReference,
  mode,
}: {
  userId: string;
  sessionReference: string;
  mode: RecoveryCodeSetMode;
}): Promise<RecoveryCodeSetResult> {
  const client = await db.connect();

  try {
    await client.sql`BEGIN`;
    await client.sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`passkey-user:${userId}`}, 0)
      )
    `;
    const state = await client.sql<{
      has_passkey: boolean;
      has_recent_passkey_step_up: boolean;
    }>`
      SELECT
        EXISTS (
          SELECT 1
          FROM user_passkeys
          WHERE user_passkeys.user_id = users.id
        ) AS has_passkey,
        (
          auth_sessions.mfa_method = 'passkey'
          AND auth_sessions.mfa_verified_at >=
            NOW() - (${RECENT_MFA_WINDOW_SECONDS} * INTERVAL '1 second')
          AND auth_sessions.mfa_verified_at <= NOW()
        ) AS has_recent_passkey_step_up
      FROM users
      INNER JOIN auth_sessions ON auth_sessions.user_id = users.id
      WHERE users.id = ${userId}
        AND users.role IN ('admin', 'owner')
        AND users.email_verified_at IS NOT NULL
        AND users.account_status = 'active'
        AND auth_sessions.session_hash = ${sessionReference}
        AND auth_sessions.revoked_at IS NULL
        AND auth_sessions.absolute_expires_at > NOW()
      LIMIT 1
      FOR UPDATE OF users, auth_sessions
    `;
    const current = state.rows[0];

    if (!current) {
      await client.sql`ROLLBACK`;
      return { status: 'unavailable' };
    }

    if (!current.has_passkey || !current.has_recent_passkey_step_up) {
      await client.sql`ROLLBACK`;
      return { status: 'step_up_required' };
    }

    const activeSet = await client.sql<{ id: string }>`
      SELECT id
      FROM privileged_recovery_code_sets
      WHERE user_id = ${userId}
        AND revoked_at IS NULL
      LIMIT 1
      FOR UPDATE
    `;

    if (mode === 'initial' && activeSet.rows[0]) {
      await client.sql`COMMIT`;
      return { status: 'already_exists' };
    }

    const recoverySet = await replaceRecoveryCodeSetWithinTransaction(
      client,
      userId,
    );
    const audit = await insertDurableRecoveryEvent(
      client,
      'passkey.recovery_codes_generated',
      userId,
      {
        recoveryCodeSetId: recoverySet.setId,
        codeCount: recoverySet.totalCodes,
        reason: mode,
      },
    );
    await enqueueSecurityNotificationWithinTransaction(client, {
      userId,
      kind: 'recovery_codes_created',
      changeId: audit.eventId,
      payload: {},
    });
    await client.sql`COMMIT`;

    return {
      status: 'issued',
      ...recoverySet,
      notification: {
        changeId: audit.eventId,
        occurredAt: audit.occurredAt,
        reason: mode,
        setId: recoverySet.setId,
      },
    };
  } catch (error) {
    await client.sql`ROLLBACK`.catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export function issueInitialRecoveryCodes(input: {
  userId: string;
  sessionReference: string;
}) {
  return issueRecoveryCodeSet({ ...input, mode: 'initial' });
}

export function regenerateRecoveryCodes(input: {
  userId: string;
  sessionReference: string;
}) {
  return issueRecoveryCodeSet({ ...input, mode: 'regenerate' });
}

export async function consumeRecoveryCode({
  userId,
  sessionReference,
  ipHash,
  codeInput,
}: {
  userId: string;
  sessionReference: string;
  ipHash: string;
  codeInput: string;
}): Promise<RecoveryCodeUseResult> {
  const normalized = normalizeRecoveryCode(codeInput);
  const codeHash = hashRecoveryCode(
    userId,
    normalized ?? `invalid:${codeInput.slice(0, 64)}`,
  );
  const client = await db.connect();

  try {
    await client.sql`BEGIN`;
    await client.sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`passkey-user:${userId}`}, 0)
      )
    `;
    await client.sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`recovery-session:${sessionReference}`}, 0)
      )
    `;
    await client.sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`recovery-ip:${ipHash}`}, 0)
      )
    `;
    const attempts = await client.sql<{
      ip_count: string;
      session_count: string;
      user_count: string;
    }>`
      SELECT
        (
          SELECT COUNT(*)::text
          FROM privileged_recovery_attempts
          WHERE session_hash = ${sessionReference}
            AND successful = FALSE
            AND attempted_at >
              NOW() - (${PRIVILEGED_RECOVERY_LIMITS.windowMinutes} * INTERVAL '1 minute')
        ) AS session_count,
        (
          SELECT COUNT(*)::text
          FROM privileged_recovery_attempts
          WHERE user_id = ${userId}
            AND successful = FALSE
            AND attempted_at >
              NOW() - (${PRIVILEGED_RECOVERY_LIMITS.windowMinutes} * INTERVAL '1 minute')
        ) AS user_count,
        (
          SELECT COUNT(*)::text
          FROM privileged_recovery_attempts
          WHERE ip_hash = ${ipHash}
            AND successful = FALSE
            AND attempted_at >
              NOW() - (${PRIVILEGED_RECOVERY_LIMITS.windowMinutes} * INTERVAL '1 minute')
        ) AS ip_count
    `;
    const counts = attempts.rows[0];

    if (
      !isPrivilegedRecoveryAttemptAllowed(
        Number(counts?.session_count ?? 0),
        Number(counts?.user_count ?? 0),
        Number(counts?.ip_count ?? 0),
      )
    ) {
      await client.sql`COMMIT`;
      return { status: 'limited' };
    }

    const attempt = await client.sql<{ id: string }>`
      INSERT INTO privileged_recovery_attempts (user_id, session_hash, ip_hash)
      SELECT ${userId}, auth_sessions.session_hash, ${ipHash}
      FROM auth_sessions
      WHERE auth_sessions.session_hash = ${sessionReference}
        AND auth_sessions.user_id = ${userId}
        AND auth_sessions.revoked_at IS NULL
        AND auth_sessions.absolute_expires_at > NOW()
      RETURNING id::text
    `;
    const attemptId = attempt.rows[0]?.id;

    if (!attemptId) {
      await client.sql`COMMIT`;
      return { status: 'unavailable' };
    }

    const state = await client.sql<{ session_hash: string }>`
      SELECT auth_sessions.session_hash
      FROM auth_sessions
      INNER JOIN users ON users.id = auth_sessions.user_id
      WHERE auth_sessions.session_hash = ${sessionReference}
        AND auth_sessions.user_id = ${userId}
        AND auth_sessions.revoked_at IS NULL
        AND auth_sessions.absolute_expires_at > NOW()
        AND users.role IN ('admin', 'owner')
        AND users.email_verified_at IS NOT NULL
        AND users.account_status = 'active'
      LIMIT 1
      FOR UPDATE OF auth_sessions, users
    `;

    if (!state.rows[0]) {
      await client.sql`COMMIT`;
      return { status: 'unavailable' };
    }

    const matchingCode = await client.sql<{ id: string; set_id: string }>`
      SELECT code.id, code.set_id
      FROM privileged_recovery_codes AS code
      INNER JOIN privileged_recovery_code_sets AS code_set
        ON code_set.id = code.set_id
      WHERE code_set.user_id = ${userId}
        AND code_set.revoked_at IS NULL
        AND code.code_hash = ${codeHash}
        AND code.used_at IS NULL
      LIMIT 1
      FOR UPDATE OF code, code_set
    `;
    const code = matchingCode.rows[0];

    if (!normalized || !code) {
      await client.sql`COMMIT`;
      return { status: 'invalid' };
    }

    const consumed = await client.sql<{ id: string }>`
      UPDATE privileged_recovery_codes
      SET used_at = clock_timestamp()
      WHERE id = ${code.id}
        AND used_at IS NULL
      RETURNING id
    `;

    if (!consumed.rows[0]) {
      await client.sql`COMMIT`;
      return { status: 'invalid' };
    }

    await client.sql`
      UPDATE privileged_passkey_recovery_grants
      SET consumed_at = COALESCE(consumed_at, clock_timestamp())
      WHERE session_hash = ${sessionReference}
        AND consumed_at IS NULL
    `;
    const grantResult = await client.sql<{
      created_at: Date;
      expires_at: Date;
      id: string;
    }>`
      INSERT INTO privileged_passkey_recovery_grants (
        user_id,
        session_hash,
        recovery_code_id,
        expires_at
      )
      VALUES (
        ${userId},
        ${sessionReference},
        ${code.id},
        clock_timestamp() + (${RECOVERY_GRANT_TTL_SECONDS} * INTERVAL '1 second')
      )
      RETURNING id, created_at, expires_at
    `;
    const grant = grantResult.rows[0];

    if (!grant) {
      await client.sql`ROLLBACK`;
      return { status: 'unavailable' };
    }

    await client.sql`
      UPDATE privileged_recovery_attempts
      SET successful = TRUE
      WHERE id = ${attemptId}
        AND session_hash = ${sessionReference}
    `;
    const remaining = await client.sql<{ remaining_codes: string }>`
      SELECT COUNT(*)::text AS remaining_codes
      FROM privileged_recovery_codes
      WHERE set_id = ${code.set_id}
        AND used_at IS NULL
    `;
    const remainingCodes = Number(remaining.rows[0]?.remaining_codes ?? 0);
    const audit = await insertDurableRecoveryEvent(
      client,
      'passkey.recovery_code_used',
      userId,
      {
        recoveryGrantId: grant.id,
        remainingCodes,
      },
    );
    await enqueueSecurityNotificationWithinTransaction(client, {
      userId,
      kind: 'recovery_code_used',
      changeId: audit.eventId,
      payload: { remainingCodes },
    });
    await client.sql`COMMIT`;

    return {
      status: 'used',
      grant: {
        grantId: grant.id,
        expiresAt: grant.expires_at.toISOString(),
      },
      remainingCodes,
      notification: {
        changeId: audit.eventId,
        occurredAt: audit.occurredAt,
        remainingCodes,
      },
    };
  } catch (error) {
    await client.sql`ROLLBACK`.catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function getRecoveryGrantWithinTransaction(
  client: DatabaseClient,
  userId: string,
  sessionReference: string,
) {
  const result = await client.sql<{
    expires_at: Date;
    id: string;
  }>`
    SELECT id, expires_at
    FROM privileged_passkey_recovery_grants
    WHERE user_id = ${userId}
      AND session_hash = ${sessionReference}
      AND consumed_at IS NULL
      AND expires_at > NOW()
    LIMIT 1
    FOR UPDATE
  `;

  return result.rows[0] ?? null;
}

export async function completeRecoveryWithinTransaction({
  client,
  userId,
  sessionReference,
  recoveryGrantId,
  passkeyId,
}: {
  client: DatabaseClient;
  userId: string;
  sessionReference: string;
  recoveryGrantId: string;
  passkeyId: string;
}): Promise<RecoveryCompletion> {
  const consumed = await client.sql<{ id: string }>`
    UPDATE privileged_passkey_recovery_grants
    SET consumed_at = clock_timestamp()
    WHERE id = ${recoveryGrantId}
      AND user_id = ${userId}
      AND session_hash = ${sessionReference}
      AND consumed_at IS NULL
      AND expires_at > NOW()
    RETURNING id
  `;

  if (!consumed.rows[0]) {
    throw new Error('The passkey recovery grant is no longer available.');
  }

  await client.sql`
    UPDATE auth_sessions
    SET
      revoked_at = COALESCE(revoked_at, NOW()),
      mfa_verified_at = NULL,
      mfa_method = NULL
    WHERE user_id = ${userId}
      AND session_hash <> ${sessionReference}
      AND revoked_at IS NULL
  `;
  await client.sql`
    UPDATE webauthn_challenges
    SET used_at = COALESCE(used_at, clock_timestamp())
    WHERE user_id = ${userId}
      AND used_at IS NULL
  `;
  await client.sql`
    UPDATE privileged_passkey_recovery_grants
    SET consumed_at = COALESCE(consumed_at, clock_timestamp())
    WHERE user_id = ${userId}
      AND id <> ${recoveryGrantId}
      AND consumed_at IS NULL
  `;
  const recoverySet = await replaceRecoveryCodeSetWithinTransaction(
    client,
    userId,
  );
  const audit = await insertDurableRecoveryEvent(
    client,
    'passkey.recovery_completed',
    userId,
    {
      passkeyId,
      recoveryGrantId,
      recoveryCodeSetId: recoverySet.setId,
    },
  );
  await enqueueSecurityNotificationWithinTransaction(client, {
    userId,
    kind: 'recovery_completed',
    changeId: audit.eventId,
    payload: {},
  });

  return {
    ...recoverySet,
    notification: {
      changeId: audit.eventId,
      occurredAt: audit.occurredAt,
      recoveryGrantId,
      setId: recoverySet.setId,
    },
  };
}

export async function invalidateRecoveryStateWithinTransaction(
  client: DatabaseClient,
  userId: string,
) {
  await client.query(
    `
    UPDATE privileged_recovery_code_sets
    SET revoked_at = COALESCE(revoked_at, clock_timestamp())
    WHERE user_id = $1
      AND revoked_at IS NULL
    `,
    [userId],
  );
  await client.query(
    `
    UPDATE privileged_passkey_recovery_grants
    SET consumed_at = COALESCE(consumed_at, clock_timestamp())
    WHERE user_id = $1
      AND consumed_at IS NULL
    `,
    [userId],
  );
}

export async function deleteExpiredRecoveryCodeData() {
  await Promise.all([
    sql`
      DELETE FROM privileged_recovery_attempts
      WHERE attempted_at < NOW() - INTERVAL '1 day'
    `,
    sql`
      DELETE FROM privileged_passkey_recovery_grants
      WHERE expires_at < NOW() - INTERVAL '1 day'
         OR consumed_at < NOW() - INTERVAL '1 day'
    `,
    sql`
      DELETE FROM privileged_recovery_code_sets
      WHERE revoked_at < NOW() - INTERVAL '180 days'
    `,
  ]);
}
