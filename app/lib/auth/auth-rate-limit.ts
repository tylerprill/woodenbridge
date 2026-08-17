import 'server-only';

import { db, sql } from '@/app/lib/db';

export const LOGIN_LIMITS = {
  emailAttempts: 20,
  emailFailures: 10,
  ipAttempts: 60,
  ipFailures: 30,
  windowMinutes: 15,
} as const;

export const SIGNUP_LIMITS = {
  emailRequests: 5,
  ipRequests: 20,
  windowMinutes: 60,
} as const;

export function isLoginAttemptAllowed(
  emailFailures: number,
  ipFailures: number,
  emailAttempts: number,
  ipAttempts: number,
) {
  return (
    emailFailures < LOGIN_LIMITS.emailFailures &&
    ipFailures < LOGIN_LIMITS.ipFailures &&
    emailAttempts < LOGIN_LIMITS.emailAttempts &&
    ipAttempts < LOGIN_LIMITS.ipAttempts
  );
}

export function isAccountCreationAllowed(
  emailRequests: number,
  ipRequests: number,
) {
  return (
    emailRequests < SIGNUP_LIMITS.emailRequests &&
    ipRequests < SIGNUP_LIMITS.ipRequests
  );
}

export async function reserveLoginAttempt(emailHash: string, ipHash: string) {
  const client = await db.connect();

  try {
    await client.sql`BEGIN`;
    await client.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${`login-email:${emailHash}`}, 0))
    `;
    await client.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${`login-ip:${ipHash}`}, 0))
    `;

    const attempts = await client.sql<{
      email_attempt_count: string;
      email_count: string;
      ip_attempt_count: string;
      ip_count: string;
    }>`
      SELECT
        (
          SELECT COUNT(*)::text
          FROM login_attempts
          WHERE email_hash = ${emailHash}
            AND successful = FALSE
            AND completed_at IS NOT NULL
            AND failure_cleared_at IS NULL
            AND attempted_at > NOW() - (${LOGIN_LIMITS.windowMinutes} * INTERVAL '1 minute')
        ) AS email_count,
        (
          SELECT COUNT(*)::text
          FROM login_attempts
          WHERE ip_hash = ${ipHash}
            AND successful = FALSE
            AND completed_at IS NOT NULL
            AND failure_cleared_at IS NULL
            AND attempted_at > NOW() - (${LOGIN_LIMITS.windowMinutes} * INTERVAL '1 minute')
        ) AS ip_count,
        (
          SELECT COUNT(*)::text
          FROM login_attempts
          WHERE email_hash = ${emailHash}
            AND attempted_at > NOW() - (${LOGIN_LIMITS.windowMinutes} * INTERVAL '1 minute')
        ) AS email_attempt_count,
        (
          SELECT COUNT(*)::text
          FROM login_attempts
          WHERE ip_hash = ${ipHash}
            AND attempted_at > NOW() - (${LOGIN_LIMITS.windowMinutes} * INTERVAL '1 minute')
        ) AS ip_attempt_count
    `;
    const counts = attempts.rows[0];
    const allowed = isLoginAttemptAllowed(
      Number(counts?.email_count ?? 0),
      Number(counts?.ip_count ?? 0),
      Number(counts?.email_attempt_count ?? 0),
      Number(counts?.ip_attempt_count ?? 0),
    );

    if (!allowed) {
      await client.sql`COMMIT`;
      return undefined;
    }

    const reservation = await client.sql<{ id: string }>`
      INSERT INTO login_attempts (email_hash, ip_hash)
      VALUES (${emailHash}, ${ipHash})
      RETURNING id::text
    `;
    await client.sql`COMMIT`;
    return reservation.rows[0]?.id;
  } catch (error) {
    await client.sql`ROLLBACK`;
    throw error;
  } finally {
    client.release();
  }
}

export async function completeLoginAttempt({
  attemptId,
  emailHash,
  successful,
}: {
  attemptId: string;
  emailHash: string;
  successful: boolean;
}) {
  const client = await db.connect();

  try {
    await client.sql`BEGIN`;
    await client.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${`login-email:${emailHash}`}, 0))
    `;

    const completed = await client.sql<{ id: string }>`
      UPDATE login_attempts
      SET
        successful = ${successful},
        completed_at = clock_timestamp()
      WHERE id = ${attemptId}
        AND email_hash = ${emailHash}
        AND completed_at IS NULL
      RETURNING id::text
    `;

    if (successful && completed.rows[0]) {
      await client.sql`
        UPDATE login_attempts
        SET failure_cleared_at = clock_timestamp()
        WHERE email_hash = ${emailHash}
          AND successful = FALSE
          AND completed_at IS NOT NULL
          AND failure_cleared_at IS NULL
      `;
    }

    await client.sql`COMMIT`;
  } catch (error) {
    await client.sql`ROLLBACK`;
    throw error;
  } finally {
    client.release();
  }
}

export async function recordAccountCreationRequest(
  emailHash: string,
  ipHash: string,
) {
  const client = await db.connect();

  try {
    await client.sql`BEGIN`;
    await client.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${`signup-email:${emailHash}`}, 0))
    `;
    await client.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${`signup-ip:${ipHash}`}, 0))
    `;

    const requests = await client.sql<{
      email_count: string;
      ip_count: string;
    }>`
      SELECT
        (
          SELECT COUNT(*)::text
          FROM account_creation_requests
          WHERE email_hash = ${emailHash}
            AND requested_at > NOW() - (${SIGNUP_LIMITS.windowMinutes} * INTERVAL '1 minute')
        ) AS email_count,
        (
          SELECT COUNT(*)::text
          FROM account_creation_requests
          WHERE ip_hash = ${ipHash}
            AND requested_at > NOW() - (${SIGNUP_LIMITS.windowMinutes} * INTERVAL '1 minute')
        ) AS ip_count
    `;
    const counts = requests.rows[0];
    const allowed = isAccountCreationAllowed(
      Number(counts?.email_count ?? 0),
      Number(counts?.ip_count ?? 0),
    );

    if (allowed) {
      await client.sql`
        INSERT INTO account_creation_requests (email_hash, ip_hash)
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

export async function deleteExpiredAuthRateLimitData() {
  await Promise.all([
    sql`
      DELETE FROM login_attempts
      WHERE attempted_at < NOW() - INTERVAL '1 day'
    `,
    sql`
      DELETE FROM account_creation_requests
      WHERE requested_at < NOW() - INTERVAL '1 day'
    `,
  ]);
}
