import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { authConfig } from './auth.config';
import { z } from 'zod';
import { sql } from '@vercel/postgres';
import bcrypt from 'bcryptjs';

import { loginPasswordSchema, normalizeEmail } from '@/app/lib/auth/password';

type AuthUserRow = {
  id: string;
  first_name: string;
  last_name: string;
  email: string;
  password: string;
  session_version: number;
  email_verified_at: Date | null;
};

type SessionStateRow = Pick<
  AuthUserRow,
  'session_version' | 'email_verified_at'
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
        email_verified_at
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
      SELECT session_version, email_verified_at
      FROM users
      WHERE id = ${userId}
      LIMIT 1
    `;

    return result.rows[0];
  } catch (error) {
    console.error('Session validation failed:', error);
    return undefined;
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
      }

      const sessionState = token.sub
        ? await getSessionState(token.sub)
        : undefined;
      token.emailVerified = Boolean(sessionState?.email_verified_at);
      token.sessionValid =
        typeof token.sessionVersion === 'number' &&
        sessionState?.session_version === token.sessionVersion &&
        token.emailVerified;

      return token;
    },
    session({ session, token }) {
      session.user.id = token.sub ?? '';
      session.emailVerified = token.emailVerified === true;
      session.sessionValid = token.sessionValid === true;
      return session;
    },
  },
  providers: [
    Credentials({
      async authorize(credentials) {
        const parsedCredentials = z
          .object({
            email: z.string().trim().email().transform(normalizeEmail),
            password: loginPasswordSchema,
          })
          .safeParse(credentials);

        if (parsedCredentials.success) {
          const { email, password } = parsedCredentials.data;
          const user = await getUser(email);
          if (!user) return null;
          const passwordsMatch = await bcrypt.compare(password, user.password);

          if (passwordsMatch) {
            return {
              id: user.id,
              email: user.email,
              name: `${user.first_name} ${user.last_name}`.trim(),
              sessionVersion: user.session_version,
              emailVerified: Boolean(user.email_verified_at),
            };
          }
        }

        return null;
      },
    }),
  ],
});
