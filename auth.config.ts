import type { NextAuthConfig } from 'next-auth';

export const authConfig = {
  pages: {
    signIn: '/login',
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const hasSession = !!auth?.user;
      const isLoggedIn =
        hasSession &&
        auth?.emailVerified === true &&
        auth?.accountStatus === 'active' &&
        auth.sessionValid === true;
      const isOnDashboard = nextUrl.pathname.startsWith('/dashboard');
      const isOnAuthPage = [
        '/forgot-password',
        '/login',
        '/sign-up',
        '/verify-email',
      ].includes(nextUrl.pathname);

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
