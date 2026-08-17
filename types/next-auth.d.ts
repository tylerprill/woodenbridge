import type { DefaultSession } from 'next-auth';
import type { AppRole } from '@/app/lib/auth/roles';
import type { AccountStatus } from '@/app/lib/auth/account-status';
import type { MfaMethod } from '@/app/lib/auth/session-policy';

declare module 'next-auth' {
  interface Session {
    emailVerified: boolean;
    sessionValid: boolean;
    role: AppRole;
    accountStatus: AccountStatus;
    authenticatedAt: number;
    sessionVersion: number;
    mfaMethod: MfaMethod | null;
    mfaVerifiedAt: number | null;
    sessionReference: string;
    user: {
      id: string;
    } & DefaultSession['user'];
  }

  interface User {
    emailVerified: boolean;
    sessionVersion: number;
    role: AppRole;
    accountStatus: AccountStatus;
    authenticatedAt: number;
    sessionId: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    emailVerified?: boolean;
    sessionVersion?: number;
    sessionValid?: boolean;
    role?: AppRole;
    accountStatus?: AccountStatus;
    authenticatedAt?: number;
    mfaMethod?: MfaMethod | null;
    mfaVerifiedAt?: number | null;
    sessionId?: string;
  }
}
