import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    emailVerified: boolean;
    sessionValid: boolean;
    user: {
      id: string;
    } & DefaultSession['user'];
  }

  interface User {
    emailVerified: boolean;
    sessionVersion: number;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    emailVerified?: boolean;
    sessionVersion?: number;
    sessionValid?: boolean;
  }
}
