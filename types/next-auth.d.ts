import type { DefaultSession } from 'next-auth';
import type { AppRole } from '@/app/lib/auth/roles';

declare module 'next-auth' {
  interface Session {
    emailVerified: boolean;
    sessionValid: boolean;
    role: AppRole;
    user: {
      id: string;
    } & DefaultSession['user'];
  }

  interface User {
    emailVerified: boolean;
    sessionVersion: number;
    role: AppRole;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    emailVerified?: boolean;
    sessionVersion?: number;
    sessionValid?: boolean;
    role?: AppRole;
  }
}
