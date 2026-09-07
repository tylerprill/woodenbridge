import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { sessionAuthConfig } from './auth.session-config';

export const { auth, signIn, signOut } = NextAuth({
  ...sessionAuthConfig,
  providers: [
    Credentials({
      async authorize(credentials) {
        const [{ authorizeCredentials }, { getClientIpHash }] =
          await Promise.all([
            import('@/app/lib/auth/credentials'),
            import('@/app/lib/auth/security'),
          ]);

        return authorizeCredentials(credentials, getClientIpHash);
      },
    }),
  ],
});
