import 'server-only';

import { cache } from 'react';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';
import { hasRequiredRole, type AppRole } from './roles';
import { hasUserPasskey } from './passkey-state';
import { isPasskeyVerificationRecent } from './session-policy';

export const getVerifiedSession = cache(async () => {
  const session = await auth();

  if (
    !session?.user?.id ||
    session.emailVerified !== true ||
    session.accountStatus !== 'active' ||
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

export async function requirePrivilegedStepUp(
  returnTo = '/dashboard/owner/users',
) {
  return requireRecentPasskeyStepUp(returnTo, '/dashboard/owner/users');
}

export async function requireRecentPasskeyStepUp(
  returnTo = '/dashboard/security',
  fallbackReturnTo = '/dashboard/security',
) {
  const session = await requireRole('admin');
  const safeReturnTo =
    returnTo.startsWith('/dashboard/') && !returnTo.startsWith('//')
      ? returnTo
      : fallbackReturnTo;
  const hasPasskey = await hasUserPasskey(session.user.id);

  if (
    !hasPasskey ||
    !isPasskeyVerificationRecent(session.mfaVerifiedAt, session.mfaMethod)
  ) {
    redirect(
      `/dashboard/security?required=passkey&returnTo=${encodeURIComponent(safeReturnTo)}`,
    );
  }

  return session;
}
