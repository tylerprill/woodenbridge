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
};

async function getUser(email: string): Promise<AuthUserRow | undefined> {
  try {
    const user = await sql<AuthUserRow>`
      SELECT id, first_name, last_name, email, password, session_version
      FROM users
      WHERE LOWER(email) = ${email}
      LIMIT 1
    `;
    return user.rows[0];
  } catch (error) {
    throw new Error('Failed to fetch user.');
  }
}

async function sessionVersionIsCurrent(userId: string, sessionVersion: number) {
  try {
    const result = await sql<{ session_version: number }>`
      SELECT session_version
      FROM users
      WHERE id = ${userId}
      LIMIT 1
    `;

    return result.rows[0]?.session_version === sessionVersion;
  } catch (error) {
    console.error('Session validation failed:', error);
    return false;
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

      token.sessionValid =
        Boolean(token.sub) &&
        typeof token.sessionVersion === 'number' &&
        (await sessionVersionIsCurrent(token.sub!, token.sessionVersion));

      return token;
    },
    session({ session, token }) {
      session.user.id = token.sub ?? '';
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
            };
          }
        }

        return null;
      },
    }),
  ],
});
