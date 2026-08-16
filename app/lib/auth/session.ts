import 'server-only';

import { cache } from 'react';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { hasRequiredRole, type AppRole } from './roles';

export const getVerifiedSession = cache(async () => {
  const session = await auth();

  if (
    !session?.user?.id ||
    session.emailVerified !== true ||
    session.sessionValid !== true
  ) {
    return null;
  }

  return session;
});

export async function requireVerifiedSession() {
  const session = await getVerifiedSession();

  if (!session) redirect('/login');

  return session;
}

export async function requireRole(requiredRole: AppRole) {
  const session = await requireVerifiedSession();

  if (!hasRequiredRole(session.role, requiredRole)) redirect('/dashboard');

  return session;
}

export function requireOwnerSession() {
  return requireRole('owner');
}
