import 'server-only';

import { randomBytes } from 'node:crypto';

import { db, sql } from '@/app/lib/db';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from 'simplewebauthn-server';

import { PASSKEY_CHALLENGE_TTL_SECONDS } from './passkey-policy';
import {
  completeRecoveryWithinTransaction,
  getRecoveryGrantWithinTransaction,
  type RecoveryCompletion,
} from './recovery-codes';
import type { AppRole } from './roles';
import { enqueueSecurityNotificationWithinTransaction } from './security-notification-outbox';
import { RECENT_MFA_WINDOW_SECONDS } from './session-policy';

const CEREMONY_TIMEOUT_MS = 2 * 60 * 1_000;
export const MAX_PASSKEYS_PER_USER = 10;

export class PasskeyCapacityError extends Error {
  constructor() {
    super(`An account can keep up to ${MAX_PASSKEYS_PER_USER} passkeys.`);
    this.name = 'PasskeyCapacityError';
  }
}

type PasskeyPurpose = 'registration' | 'step_up';

type PasskeyRow = {
  id: string;
  credential_id: string;
  public_key: Buffer;
  counter: string | number;
  device_type: string;
  backed_up: boolean;
  transports: string[];
  label: string;
  created_at: Date;
  last_used_at: Date | null;
};

type PasskeyUserRow = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  role: AppRole;
  webauthn_user_handle: Buffer | null;
};

type StepUpPasskeyRow = PasskeyRow & {
  webauthn_user_handle: Buffer | null;
};

type ChallengeRow = {
  id: string;
  challenge: string;
};

type RemovablePasskeyRow = Pick<
  PasskeyRow,
  'backed_up' | 'created_at' | 'id' | 'label'
>;

export type PasskeyRemovalResult =
  | {
      status: 'removed';
      passkey: {
        backedUp: boolean;
        createdAt: string;
        id: string;
        label: string;
      };
      remainingPasskeys: number;
    }
  | {
      status:
        | 'last_privileged_passkey'
        | 'not_found'
        | 'step_up_required'
        | 'unavailable';
    };

export type PasskeyRemovalAuthorization = 'passkey' | 'password';

const REAUTH_WINDOW_MINUTES = 15;
const REAUTH_SESSION_FAILURE_LIMIT = 5;
const REAUTH_IP_FAILURE_LIMIT = 20;
export const PASSKEY_EPHEMERAL_DATA_RETENTION_HOURS = 24;

export type PasskeySummary = {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
  backedUp: boolean;
};

export type EnrolledPasskey = {
  backedUp: boolean;
  createdAt: string;
  id: string;
  label: string;
};

export function getPasskeyConfiguration() {
  const previewOrigin =
    process.env.VERCEL_ENV === 'preview' && process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : undefined;
  const usesAutomaticPreviewOrigin =
    !process.env.PASSKEY_ORIGIN && previewOrigin !== undefined;
  const configuredOrigin =
    process.env.PASSKEY_ORIGIN ??
    previewOrigin ??
    process.env.APP_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : undefined) ??
    (process.env.NODE_ENV !== 'production'
      ? 'http://localhost:3000'
      : undefined);

  if (!configuredOrigin) {
    throw new Error('PASSKEY_ORIGIN or APP_URL is required for passkeys.');
  }

  const originUrl = new URL(configuredOrigin);
  const isLocal = ['localhost', '127.0.0.1'].includes(originUrl.hostname);

  if (originUrl.protocol !== 'https:' && !isLocal) {
    throw new Error(
      'Passkey ceremonies require HTTPS outside local development.',
    );
  }

  // Vercel preview hosts are siblings of the production host, not children of
  // it. A production RP ID therefore cannot be reused for the automatic
  // preview origin; bind both values to the exact preview hostname instead.
  const rpID = usesAutomaticPreviewOrigin
    ? originUrl.hostname
    : (process.env.PASSKEY_RP_ID ?? originUrl.hostname);
  const originIsWithinRp =
    originUrl.hostname === rpID || originUrl.hostname.endsWith(`.${rpID}`);

  if (!originIsWithinRp) {
    throw new Error(
      'PASSKEY_RP_ID must be the passkey origin host or its parent.',
    );
  }

  return { origin: originUrl.origin, rpID };
}

function normalizeTransports(transports: string[]) {
  return transports.filter(
    (transport): transport is AuthenticatorTransportFuture =>
      [
        'ble',
        'cable',
        'hybrid',
        'internal',
        'nfc',
        'smart-card',
        'usb',
      ].includes(transport),
  );
}

async function getPasskeyUser(userId: string) {
  const result = await sql<PasskeyUserRow>`
    SELECT id, email, first_name, last_name, role, webauthn_user_handle
    FROM users
    WHERE id = ${userId}
      AND email_verified_at IS NOT NULL
      AND account_status = 'active'
      AND role IN ('admin', 'owner')
    LIMIT 1
  `;

  return result.rows[0];
}

async function getOrCreateUserHandle(user: PasskeyUserRow) {
  if (user.webauthn_user_handle) return user.webauthn_user_handle;

  const nextHandleHex = randomBytes(32).toString('hex');
  const result = await sql<{ webauthn_user_handle: Buffer }>`
    UPDATE users
    SET webauthn_user_handle = decode(${nextHandleHex}, 'hex')
    WHERE id = ${user.id}
      AND webauthn_user_handle IS NULL
    RETURNING webauthn_user_handle
  `;

  if (result.rows[0]) return result.rows[0].webauthn_user_handle;

  const existing = await sql<{ webauthn_user_handle: Buffer }>`
    SELECT webauthn_user_handle
    FROM users
    WHERE id = ${user.id}
      AND webauthn_user_handle IS NOT NULL
    LIMIT 1
  `;

  if (!existing.rows[0])
    throw new Error('The passkey identity is unavailable.');
  return existing.rows[0].webauthn_user_handle;
}

async function loadPasskeyRows(userId: string) {
  const result = await sql<PasskeyRow>`
    SELECT
      id,
      credential_id,
      public_key,
      counter,
      device_type,
      backed_up,
      transports,
      label,
      created_at,
      last_used_at
    FROM user_passkeys
    WHERE user_id = ${userId}
    ORDER BY created_at ASC
  `;

  return result.rows;
}

async function storeChallenge({
  userId,
  sessionReference,
  challenge,
  purpose,
}: {
  userId: string;
  sessionReference: string;
  challenge: string;
  purpose: PasskeyPurpose;
}) {
  const client = await db.connect();

  try {
    await client.sql`BEGIN`;
    await client.sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`webauthn:${sessionReference}:${purpose}`}, 0)
      )
    `;
    await client.sql`
      UPDATE webauthn_challenges
      SET used_at = COALESCE(used_at, NOW())
      WHERE session_hash = ${sessionReference}
        AND purpose = ${purpose}
        AND used_at IS NULL
    `;
    const recentChallenges = await client.sql<{ challenge_count: string }>`
      SELECT COUNT(*)::text AS challenge_count
      FROM webauthn_challenges
      WHERE session_hash = ${sessionReference}
        AND created_at > NOW() - INTERVAL '15 minutes'
    `;

    if (Number(recentChallenges.rows[0]?.challenge_count ?? 0) >= 10) {
      await client.sql`ROLLBACK`;
      throw new Error('Too many passkey attempts. Wait before trying again.');
    }

    const inserted = await client.sql<{ id: string }>`
      INSERT INTO webauthn_challenges (
        user_id,
        session_hash,
        challenge,
        purpose,
        expires_at
      )
      SELECT
        ${userId},
        auth_sessions.session_hash,
        ${challenge},
        ${purpose},
        NOW() + (${PASSKEY_CHALLENGE_TTL_SECONDS} * INTERVAL '1 second')
      FROM auth_sessions
      WHERE auth_sessions.session_hash = ${sessionReference}
        AND auth_sessions.user_id = ${userId}
        AND auth_sessions.revoked_at IS NULL
        AND auth_sessions.absolute_expires_at > NOW()
      RETURNING id
    `;

    if (!inserted.rows[0]) {
      await client.sql`ROLLBACK`;
      throw new Error('The authenticated session is no longer available.');
    }

    await client.sql`COMMIT`;
  } catch (error) {
    await client.sql`ROLLBACK`.catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function reservePasskeyReauthenticationAttempt({
  userId,
  sessionReference,
  ipHash,
}: {
  userId: string;
  sessionReference: string;
  ipHash: string;
}) {
  const client = await db.connect();

  try {
    await client.sql`BEGIN`;
    await client.sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`passkey-reauth:${sessionReference}`}, 0)
      )
    `;
    await client.sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`passkey-reauth-ip:${ipHash}`}, 0)
      )
    `;
    const limits = await client.sql<{
      session_count: string;
      ip_count: string;
    }>`
      SELECT
        (
          SELECT COUNT(*)::text
          FROM passkey_reauth_attempts
          WHERE session_hash = ${sessionReference}
            AND successful = FALSE
            AND attempted_at > NOW() - (${REAUTH_WINDOW_MINUTES} * INTERVAL '1 minute')
        ) AS session_count,
        (
          SELECT COUNT(*)::text
          FROM passkey_reauth_attempts
          WHERE ip_hash = ${ipHash}
            AND successful = FALSE
            AND attempted_at > NOW() - (${REAUTH_WINDOW_MINUTES} * INTERVAL '1 minute')
        ) AS ip_count
    `;
    const counts = limits.rows[0];
    const allowed =
      Number(counts?.session_count ?? 0) < REAUTH_SESSION_FAILURE_LIMIT &&
      Number(counts?.ip_count ?? 0) < REAUTH_IP_FAILURE_LIMIT;

    if (!allowed) {
      await client.sql`COMMIT`;
      return undefined;
    }

    const inserted = await client.sql<{ id: string }>`
      INSERT INTO passkey_reauth_attempts (user_id, session_hash, ip_hash)
      SELECT ${userId}, auth_sessions.session_hash, ${ipHash}
      FROM auth_sessions
      WHERE auth_sessions.session_hash = ${sessionReference}
        AND auth_sessions.user_id = ${userId}
        AND auth_sessions.revoked_at IS NULL
        AND auth_sessions.absolute_expires_at > NOW()
      RETURNING id::text
    `;
    await client.sql`COMMIT`;
    return inserted.rows[0]?.id;
  } catch (error) {
    await client.sql`ROLLBACK`.catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function completePasskeyReauthenticationAttempt({
  attemptId,
  sessionReference,
  successful,
}: {
  attemptId: string;
  sessionReference: string;
  successful: boolean;
}) {
  if (successful) {
    await sql`
      DELETE FROM passkey_reauth_attempts
      WHERE session_hash = ${sessionReference}
        OR id = ${attemptId}
    `;
    return;
  }

  await sql`
    UPDATE passkey_reauth_attempts
    SET successful = FALSE
    WHERE id = ${attemptId}
      AND session_hash = ${sessionReference}
  `;
}

export async function getUserPasskeys(
  userId: string,
): Promise<PasskeySummary[]> {
  const rows = await loadPasskeyRows(userId);

  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    createdAt: row.created_at.toISOString(),
    lastUsedAt: row.last_used_at?.toISOString() ?? null,
    backedUp: row.backed_up,
  }));
}

export async function removeUserPasskey({
  userId,
  passkeyId,
  authorization,
}: {
  userId: string;
  passkeyId: string;
  authorization: PasskeyRemovalAuthorization;
}): Promise<PasskeyRemovalResult> {
  const client = await db.connect();

  try {
    await client.sql`BEGIN`;
    await client.sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`passkey-user:${userId}`}, 0)
      )
    `;
    const accountResult = await client.sql<{ role: AppRole }>`
      SELECT role
      FROM users
      WHERE id = ${userId}
        AND email_verified_at IS NOT NULL
        AND account_status = 'active'
      FOR UPDATE
    `;
    const account = accountResult.rows[0];

    if (!account) {
      await client.sql`COMMIT`;
      return { status: 'unavailable' };
    }

    if (
      (account.role === 'admin' || account.role === 'owner') &&
      authorization !== 'passkey'
    ) {
      await client.sql`COMMIT`;
      return { status: 'step_up_required' };
    }

    const passkeyResult = await client.sql<RemovablePasskeyRow>`
      SELECT id, label, backed_up, created_at
      FROM user_passkeys
      WHERE user_id = ${userId}
      ORDER BY created_at ASC
      FOR UPDATE
    `;
    const target = passkeyResult.rows.find(
      (passkey) => passkey.id === passkeyId,
    );

    if (!target) {
      await client.sql`COMMIT`;
      return { status: 'not_found' };
    }

    if (
      (account.role === 'admin' || account.role === 'owner') &&
      passkeyResult.rows.length <= 1
    ) {
      await client.sql`COMMIT`;
      return { status: 'last_privileged_passkey' };
    }

    await client.sql`
      DELETE FROM user_passkeys
      WHERE id = ${passkeyId}
        AND user_id = ${userId}
    `;
    await client.sql`
      UPDATE auth_sessions
      SET
        mfa_verified_at = NULL,
        mfa_method = NULL
      WHERE user_id = ${userId}
        AND mfa_verified_at IS NOT NULL
    `;
    await client.sql`
      UPDATE webauthn_challenges
      SET used_at = COALESCE(used_at, NOW())
      WHERE user_id = ${userId}
        AND used_at IS NULL
    `;
    await enqueueSecurityNotificationWithinTransaction(client, {
      userId,
      kind: 'passkey_removed',
      changeId: target.id,
      payload: { passkeyLabel: target.label },
    });
    await client.sql`COMMIT`;

    return {
      status: 'removed',
      passkey: {
        backedUp: target.backed_up,
        createdAt: target.created_at.toISOString(),
        id: target.id,
        label: target.label,
      },
      remainingPasskeys: passkeyResult.rows.length - 1,
    };
  } catch (error) {
    await client.sql`ROLLBACK`.catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function beginPasskeyRegistrationCeremony({
  userId,
  sessionReference,
}: {
  userId: string;
  sessionReference: string;
}): Promise<PublicKeyCredentialCreationOptionsJSON> {
  const user = await getPasskeyUser(userId);
  if (!user) throw new Error('The account is unavailable.');

  const [userHandle, passkeys] = await Promise.all([
    getOrCreateUserHandle(user),
    loadPasskeyRows(userId),
  ]);

  if (passkeys.length >= MAX_PASSKEYS_PER_USER) {
    throw new PasskeyCapacityError();
  }

  const { rpID } = getPasskeyConfiguration();
  const options = await generateRegistrationOptions({
    rpName: 'Field Atlas',
    rpID,
    userID: new Uint8Array(userHandle),
    userName: user.email,
    userDisplayName:
      `${user.first_name} ${user.last_name}`.trim() || 'Field Atlas explorer',
    timeout: CEREMONY_TIMEOUT_MS,
    attestationType: 'none',
    excludeCredentials: passkeys.map((passkey) => ({
      id: passkey.credential_id,
      transports: normalizeTransports(passkey.transports),
    })),
    authenticatorSelection: {
      residentKey: 'required',
      userVerification: 'required',
    },
  });

  await storeChallenge({
    userId,
    sessionReference,
    challenge: options.challenge,
    purpose: 'registration',
  });

  return options;
}

export async function completePasskeyRegistrationCeremony({
  userId,
  sessionReference,
  response,
  label,
}: {
  userId: string;
  sessionReference: string;
  response: RegistrationResponseJSON;
  label: string;
}): Promise<false | (EnrolledPasskey & { recovery?: RecoveryCompletion })> {
  const { origin, rpID } = getPasskeyConfiguration();
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
        hashtextextended(${`auth-session-user:${userId}`}, 0)
      )
    `;
    const challenge = await client.sql<ChallengeRow>`
      SELECT id, challenge
      FROM webauthn_challenges AS challenge
      INNER JOIN auth_sessions AS auth_session
        ON auth_session.session_hash = challenge.session_hash
      WHERE challenge.user_id = ${userId}
        AND challenge.session_hash = ${sessionReference}
        AND challenge.purpose = 'registration'
        AND challenge.used_at IS NULL
        AND challenge.expires_at > NOW()
        AND auth_session.user_id = ${userId}
        AND auth_session.revoked_at IS NULL
        AND auth_session.absolute_expires_at > NOW()
      ORDER BY challenge.created_at DESC
      LIMIT 1
      FOR UPDATE OF challenge
    `;
    const challengeRow = challenge.rows[0];

    if (!challengeRow) {
      await client.sql`ROLLBACK`;
      return false;
    }

    await client.sql`
      UPDATE webauthn_challenges
      SET used_at = NOW()
      WHERE id = ${challengeRow.id}
    `;

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: challengeRow.challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
      });
    } catch {
      await client.sql`COMMIT`;
      return false;
    }

    if (!verification.verified || !verification.registrationInfo) {
      await client.sql`COMMIT`;
      return false;
    }

    const enrollmentState = await client.sql<{
      has_recent_step_up: boolean;
      mfa_method: 'passkey' | null;
      passkey_count: string;
      role: AppRole;
    }>`
      SELECT
        users.role,
        (
          auth_sessions.mfa_verified_at IS NOT NULL
          AND auth_sessions.mfa_verified_at >=
            NOW() - (${RECENT_MFA_WINDOW_SECONDS} * INTERVAL '1 second')
          AND auth_sessions.mfa_verified_at <= NOW()
        ) AS has_recent_step_up,
        auth_sessions.mfa_method,
        (
          SELECT COUNT(*)::text
          FROM user_passkeys
          WHERE user_passkeys.user_id = users.id
        ) AS passkey_count
      FROM users
      INNER JOIN auth_sessions
        ON auth_sessions.user_id = users.id
      WHERE users.id = ${userId}
        AND users.email_verified_at IS NOT NULL
        AND users.account_status = 'active'
        AND auth_sessions.session_hash = ${sessionReference}
        AND auth_sessions.revoked_at IS NULL
        AND auth_sessions.absolute_expires_at > NOW()
      LIMIT 1
      FOR UPDATE OF users, auth_sessions
    `;
    const state = enrollmentState.rows[0];

    if (!state) {
      await client.sql`ROLLBACK`;
      return false;
    }

    const passkeyCount = Number(state.passkey_count ?? 0);
    const recoveryGrant = await getRecoveryGrantWithinTransaction(
      client,
      userId,
      sessionReference,
    );

    if (state.role !== 'admin' && state.role !== 'owner') {
      await client.sql`COMMIT`;
      return false;
    }

    if (passkeyCount >= MAX_PASSKEYS_PER_USER) {
      await client.sql`COMMIT`;
      return false;
    }

    if (
      passkeyCount > 0 &&
      (!state.has_recent_step_up || state.mfa_method !== 'passkey') &&
      !recoveryGrant
    ) {
      await client.sql`COMMIT`;
      return false;
    }

    const { credential, credentialDeviceType, credentialBackedUp } =
      verification.registrationInfo;
    const inserted = await client.query<{ created_at: Date; id: string }>(
      `
        INSERT INTO user_passkeys (
          user_id,
          credential_id,
          public_key,
          counter,
          device_type,
          backed_up,
          transports,
          label
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (credential_id) DO NOTHING
        RETURNING id, created_at
      `,
      [
        userId,
        credential.id,
        Buffer.from(credential.publicKey),
        credential.counter,
        credentialDeviceType,
        credentialBackedUp,
        normalizeTransports(credential.transports ?? []),
        label,
      ],
    );

    if (!inserted.rows[0]) {
      await client.sql`COMMIT`;
      return false;
    }

    const elevated = await client.sql<{ session_hash: string }>`
      UPDATE auth_sessions
      SET
        mfa_verified_at = NOW(),
        mfa_method = 'passkey'
      WHERE session_hash = ${sessionReference}
        AND user_id = ${userId}
        AND revoked_at IS NULL
        AND absolute_expires_at > NOW()
      RETURNING session_hash
    `;

    if (!elevated.rows[0]) {
      await client.sql`ROLLBACK`;
      return false;
    }

    let recovery: RecoveryCompletion | undefined;

    if (recoveryGrant) {
      recovery = await completeRecoveryWithinTransaction({
        client,
        userId,
        sessionReference,
        recoveryGrantId: recoveryGrant.id,
        passkeyId: inserted.rows[0].id,
      });
    }

    await enqueueSecurityNotificationWithinTransaction(client, {
      userId,
      kind: 'passkey_added',
      changeId: inserted.rows[0].id,
      payload: { passkeyLabel: label },
    });

    await client.sql`COMMIT`;
    return {
      backedUp: credentialBackedUp,
      createdAt: inserted.rows[0].created_at.toISOString(),
      id: inserted.rows[0].id,
      label,
      ...(recovery ? { recovery } : {}),
    };
  } catch (error) {
    await client.sql`ROLLBACK`.catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function beginPasskeyStepUpCeremony({
  userId,
  sessionReference,
}: {
  userId: string;
  sessionReference: string;
}): Promise<PublicKeyCredentialRequestOptionsJSON | null> {
  const user = await getPasskeyUser(userId);
  if (!user) return null;

  const passkeys = await loadPasskeyRows(userId);
  if (passkeys.length === 0) return null;

  const { rpID } = getPasskeyConfiguration();
  const options = await generateAuthenticationOptions({
    rpID,
    timeout: CEREMONY_TIMEOUT_MS,
    userVerification: 'required',
    allowCredentials: passkeys.map((passkey) => ({
      id: passkey.credential_id,
      transports: normalizeTransports(passkey.transports),
    })),
  });

  await storeChallenge({
    userId,
    sessionReference,
    challenge: options.challenge,
    purpose: 'step_up',
  });

  return options;
}

export async function completePasskeyStepUpCeremony({
  userId,
  sessionReference,
  response,
}: {
  userId: string;
  sessionReference: string;
  response: AuthenticationResponseJSON;
}) {
  const { origin, rpID } = getPasskeyConfiguration();
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
        hashtextextended(${`auth-session-user:${userId}`}, 0)
      )
    `;
    const challenge = await client.sql<ChallengeRow>`
      SELECT id, challenge
      FROM webauthn_challenges AS challenge
      INNER JOIN auth_sessions AS auth_session
        ON auth_session.session_hash = challenge.session_hash
      WHERE challenge.user_id = ${userId}
        AND challenge.session_hash = ${sessionReference}
        AND challenge.purpose = 'step_up'
        AND challenge.used_at IS NULL
        AND challenge.expires_at > NOW()
        AND auth_session.user_id = ${userId}
        AND auth_session.revoked_at IS NULL
        AND auth_session.absolute_expires_at > NOW()
      ORDER BY challenge.created_at DESC
      LIMIT 1
      FOR UPDATE OF challenge
    `;
    const challengeRow = challenge.rows[0];

    if (!challengeRow) {
      await client.sql`ROLLBACK`;
      return false;
    }

    await client.sql`
      UPDATE webauthn_challenges
      SET used_at = NOW()
      WHERE id = ${challengeRow.id}
    `;
    const credential = await client.sql<StepUpPasskeyRow>`
      SELECT
        user_passkeys.id,
        user_passkeys.credential_id,
        user_passkeys.public_key,
        user_passkeys.counter,
        user_passkeys.device_type,
        user_passkeys.backed_up,
        user_passkeys.transports,
        user_passkeys.label,
        user_passkeys.created_at,
        user_passkeys.last_used_at,
        users.webauthn_user_handle
      FROM user_passkeys
      INNER JOIN users ON users.id = user_passkeys.user_id
      WHERE user_passkeys.user_id = ${userId}
        AND user_passkeys.credential_id = ${response.id}
        AND users.email_verified_at IS NOT NULL
        AND users.account_status = 'active'
        AND users.role IN ('admin', 'owner')
      LIMIT 1
      FOR UPDATE OF user_passkeys
    `;
    const passkey = credential.rows[0];

    if (!passkey) {
      await client.sql`COMMIT`;
      return false;
    }

    if (
      response.response.userHandle &&
      (!passkey.webauthn_user_handle ||
        response.response.userHandle !==
          passkey.webauthn_user_handle.toString('base64url'))
    ) {
      await client.sql`COMMIT`;
      return false;
    }

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: challengeRow.challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        credential: {
          id: passkey.credential_id,
          publicKey: new Uint8Array(passkey.public_key),
          counter: Number(passkey.counter),
          transports: normalizeTransports(passkey.transports),
        },
        requireUserVerification: true,
      });
    } catch {
      await client.sql`COMMIT`;
      return false;
    }

    if (!verification.verified) {
      await client.sql`COMMIT`;
      return false;
    }

    await client.sql`
      UPDATE user_passkeys
      SET
        counter = ${verification.authenticationInfo.newCounter},
        device_type = ${verification.authenticationInfo.credentialDeviceType},
        backed_up = ${verification.authenticationInfo.credentialBackedUp},
        last_used_at = NOW()
      WHERE id = ${passkey.id}
    `;
    const elevated = await client.sql<{ session_hash: string }>`
      UPDATE auth_sessions
      SET
        mfa_verified_at = NOW(),
        mfa_method = 'passkey'
      WHERE session_hash = ${sessionReference}
        AND user_id = ${userId}
        AND revoked_at IS NULL
        AND absolute_expires_at > NOW()
      RETURNING session_hash
    `;

    if (!elevated.rows[0]) {
      await client.sql`ROLLBACK`;
      return false;
    }

    await client.sql`COMMIT`;
    return true;
  } catch (error) {
    await client.sql`ROLLBACK`.catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Passkey challenges and reauthentication reservations are short-lived
 * enforcement data. Authorization queries always check their live window;
 * this scheduled retention removes the expired rows after a small diagnostic
 * grace period.
 */
export async function deleteExpiredPasskeyData() {
  await Promise.all([
    sql`
      DELETE FROM webauthn_challenges
      WHERE expires_at < NOW() - (${PASSKEY_EPHEMERAL_DATA_RETENTION_HOURS} * INTERVAL '1 hour')
         OR used_at < NOW() - (${PASSKEY_EPHEMERAL_DATA_RETENTION_HOURS} * INTERVAL '1 hour')
    `,
    sql`
      DELETE FROM passkey_reauth_attempts
      WHERE attempted_at < NOW() - (${PASSKEY_EPHEMERAL_DATA_RETENTION_HOURS} * INTERVAL '1 hour')
    `,
  ]);
}
