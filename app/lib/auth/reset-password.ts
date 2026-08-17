import { createHash, randomBytes } from 'node:crypto';

import { db, sql } from '@/app/lib/db';

import { hashRateLimitKey } from '@/app/lib/auth/security';
import { enqueueSecurityNotificationWithinTransaction } from '@/app/lib/auth/security-notification-outbox';

const RESET_TOKEN_TTL_MINUTES = 30;
const RESET_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

type RecoveryUser = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
};

type ResetTokenUser = RecoveryUser & {
  user_id: string;
};

export function hashResetToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function isValidTokenShape(token: string) {
  return RESET_TOKEN_PATTERN.test(token);
}

export async function findRecoveryUser(email: string) {
  const result = await sql<RecoveryUser>`
    SELECT id, email, first_name, last_name
    FROM users
    WHERE LOWER(email) = ${email}
      AND email_verified_at IS NOT NULL
      AND account_status = 'active'
    LIMIT 1
  `;

  return result.rows[0];
}

export async function findPasswordResetContext(token: string) {
  if (!isValidTokenShape(token)) return undefined;

  const tokenHash = hashResetToken(token);
  const result = await sql<RecoveryUser>`
    SELECT users.id, users.email, users.first_name, users.last_name
    FROM password_reset_tokens
    INNER JOIN users ON users.id = password_reset_tokens.user_id
    WHERE password_reset_tokens.token_hash = ${tokenHash}
      AND password_reset_tokens.used_at IS NULL
      AND password_reset_tokens.expires_at > NOW()
      AND users.email_verified_at IS NOT NULL
      AND users.account_status = 'active'
    LIMIT 1
  `;

  return result.rows[0];
}

export async function recordPasswordResetRequest(
  emailHash: string,
  ipHash: string,
) {
  const client = await db.connect();

  try {
    await client.sql`BEGIN`;
    await client.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${`reset-email:${emailHash}`}, 0))
    `;
    await client.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${`reset-ip:${ipHash}`}, 0))
    `;

    const limits = await client.sql<{ email_count: string; ip_count: string }>`
      SELECT
        (
          SELECT COUNT(*)::text
          FROM password_reset_requests
          WHERE email_hash = ${emailHash}
            AND requested_at > NOW() - INTERVAL '1 hour'
        ) AS email_count,
        (
          SELECT COUNT(*)::text
          FROM password_reset_requests
          WHERE ip_hash = ${ipHash}
            AND requested_at > NOW() - INTERVAL '1 hour'
        ) AS ip_count
    `;

    const counts = limits.rows[0];
    const allowed =
      Number(counts?.email_count ?? 0) < 3 &&
      Number(counts?.ip_count ?? 0) < 20;

    if (allowed) {
      await client.sql`
        INSERT INTO password_reset_requests (email_hash, ip_hash)
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

export async function createPasswordResetToken(userId: string) {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = hashResetToken(token);

  const client = await db.connect();

  try {
    await client.sql`BEGIN`;
    await client.sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`password-reset-user:${userId}`}, 0)
      )
    `;
    const eligibleUser = await client.sql`
      SELECT 1
      FROM users
      WHERE id = ${userId}
        AND email_verified_at IS NOT NULL
        AND account_status = 'active'
      FOR UPDATE
    `;

    if (eligibleUser.rowCount !== 1) {
      await client.sql`ROLLBACK`;
      return undefined;
    }

    await client.sql`
      UPDATE password_reset_tokens
      SET used_at = NOW()
      WHERE user_id = ${userId} AND used_at IS NULL
    `;
    await client.sql`
      INSERT INTO password_reset_tokens (token_hash, user_id, expires_at)
      VALUES (
        ${tokenHash},
        ${userId},
        NOW() + (${RESET_TOKEN_TTL_MINUTES} * INTERVAL '1 minute')
      )
    `;
    await client.sql`COMMIT`;

    return { token, tokenHash };
  } catch (error) {
    await client.sql`ROLLBACK`;
    throw error;
  } finally {
    client.release();
  }
}

export async function invalidatePasswordResetToken(tokenHash: string) {
  await sql`
    UPDATE password_reset_tokens
    SET used_at = NOW()
    WHERE token_hash = ${tokenHash} AND used_at IS NULL
  `;
}

export async function isPasswordResetTokenValid(token: string) {
  if (!isValidTokenShape(token)) return false;

  const tokenHash = hashResetToken(token);
  const result = await sql`
    SELECT 1
    FROM password_reset_tokens
    INNER JOIN users ON users.id = password_reset_tokens.user_id
    WHERE token_hash = ${tokenHash}
      AND used_at IS NULL
      AND expires_at > NOW()
      AND users.email_verified_at IS NOT NULL
      AND users.account_status = 'active'
    LIMIT 1
  `;

  return result.rowCount === 1;
}

export async function recordPasswordResetAttempt(
  tokenHash: string,
  ipHash: string,
) {
  const client = await db.connect();

  try {
    await client.sql`BEGIN`;
    await client.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${`reset-attempt-token:${tokenHash}`}, 0))
    `;
    await client.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${`reset-attempt-ip:${ipHash}`}, 0))
    `;

    const limits = await client.sql<{ token_count: string; ip_count: string }>`
      SELECT
        (
          SELECT COUNT(*)::text
          FROM password_reset_attempts
          WHERE token_hash = ${tokenHash}
            AND attempted_at > NOW() - INTERVAL '15 minutes'
        ) AS token_count,
        (
          SELECT COUNT(*)::text
          FROM password_reset_attempts
          WHERE ip_hash = ${ipHash}
            AND attempted_at > NOW() - INTERVAL '15 minutes'
        ) AS ip_count
    `;

    const counts = limits.rows[0];
    const allowed =
      Number(counts?.token_count ?? 0) < 5 &&
      Number(counts?.ip_count ?? 0) < 20;

    if (allowed) {
      await client.sql`
        INSERT INTO password_reset_attempts (token_hash, ip_hash)
        VALUES (${tokenHash}, ${ipHash})
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

export async function consumePasswordResetToken(
  token: string,
  hashedPassword: string,
) {
  if (!isValidTokenShape(token)) return undefined;

  const tokenHash = hashResetToken(token);
  const client = await db.connect();

  try {
    await client.sql`BEGIN`;
    const candidate = await client.sql<{ user_id: string }>`
      SELECT password_reset_tokens.user_id
      FROM password_reset_tokens
      INNER JOIN users ON users.id = password_reset_tokens.user_id
      WHERE password_reset_tokens.token_hash = ${tokenHash}
        AND password_reset_tokens.used_at IS NULL
        AND password_reset_tokens.expires_at > NOW()
        AND users.email_verified_at IS NOT NULL
        AND users.account_status = 'active'
      LIMIT 1
    `;
    const candidateUserId = candidate.rows[0]?.user_id;

    if (!candidateUserId) {
      await client.sql`ROLLBACK`;
      return undefined;
    }

    // Token issuance and redemption share one account-scoped lock. Re-read all
    // eligibility under the lock so an issuance, suspension, or prior
    // redemption that won the race cannot be accepted from a stale snapshot.
    await client.sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`password-reset-user:${candidateUserId}`}, 0)
      )
    `;
    const tokenResult = await client.sql<ResetTokenUser>`
      SELECT
        password_reset_tokens.user_id,
        users.id,
        users.email,
        users.first_name,
        users.last_name
      FROM password_reset_tokens
      INNER JOIN users ON users.id = password_reset_tokens.user_id
      WHERE password_reset_tokens.token_hash = ${tokenHash}
        AND password_reset_tokens.used_at IS NULL
        AND password_reset_tokens.expires_at > NOW()
        AND users.email_verified_at IS NOT NULL
        AND users.account_status = 'active'
      FOR UPDATE OF password_reset_tokens, users
    `;
    const resetUser = tokenResult.rows[0];

    if (!resetUser) {
      await client.sql`ROLLBACK`;
      return undefined;
    }

    await client.sql`
      UPDATE users
      SET password = ${hashedPassword}, session_version = session_version + 1
      WHERE id = ${resetUser.user_id}
    `;
    await client.sql`
      UPDATE auth_sessions
      SET revoked_at = COALESCE(revoked_at, NOW())
      WHERE user_id = ${resetUser.user_id}
        AND revoked_at IS NULL
    `;
    await client.sql`
      UPDATE password_reset_tokens
      SET used_at = NOW()
      WHERE user_id = ${resetUser.user_id} AND used_at IS NULL
    `;
    await enqueueSecurityNotificationWithinTransaction(client, {
      userId: resetUser.user_id,
      kind: 'password_changed',
      changeId: tokenHash,
      payload: {},
    });
    await client.sql`COMMIT`;

    return resetUser;
  } catch (error) {
    await client.sql`ROLLBACK`;
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteExpiredPasswordResetData() {
  await Promise.all([
    sql`
      DELETE FROM password_reset_tokens
      WHERE expires_at < NOW() - INTERVAL '1 day'
    `,
    sql`
      DELETE FROM password_reset_requests
      WHERE requested_at < NOW() - INTERVAL '1 day'
    `,
    sql`
      DELETE FROM password_reset_attempts
      WHERE attempted_at < NOW() - INTERVAL '1 day'
    `,
  ]);
}
