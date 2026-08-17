import 'server-only';

import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

import { db, sql, type VercelPoolClient } from '@/app/lib/db';

import { normalizeEmail } from '@/app/lib/auth/password';
import {
  hashEmailVerificationCode,
  hashRateLimitKey,
} from '@/app/lib/auth/security';

const VERIFICATION_CODE_TTL_MINUTES = 10;
const VERIFICATION_CODE_PATTERN = /^\d{6}$/;
const VERIFICATION_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const INVALIDATED_UNVERIFIED_PASSWORD = '!pending-registration-required!';

export type EmailVerificationUser = {
  id: string;
  email: string;
  first_name: string;
  email_verified_at: Date | null;
};

export type PendingRegistrationProposal = {
  email: string;
  firstName: string;
  lastName: string;
  passwordHash: string;
};

export type PendingRegistration = PendingRegistrationProposal & {
  challengeId: string;
  emailHash: string;
};

type PendingRegistrationRow = {
  challenge_id: string;
  email: string;
  email_hash: string;
  first_name: string;
  last_name: string;
  password_hash: string;
  code_digest: string;
  expires_at: Date;
  used_at: Date | null;
};

export type EmailVerificationResult =
  | { status: 'invalid' | 'limited' }
  | { status: 'verified'; user: EmailVerificationUser };

function generateVerificationCode() {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

function toPendingRegistration(row: PendingRegistrationRow) {
  return {
    challengeId: row.challenge_id,
    email: row.email,
    emailHash: row.email_hash,
    firstName: row.first_name,
    lastName: row.last_name,
    passwordHash: row.password_hash,
  } satisfies PendingRegistration;
}

export function createDecoyVerificationChallengeId() {
  return randomBytes(32).toString('base64url');
}

export async function findPendingRegistrationByChallenge(challengeId: string) {
  if (!VERIFICATION_CHALLENGE_PATTERN.test(challengeId)) return undefined;

  const result = await sql<PendingRegistrationRow>`
    SELECT
      challenge_id,
      email,
      email_hash,
      first_name,
      last_name,
      password_hash,
      code_digest,
      expires_at,
      used_at
    FROM pending_registrations
    WHERE challenge_id = ${challengeId}
    LIMIT 1
  `;

  const row = result.rows[0];
  return row ? toPendingRegistration(row) : undefined;
}

export async function recordEmailVerificationRequest(
  emailHash: string,
  ipHash: string,
) {
  const client = await db.connect();

  try {
    await client.sql`BEGIN`;
    await client.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${`verify-email:${emailHash}`}, 0))
    `;
    await client.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${`verify-ip:${ipHash}`}, 0))
    `;

    const limits = await client.sql<{
      email_count: string;
      ip_count: string;
      seconds_since_last: string | null;
    }>`
      SELECT
        (
          SELECT COUNT(*)::text
          FROM email_verification_requests
          WHERE email_hash = ${emailHash}
            AND requested_at > NOW() - INTERVAL '1 hour'
        ) AS email_count,
        (
          SELECT COUNT(*)::text
          FROM email_verification_requests
          WHERE ip_hash = ${ipHash}
            AND requested_at > NOW() - INTERVAL '1 hour'
        ) AS ip_count,
        (
          SELECT EXTRACT(EPOCH FROM (NOW() - MAX(requested_at)))::text
          FROM email_verification_requests
          WHERE email_hash = ${emailHash}
            AND requested_at > NOW() - INTERVAL '1 hour'
        ) AS seconds_since_last
    `;

    const counts = limits.rows[0];
    const secondsSinceLast = Number(counts?.seconds_since_last ?? 60);
    const allowed =
      Number(counts?.email_count ?? 0) < 3 &&
      Number(counts?.ip_count ?? 0) < 20 &&
      secondsSinceLast >= 60;

    if (allowed) {
      await client.sql`
        INSERT INTO email_verification_requests (email_hash, ip_hash)
        VALUES (${emailHash}, ${ipHash})
      `;
    }

    await client.sql`COMMIT`;
    return allowed;
  } catch (error) {
    await client.sql`ROLLBACK`;
    throw error;
  } finally {
    client.release();
  }
}

export async function createPendingRegistrationChallenge(
  proposal: PendingRegistrationProposal,
) {
  const email = normalizeEmail(proposal.email);
  const emailHash = getEmailVerificationEmailHash(email);
  const challengeId = createDecoyVerificationChallengeId();
  const code = generateVerificationCode();
  const codeDigest = hashEmailVerificationCode(challengeId, code);
  const client = await db.connect();

  try {
    await client.sql`BEGIN`;
    await client.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${`pending-registration:${emailHash}`}, 0))
    `;

    const existingUser = await client.sql<{
      id: string;
      email_verified_at: Date | null;
    }>`
      SELECT id, email_verified_at
      FROM users
      WHERE LOWER(email) = ${email}
      LIMIT 1
      FOR UPDATE
    `;
    const existing = existingUser.rows[0];

    if (existing?.email_verified_at) {
      await client.sql`COMMIT`;
      return undefined;
    }

    await client.sql`
      UPDATE pending_registrations
      SET used_at = NOW()
      WHERE email = ${email} AND used_at IS NULL
    `;

    if (existing) {
      // Rows created by the legacy flow may contain a password selected before
      // inbox ownership was proven. It must not remain usable while the new
      // registration is pending, and any JWT minted from it must be revoked.
      await client.sql`
        UPDATE users
        SET password = ${INVALIDATED_UNVERIFIED_PASSWORD},
            session_version = session_version + 1
        WHERE id = ${existing.id} AND email_verified_at IS NULL
      `;
      await client.sql`
        UPDATE email_verification_challenges
        SET used_at = NOW()
        WHERE user_id = ${existing.id} AND used_at IS NULL
      `;
      await client.sql`
        UPDATE password_reset_tokens
        SET used_at = NOW()
        WHERE user_id = ${existing.id} AND used_at IS NULL
      `;
    }

    await client.sql`
      INSERT INTO pending_registrations (
        challenge_id,
        email,
        email_hash,
        first_name,
        last_name,
        password_hash,
        code_digest,
        expires_at
      )
      VALUES (
        ${challengeId},
        ${email},
        ${emailHash},
        ${proposal.firstName},
        ${proposal.lastName},
        ${proposal.passwordHash},
        ${codeDigest},
        NOW() + (${VERIFICATION_CODE_TTL_MINUTES} * INTERVAL '1 minute')
      )
    `;
    await client.sql`COMMIT`;

    return { challengeId, code };
  } catch (error) {
    await client.sql`ROLLBACK`;
    throw error;
  } finally {
    client.release();
  }
}

export async function invalidatePendingRegistrationChallenge(
  challengeId: string,
) {
  if (!VERIFICATION_CHALLENGE_PATTERN.test(challengeId)) return;

  await sql`
    UPDATE pending_registrations
    SET used_at = NOW()
    WHERE challenge_id = ${challengeId} AND used_at IS NULL
  `;
}

async function preserveVerifiedAccount(
  client: VercelPoolClient,
  email: string,
) {
  await client.sql`
    UPDATE pending_registrations
    SET used_at = NOW()
    WHERE email = ${email} AND used_at IS NULL
  `;
  await client.sql`COMMIT`;
  return { status: 'invalid' } as const;
}

export async function verifyPendingRegistrationCode(
  challengeId: string,
  code: string,
  ipHash: string,
): Promise<EmailVerificationResult> {
  if (
    !VERIFICATION_CHALLENGE_PATTERN.test(challengeId) ||
    !VERIFICATION_CODE_PATTERN.test(code)
  ) {
    return { status: 'invalid' };
  }

  const submittedDigest = hashEmailVerificationCode(challengeId, code);
  const client = await db.connect();

  try {
    await client.sql`BEGIN`;

    const initialChallenge = await client.sql<PendingRegistrationRow>`
      SELECT
        challenge_id,
        email,
        email_hash,
        first_name,
        last_name,
        password_hash,
        code_digest,
        expires_at,
        used_at
      FROM pending_registrations
      WHERE challenge_id = ${challengeId}
      LIMIT 1
    `;
    const initialRow = initialChallenge.rows[0];

    if (!initialRow) {
      await client.sql`ROLLBACK`;
      return { status: 'invalid' };
    }

    await client.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${`pending-registration:${initialRow.email_hash}`}, 0))
    `;
    await client.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${`verify-attempt-ip:${ipHash}`}, 0))
    `;

    const challenge = await client.sql<PendingRegistrationRow>`
      SELECT
        challenge_id,
        email,
        email_hash,
        first_name,
        last_name,
        password_hash,
        code_digest,
        expires_at,
        used_at
      FROM pending_registrations
      WHERE challenge_id = ${challengeId}
      FOR UPDATE
    `;
    const row = challenge.rows[0];

    if (!row || row.used_at || row.expires_at <= new Date()) {
      await client.sql`COMMIT`;
      return { status: 'invalid' };
    }

    const attempts = await client.sql<{
      email_count: string;
      ip_count: string;
    }>`
      SELECT
        (
          SELECT COUNT(*)::text
          FROM pending_registration_attempts
          WHERE email_hash = ${row.email_hash}
            AND successful = FALSE
            AND attempted_at > NOW() - INTERVAL '15 minutes'
        ) AS email_count,
        (
          SELECT COUNT(*)::text
          FROM pending_registration_attempts
          WHERE ip_hash = ${ipHash}
            AND successful = FALSE
            AND attempted_at > NOW() - INTERVAL '15 minutes'
        ) AS ip_count
    `;
    const counts = attempts.rows[0];

    if (
      Number(counts?.email_count ?? 0) >= 5 ||
      Number(counts?.ip_count ?? 0) >= 20
    ) {
      await client.sql`COMMIT`;
      return { status: 'limited' };
    }

    const expected = Buffer.from(row.code_digest, 'hex');
    const submitted = Buffer.from(submittedDigest, 'hex');
    const matches =
      expected.length === submitted.length &&
      timingSafeEqual(expected, submitted);

    await client.sql`
      INSERT INTO pending_registration_attempts (
        challenge_id,
        email_hash,
        ip_hash,
        successful
      )
      VALUES (${challengeId}, ${row.email_hash}, ${ipHash}, ${matches})
    `;

    if (!matches) {
      await client.sql`COMMIT`;
      return { status: 'invalid' };
    }

    let existingUser = await client.sql<EmailVerificationUser>`
      SELECT id, email, first_name, email_verified_at
      FROM users
      WHERE LOWER(email) = ${row.email}
      LIMIT 1
      FOR UPDATE
    `;
    const existing = existingUser.rows[0];

    if (existing?.email_verified_at) {
      const preserved = await preserveVerifiedAccount(client, row.email);
      return preserved;
    }

    let activatedUser: EmailVerificationUser | undefined;

    if (existing) {
      const updatedUser = await client.sql<EmailVerificationUser>`
        UPDATE users
        SET first_name = ${row.first_name},
            last_name = ${row.last_name},
            email = ${row.email},
            password = ${row.password_hash},
            email_verified_at = NOW(),
            session_version = session_version + 1
        WHERE id = ${existing.id} AND email_verified_at IS NULL
        RETURNING id, email, first_name, email_verified_at
      `;
      activatedUser = updatedUser.rows[0];
    } else {
      const insertedUser = await client.sql<EmailVerificationUser>`
        INSERT INTO users (
          first_name,
          last_name,
          email,
          password,
          email_verified_at
        )
        VALUES (
          ${row.first_name},
          ${row.last_name},
          ${row.email},
          ${row.password_hash},
          NOW()
        )
        ON CONFLICT DO NOTHING
        RETURNING id, email, first_name, email_verified_at
      `;
      activatedUser = insertedUser.rows[0];

      if (!activatedUser) {
        // Defend against a user row being created by an administrative process
        // between the initial lookup and insert. A verified account always wins;
        // an unverified legacy row is safely replaced by this proven proposal.
        existingUser = await client.sql<EmailVerificationUser>`
          SELECT id, email, first_name, email_verified_at
          FROM users
          WHERE LOWER(email) = ${row.email}
          LIMIT 1
          FOR UPDATE
        `;
        const conflictingUser = existingUser.rows[0];

        if (!conflictingUser || conflictingUser.email_verified_at) {
          const preserved = await preserveVerifiedAccount(client, row.email);
          return preserved;
        }

        const updatedUser = await client.sql<EmailVerificationUser>`
          UPDATE users
          SET first_name = ${row.first_name},
              last_name = ${row.last_name},
              email = ${row.email},
              password = ${row.password_hash},
              email_verified_at = NOW(),
              session_version = session_version + 1
          WHERE id = ${conflictingUser.id} AND email_verified_at IS NULL
          RETURNING id, email, first_name, email_verified_at
        `;
        activatedUser = updatedUser.rows[0];
      }
    }

    if (!activatedUser) {
      await client.sql`ROLLBACK`;
      return { status: 'invalid' };
    }

    await client.sql`
      UPDATE pending_registrations
      SET used_at = NOW()
      WHERE email = ${row.email} AND used_at IS NULL
    `;
    await client.sql`
      UPDATE email_verification_challenges
      SET used_at = NOW()
      WHERE user_id = ${activatedUser.id} AND used_at IS NULL
    `;
    await client.sql`COMMIT`;

    return { status: 'verified', user: activatedUser };
  } catch (error) {
    await client.sql`ROLLBACK`;
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteExpiredEmailVerificationData() {
  await Promise.all([
    sql`
      DELETE FROM pending_registrations
      WHERE expires_at < NOW() - INTERVAL '1 day'
    `,
    sql`
      DELETE FROM email_verification_challenges
      WHERE expires_at < NOW() - INTERVAL '1 day'
    `,
    sql`
      DELETE FROM email_verification_requests
      WHERE requested_at < NOW() - INTERVAL '1 day'
    `,
    sql`
      DELETE FROM email_verification_attempts
      WHERE attempted_at < NOW() - INTERVAL '1 day'
    `,
  ]);
}

export function getEmailVerificationEmailHash(email: string) {
  return hashRateLimitKey(`email:${normalizeEmail(email)}`);
}
