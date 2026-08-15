import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    sessionValid: boolean;
    user: {
      id: string;
    } & DefaultSession['user'];
  }

  interface User {
    sessionVersion: number;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    sessionVersion?: number;
    sessionValid?: boolean;
  }
}
