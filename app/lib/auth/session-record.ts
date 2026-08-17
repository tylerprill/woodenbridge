import 'server-only';

import { createHash, randomBytes } from 'node:crypto';

import { db, sql } from '@/app/lib/db';

import {
  isAccountStatus,
  type AccountStatus,
} from '@/app/lib/auth/account-status';
import { isAppRole, type AppRole } from '@/app/lib/auth/roles';
import type { MfaMethod } from '@/app/lib/auth/session-policy';

const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SESSION_REFERENCE_PATTERN = /^[a-f0-9]{64}$/;

export const SESSION_ABSOLUTE_LIFETIME_SECONDS: Record<AppRole, number> = {
  user: 60 * 60 * 24 * 7,
  admin: 60 * 60 * 24,
  owner: 60 * 60 * 24,
};

/**
 * A bounded device/session list prevents a valid credential from growing the
 * live session set indefinitely. The oldest active session is retired when a
 * new login would exceed this ceiling.
 */
export const MAX_ACTIVE_AUTHENTICATED_SESSIONS_PER_USER = 10;

export class SessionCapacityError extends Error {
  constructor() {
    super('No additional authenticated session is available.');
    this.name = 'SessionCapacityError';
  }
}

export type AuthenticatedSessionClaims = {
  authenticatedAt: number;
  sessionVersion: number;
};

export type AuthenticatedSessionRow = {
  account_status: AccountStatus;
  absolute_expires_at: Date;
  authenticated_at: Date;
  email_verified_at: Date | null;
  mfa_method: MfaMethod | null;
  mfa_verified_at: Date | null;
  revoked_at: Date | null;
  role: AppRole;
  session_version: number;
};

export type AuthenticatedSessionState =
  | { status: 'error' }
  | { status: 'missing' }
  | { status: 'found'; row: AuthenticatedSessionRow };

export function createSessionId() {
  return randomBytes(32).toString('base64url');
}

export function isSessionId(value: unknown): value is string {
  return typeof value === 'string' && SESSION_ID_PATTERN.test(value);
}

export function isSessionReference(value: unknown): value is string {
  return typeof value === 'string' && SESSION_REFERENCE_PATTERN.test(value);
}

export function hashSessionId(sessionId: string) {
  return createHash('sha256').update(sessionId).digest('hex');
}

export function toEpochSeconds(value: Date) {
  return Math.floor(value.getTime() / 1_000);
}

export function getSessionAbsoluteExpiration(
  role: AppRole,
  authenticatedAt: Date,
) {
  return new Date(
    authenticatedAt.getTime() + SESSION_ABSOLUTE_LIFETIME_SECONDS[role] * 1_000,
  );
}

export function isAuthenticatedSessionRowValid(
  row: AuthenticatedSessionRow,
  claims: AuthenticatedSessionClaims,
  now = new Date(),
) {
  return (
    isAccountStatus(row.account_status) &&
    row.account_status === 'active' &&
    isAppRole(row.role) &&
    Boolean(row.email_verified_at) &&
    row.revoked_at === null &&
    row.absolute_expires_at > now &&
    row.session_version === claims.sessionVersion &&
    toEpochSeconds(row.authenticated_at) === claims.authenticatedAt
  );
}

export async function createAuthenticatedSession(
  userId: string,
  role: AppRole,
  now = new Date(),
) {
  const sessionId = createSessionId();
  const sessionReference = hashSessionId(sessionId);
  const absoluteExpiresAt = getSessionAbsoluteExpiration(role, now);
  const client = await db.connect();

  try {
    await client.sql`BEGIN`;
    await client.sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`auth-session-user:${userId}`}, 0)
      )
    `;
    await client.sql`
      INSERT INTO auth_sessions (
        session_hash,
        user_id,
        authenticated_at,
        absolute_expires_at
      )
      VALUES (
        ${sessionReference},
        ${userId},
        ${now.toISOString()},
        ${absoluteExpiresAt.toISOString()}
      )
    `;
    const retiredSessions = await client.sql<{ session_hash: string }>`
      WITH ranked_active_sessions AS (
        SELECT
          session_hash,
          ROW_NUMBER() OVER (
            ORDER BY
              (mfa_verified_at IS NOT NULL) DESC,
              (session_hash = ${sessionReference}) DESC,
              authenticated_at DESC,
              created_at DESC,
              session_hash DESC
          ) AS active_rank
        FROM auth_sessions
        WHERE user_id = ${userId}
          AND revoked_at IS NULL
          AND absolute_expires_at > NOW()
      )
      UPDATE auth_sessions AS stored_session
      SET revoked_at = COALESCE(stored_session.revoked_at, NOW())
      FROM ranked_active_sessions AS ranked
      WHERE stored_session.session_hash = ranked.session_hash
        AND ranked.active_rank > ${MAX_ACTIVE_AUTHENTICATED_SESSIONS_PER_USER}
      RETURNING stored_session.session_hash
    `;

    if (
      retiredSessions.rows.some(
        (session) => session.session_hash === sessionReference,
      )
    ) {
      throw new SessionCapacityError();
    }

    await client.sql`COMMIT`;
  } catch (error) {
    await client.sql`ROLLBACK`.catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  return {
    authenticatedAt: toEpochSeconds(now),
    sessionId,
  };
}

export async function getAuthenticatedSessionState(
  userId: string,
  sessionId: unknown,
): Promise<AuthenticatedSessionState> {
  if (!isSessionId(sessionId)) return { status: 'missing' };

  try {
    const result = await sql<AuthenticatedSessionRow>`
      SELECT
        users.session_version,
        users.email_verified_at,
        users.role,
        users.account_status,
        auth_sessions.authenticated_at,
        auth_sessions.absolute_expires_at,
        auth_sessions.mfa_method,
        auth_sessions.mfa_verified_at,
        auth_sessions.revoked_at
      FROM auth_sessions
      INNER JOIN users ON users.id = auth_sessions.user_id
      WHERE auth_sessions.session_hash = ${hashSessionId(sessionId)}
        AND auth_sessions.user_id = ${userId}
      LIMIT 1
    `;

    return result.rows[0]
      ? { status: 'found', row: result.rows[0] }
      : { status: 'missing' };
  } catch (error) {
    console.error('Session validation failed:', error);
    return { status: 'error' };
  }
}

export async function revokeAuthenticatedSession(
  userId: string,
  sessionReference: string,
) {
  if (!isSessionReference(sessionReference)) return false;

  const result = await sql<{ session_hash: string }>`
    UPDATE auth_sessions
    SET revoked_at = COALESCE(revoked_at, NOW())
    WHERE session_hash = ${sessionReference}
      AND user_id = ${userId}
    RETURNING session_hash
  `;

  return result.rowCount === 1;
}

export async function revokeAllAuthenticatedSessions(userId: string) {
  const client = await db.connect();

  try {
    await client.sql`BEGIN`;
    await client.sql`
      UPDATE auth_sessions
      SET revoked_at = COALESCE(revoked_at, NOW())
      WHERE user_id = ${userId}
        AND revoked_at IS NULL
    `;
    await client.sql`
      UPDATE users
      SET session_version = session_version + 1
      WHERE id = ${userId}
    `;
    await client.sql`COMMIT`;
  } catch (error) {
    await client.sql`ROLLBACK`;
    throw error;
  } finally {
    client.release();
  }
}

export async function markAuthenticatedSessionMfaVerified(
  userId: string,
  sessionReference: string,
  verifiedAt = new Date(),
  method: MfaMethod = 'passkey',
) {
  if (!isSessionReference(sessionReference)) return false;
  const client = await db.connect();

  try {
    await client.sql`BEGIN`;
    await client.sql`
      SELECT pg_advisory_xact_lock(
        hashtextextended(${`auth-session-user:${userId}`}, 0)
      )
    `;
    const result = await client.sql<{ session_hash: string }>`
      UPDATE auth_sessions
      SET
        mfa_verified_at = ${verifiedAt.toISOString()},
        mfa_method = ${method}
      WHERE session_hash = ${sessionReference}
        AND user_id = ${userId}
        AND revoked_at IS NULL
        AND absolute_expires_at > NOW()
      RETURNING session_hash
    `;
    await client.sql`COMMIT`;

    return result.rowCount === 1;
  } catch (error) {
    await client.sql`ROLLBACK`.catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteExpiredAuthenticatedSessions() {
  await sql`
    DELETE FROM auth_sessions
    WHERE absolute_expires_at < NOW() - INTERVAL '1 day'
       OR revoked_at < NOW() - INTERVAL '1 day'
  `;
}
