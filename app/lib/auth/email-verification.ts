import 'server-only';

import { randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

import { db, sql } from '@vercel/postgres';

import {
  hashEmailVerificationCode,
  hashRateLimitKey,
} from '@/app/lib/auth/security';

const VERIFICATION_CODE_TTL_MINUTES = 10;
const VERIFICATION_CODE_PATTERN = /^\d{6}$/;
const VERIFICATION_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type EmailVerificationUser = {
  id: string;
  email: string;
  first_name: string;
  email_verified_at: Date | null;
};

type ChallengeRow = EmailVerificationUser & {
  challenge_id: string;
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

export function createDecoyVerificationChallengeId() {
  return randomBytes(32).toString('base64url');
}

export async function findEmailVerificationUser(email: string) {
  const result = await sql<EmailVerificationUser>`
    SELECT id, email, first_name, email_verified_at
    FROM users
    WHERE LOWER(email) = ${email}
    LIMIT 1
  `;

  return result.rows[0];
}

export async function findVerificationUserByChallenge(challengeId: string) {
  if (!VERIFICATION_CHALLENGE_PATTERN.test(challengeId)) return undefined;

  const result = await sql<EmailVerificationUser>`
    SELECT users.id, users.email, users.first_name, users.email_verified_at
    FROM email_verification_challenges
    INNER JOIN users ON users.id = email_verification_challenges.user_id
    WHERE email_verification_challenges.challenge_id = ${challengeId}
    LIMIT 1
  `;

  return result.rows[0];
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
        COUNT(*) FILTER (WHERE email_hash = ${emailHash})::text AS email_count,
        COUNT(*) FILTER (WHERE ip_hash = ${ipHash})::text AS ip_count,
        EXTRACT(EPOCH FROM (NOW() - MAX(requested_at)
          FILTER (WHERE email_hash = ${emailHash})))::text AS seconds_since_last
      FROM email_verification_requests
      WHERE requested_at > NOW() - INTERVAL '1 hour'
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

export async function createEmailVerificationChallenge(userId: string) {
  const challengeId = randomBytes(32).toString('base64url');
  const code = generateVerificationCode();
  const codeDigest = hashEmailVerificationCode(challengeId, code);
  const client = await db.connect();

  try {
    await client.sql`BEGIN`;
    await client.sql`
      UPDATE email_verification_challenges
      SET used_at = NOW()
      WHERE user_id = ${userId} AND used_at IS NULL
    `;
    await client.sql`
      INSERT INTO email_verification_challenges (
        challenge_id,
        user_id,
        code_digest,
        expires_at
      )
      VALUES (
        ${challengeId},
        ${userId},
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

export async function invalidateEmailVerificationChallenge(
  challengeId: string,
) {
  if (!VERIFICATION_CHALLENGE_PATTERN.test(challengeId)) return;

  await sql`
    UPDATE email_verification_challenges
    SET used_at = NOW()
    WHERE challenge_id = ${challengeId} AND used_at IS NULL
  `;
}

export async function verifyEmailCode(
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

    const initialChallenge = await client.sql<ChallengeRow>`
      SELECT
        email_verification_challenges.challenge_id,
        email_verification_challenges.code_digest,
        email_verification_challenges.expires_at,
        email_verification_challenges.used_at,
        users.id,
        users.email,
        users.first_name,
        users.email_verified_at
      FROM email_verification_challenges
      INNER JOIN users ON users.id = email_verification_challenges.user_id
      WHERE email_verification_challenges.challenge_id = ${challengeId}
      LIMIT 1
    `;
    const initialRow = initialChallenge.rows[0];

    if (!initialRow) {
      await client.sql`ROLLBACK`;
      return { status: 'invalid' };
    }

    await client.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${`verify-user:${initialRow.id}`}, 0))
    `;
    await client.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${`verify-attempt-ip:${ipHash}`}, 0))
    `;

    const challenge = await client.sql<ChallengeRow>`
      SELECT
        email_verification_challenges.challenge_id,
        email_verification_challenges.code_digest,
        email_verification_challenges.expires_at,
        email_verification_challenges.used_at,
        users.id,
        users.email,
        users.first_name,
        users.email_verified_at
      FROM email_verification_challenges
      INNER JOIN users ON users.id = email_verification_challenges.user_id
      WHERE email_verification_challenges.challenge_id = ${challengeId}
      FOR UPDATE OF email_verification_challenges
    `;
    const row = challenge.rows[0];

    if (!row || row.used_at || row.expires_at <= new Date()) {
      await client.sql`COMMIT`;
      return { status: 'invalid' };
    }

    const attempts = await client.sql<{
      user_count: string;
      ip_count: string;
    }>`
      SELECT
        COUNT(*) FILTER (WHERE user_id = ${row.id})::text AS user_count,
        COUNT(*) FILTER (WHERE ip_hash = ${ipHash})::text AS ip_count
      FROM email_verification_attempts
      WHERE successful = FALSE
        AND attempted_at > NOW() - INTERVAL '15 minutes'
    `;
    const counts = attempts.rows[0];

    if (
      Number(counts?.user_count ?? 0) >= 5 ||
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
      INSERT INTO email_verification_attempts (
        challenge_id,
        user_id,
        ip_hash,
        successful
      )
      VALUES (${challengeId}, ${row.id}, ${ipHash}, ${matches})
    `;

    if (!matches) {
      await client.sql`COMMIT`;
      return { status: 'invalid' };
    }

    await client.sql`
      UPDATE users
      SET email_verified_at = COALESCE(email_verified_at, NOW())
      WHERE id = ${row.id}
    `;
    await client.sql`
      UPDATE email_verification_challenges
      SET used_at = NOW()
      WHERE user_id = ${row.id} AND used_at IS NULL
    `;
    await client.sql`COMMIT`;

    return {
      status: 'verified',
      user: { ...row, email_verified_at: row.email_verified_at ?? new Date() },
    };
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
  return hashRateLimitKey(`email:${email}`);
}
