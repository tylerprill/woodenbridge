import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { authConfig } from './auth.config';
import { z } from 'zod';
import { sql } from '@vercel/postgres';

import { loginPasswordSchema, normalizeEmail } from '@/app/lib/auth/password';
import {
  completeLoginAttempt,
  reserveLoginAttempt,
} from '@/app/lib/auth/auth-rate-limit';
import {
  DUMMY_PASSWORD_HASH,
  hashPassword,
  isLegacyPasswordHash,
  verifyPassword,
} from '@/app/lib/auth/password-hash';
import { getClientIpHash, hashRateLimitKey } from '@/app/lib/auth/security';
import { recordSecurityEvent } from '@/app/lib/auth/security-events';
import { upgradeUserPasswordHash } from '@/app/lib/data';
import type { AppRole } from '@/app/lib/auth/roles';

type AuthUserRow = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  password: string;
  session_version: number;
  email_verified_at: Date | null;
  role: AppRole;
};

type SessionStateRow = Pick<
  AuthUserRow,
  'session_version' | 'email_verified_at' | 'role'
>;

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
        role
      FROM users
      WHERE LOWER(email) = ${email}
      LIMIT 1
    `;
    return user.rows[0];
  } catch (error) {
    throw new Error('Failed to fetch user.');
  }
}

async function getSessionState(userId: string) {
  try {
    const result = await sql<SessionStateRow>`
      SELECT session_version, email_verified_at, role
      FROM users
      WHERE id = ${userId}
      LIMIT 1
    `;

    return result.rows[0]
      ? { status: 'found' as const, row: result.rows[0] }
      : { status: 'missing' as const };
  } catch (error) {
    console.error('Session validation failed:', error);
    return { status: 'error' as const };
  }
}

export const { auth, signIn, signOut } = NextAuth({
  ...authConfig,
  session: {
    strategy: 'jwt',
    maxAge: 60 * 60 * 12,
  },
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, user }) {
      if (user) {
        token.sessionVersion = user.sessionVersion;
        token.emailVerified = user.emailVerified;
        token.role = user.role;
      }

      if (!token.sub) return null;

      const sessionState = await getSessionState(token.sub);

      if (sessionState.status === 'missing') return null;

      if (sessionState.status === 'error') {
        token.sessionValid = false;
        return token;
      }

      token.emailVerified = Boolean(sessionState.row.email_verified_at);
      token.role = sessionState.row.role;
      token.sessionValid =
        typeof token.sessionVersion === 'number' &&
        sessionState.row.session_version === token.sessionVersion &&
        token.emailVerified;

      return token;
    },
    session({ session, token }) {
      session.user.id = token.sub ?? '';
      session.emailVerified = token.emailVerified === true;
      session.sessionValid = token.sessionValid === true;
      session.role = token.role === 'owner' ? 'owner' : 'user';
      return session;
    },
  },
  providers: [
    Credentials({
      async authorize(credentials) {
        const parsedCredentials = z
          .object({
            email: z.string().trim().max(254).email().transform(normalizeEmail),
            password: loginPasswordSchema,
          })
          .safeParse(credentials);

        if (parsedCredentials.success) {
          const { email, password } = parsedCredentials.data;
          const emailHash = hashRateLimitKey(`email:${email}`);
          const ipHash = await getClientIpHash();
          const attemptId = await reserveLoginAttempt(emailHash, ipHash);

          if (!attemptId) {
            recordSecurityEvent('login.rate_limited', 'limited');
            return null;
          }

          const user = await getUser(email);
          const passwordHash = user?.password ?? DUMMY_PASSWORD_HASH;
          const passwordsMatch = await verifyPassword(passwordHash, password);
          const successful = Boolean(user && passwordsMatch);

          await completeLoginAttempt({ attemptId, emailHash, successful });
          recordSecurityEvent(
            'login.attempt',
            successful ? 'success' : 'failure',
          );

          if (user && passwordsMatch) {
            if (isLegacyPasswordHash(user.password)) {
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

            return {
              id: user.id,
              email: user.email,
              name: `${user.first_name} ${user.last_name}`.trim(),
              sessionVersion: user.session_version,
              emailVerified: Boolean(user.email_verified_at),
              role: user.role,
            };
          }
        }

        return null;
      },
    }),
  ],
});
