import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { authConfig } from './auth.config';

import { isAppRole } from '@/app/lib/auth/roles';
import { isAccountStatus } from '@/app/lib/auth/account-status';
import { authorizeCredentials } from '@/app/lib/auth/credentials';
import { getClientIpHash } from '@/app/lib/auth/security';
import {
  getAuthenticatedSessionState,
  hashSessionId,
  isAuthenticatedSessionRowValid,
  isSessionId,
  toEpochSeconds,
} from '@/app/lib/auth/session-record';
import { getAuthSessionSecret } from '@/app/lib/auth/secrets';
import { isMfaMethod } from '@/app/lib/auth/session-policy';

getAuthSessionSecret();

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
        token.accountStatus = user.accountStatus;
        token.authenticatedAt = user.authenticatedAt;
        token.sessionId = user.sessionId;
      }

      if (
        !token.sub ||
        !isSessionId(token.sessionId) ||
        typeof token.authenticatedAt !== 'number' ||
        typeof token.sessionVersion !== 'number'
      ) {
        return null;
      }

      const sessionState = await getAuthenticatedSessionState(
        token.sub,
        token.sessionId,
      );

      if (sessionState.status === 'missing') return null;

      if (sessionState.status === 'error') {
        token.sessionValid = false;
        return token;
      }

      token.emailVerified = Boolean(sessionState.row.email_verified_at);
      token.role = sessionState.row.role;
      token.accountStatus = sessionState.row.account_status;
      token.mfaVerifiedAt = sessionState.row.mfa_verified_at
        ? toEpochSeconds(sessionState.row.mfa_verified_at)
        : null;
      token.mfaMethod = isMfaMethod(sessionState.row.mfa_method)
        ? sessionState.row.mfa_method
        : null;

      if (
        !isAuthenticatedSessionRowValid(sessionState.row, {
          authenticatedAt: token.authenticatedAt,
          sessionVersion: token.sessionVersion,
        })
      ) {
        return null;
      }

      token.sessionValid = true;

      return token;
    },
    session({ session, token }) {
      session.user.id = token.sub ?? '';
      session.emailVerified = token.emailVerified === true;
      session.sessionValid = token.sessionValid === true;
      session.role = isAppRole(token.role) ? token.role : 'user';
      session.accountStatus = isAccountStatus(token.accountStatus)
        ? token.accountStatus
        : 'closed';
      session.authenticatedAt =
        typeof token.authenticatedAt === 'number' ? token.authenticatedAt : 0;
      session.sessionVersion =
        typeof token.sessionVersion === 'number' ? token.sessionVersion : -1;
      session.mfaVerifiedAt =
        typeof token.mfaVerifiedAt === 'number' ? token.mfaVerifiedAt : null;
      session.mfaMethod = isMfaMethod(token.mfaMethod) ? token.mfaMethod : null;
      session.sessionReference = isSessionId(token.sessionId)
        ? hashSessionId(token.sessionId)
        : '';
      return session;
    },
  },
  providers: [
    Credentials({
      async authorize(credentials) {
        return authorizeCredentials(credentials, getClientIpHash);
      },
    }),
  ],
});
