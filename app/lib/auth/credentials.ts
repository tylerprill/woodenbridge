import 'server-only';

import { z } from 'zod';

import { sql } from '@/app/lib/db';
import {
  canAccountAuthenticate,
  type AccountStatus,
} from '@/app/lib/auth/account-status';
import {
  completeLoginAttempt,
  reserveLoginAttempt,
} from '@/app/lib/auth/auth-rate-limit';
import { loginPasswordSchema, normalizeEmail } from '@/app/lib/auth/password';
import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  needsPasswordRehash,
  verifyPassword,
} from '@/app/lib/auth/password-hash';
import type { AppRole } from '@/app/lib/auth/roles';
import { hashRateLimitKey } from '@/app/lib/auth/security';
import { recordSecurityEvent } from '@/app/lib/auth/security-events';
import {
  SessionCapacityError,
  createAuthenticatedSession,
} from '@/app/lib/auth/session-record';
import { upgradeUserPasswordHash } from '@/app/lib/data';

const credentialsSchema = z.object({
  email: z.string().trim().max(254).email().transform(normalizeEmail),
  password: loginPasswordSchema,
});
const IP_HASH_PATTERN = /^[a-f0-9]{64}$/;

type AuthUserRow = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  password: string;
  session_version: number;
  email_verified_at: Date | null;
  role: AppRole;
  account_status: AccountStatus;
};

export type AuthorizedCredentialsUser = {
  accountStatus: AccountStatus;
  authenticatedAt: number;
  email: string;
  emailVerified: true;
  id: string;
  name: string;
  role: AppRole;
  sessionId: string;
  sessionVersion: number;
};

async function getUser(email: string): Promise<AuthUserRow | undefined> {
  try {
    const user = await sql<AuthUserRow>`
      SELECT
        id,
        first_name,
        last_name,
        email,
        password,
        session_version,
        email_verified_at,
        role,
        account_status
      FROM users
      WHERE LOWER(email) = ${email}
      LIMIT 1
    `;
    return user.rows[0];
  } catch {
    throw new Error('Failed to fetch user.');
  }
}

/**
 * The server-only credential boundary used by Auth.js and PostgreSQL
 * integration tests. Callers supply a request-derived, one-way IP hash or a
 * lazy resolver for it; raw client addresses never enter authentication data.
 */
export async function authorizeCredentials(
  credentials: unknown,
  ipHashInput: string | (() => Promise<string>),
): Promise<AuthorizedCredentialsUser | null> {
  const parsedCredentials = credentialsSchema.safeParse(credentials);

  if (!parsedCredentials.success) return null;

  const ipHash =
    typeof ipHashInput === 'function' ? await ipHashInput() : ipHashInput;

  if (!IP_HASH_PATTERN.test(ipHash)) return null;

  const { email, password } = parsedCredentials.data;
  const emailHash = hashRateLimitKey(`email:${email}`);
  const attemptId = await reserveLoginAttempt(emailHash, ipHash);

  if (!attemptId) {
    recordSecurityEvent('login.rate_limited', 'limited');
    return null;
  }

  const user = await getUser(email);
  const passwordHash = user?.password ?? DUMMY_PASSWORD_HASH;
  const passwordsMatch = await verifyPassword(passwordHash, password);
  const successful = Boolean(
    user &&
    passwordsMatch &&
    canAccountAuthenticate(user.account_status, user.email_verified_at),
  );

  await completeLoginAttempt({ attemptId, emailHash, successful });

  if (!user || !passwordsMatch || !successful) {
    recordSecurityEvent('login.attempt', 'failure');
    return null;
  }

  if (needsPasswordRehash(user.password)) {
    try {
      await upgradeUserPasswordHash(
        user.id,
        user.password,
        await hashPassword(password),
      );
    } catch (error) {
      console.error('Password hash migration failed:', error);
    }
  }

  let authenticatedSession;

  try {
    authenticatedSession = await createAuthenticatedSession(user.id, user.role);
  } catch (error) {
    recordSecurityEvent('login.attempt', 'failure');
    if (error instanceof SessionCapacityError) return null;
    throw error;
  }

  recordSecurityEvent('login.attempt', 'success');

  return {
    id: user.id,
    email: user.email,
    name: `${user.first_name} ${user.last_name}`.trim(),
    sessionVersion: user.session_version,
    emailVerified: true,
    role: user.role,
    accountStatus: user.account_status,
    ...authenticatedSession,
  };
}
