import type { NextAuthConfig } from 'next-auth';

export const authConfig = {
  pages: {
    signIn: '/login',
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const hasSession = !!auth?.user;
      const isEmailVerified = auth?.emailVerified === true;
      const isLoggedIn =
        hasSession && isEmailVerified && auth.sessionValid === true;
      const isOnDashboard = nextUrl.pathname.startsWith('/dashboard');
      const isOnVerificationPage = nextUrl.pathname === '/verify-email';
      const isOnAuthPage = [
        '/forgot-password',
        '/login',
        '/sign-up',
        '/verify-email',
      ].includes(nextUrl.pathname);

      if (hasSession && !isEmailVerified) {
        if (isOnVerificationPage) return true;
        return Response.redirect(new URL('/verify-email', nextUrl));
      }

      if (isOnDashboard) {
        return isLoggedIn;
      }

      if (isLoggedIn && isOnAuthPage) {
        return Response.redirect(new URL('/dashboard', nextUrl));
      }

      return true;
    },
  },
  providers: [],
} satisfies NextAuthConfig;
