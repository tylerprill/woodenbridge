import NextAuth from 'next-auth';

import { sessionAuthConfig } from './auth.session-config';

export const { auth, signOut } = NextAuth(sessionAuthConfig);
