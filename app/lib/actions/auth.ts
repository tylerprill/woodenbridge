'use server';

import { auth, signOut } from '@/auth';
import {
  revokeAllAuthenticatedSessions,
  revokeAuthenticatedSession,
} from '@/app/lib/auth/session-record';

type LogoutOptions = { redirectTo?: string };

function getLogoutDestination(options?: LogoutOptions) {
  return options?.redirectTo === '/' ? '/' : '/login';
}

export async function logOut(options?: LogoutOptions) {
  const session = await auth();

  if (session?.user?.id && session.sessionReference) {
    await revokeAuthenticatedSession(session.user.id, session.sessionReference);
  }

  await signOut({ redirectTo: getLogoutDestination(options) });
}

export async function logOutEverywhere(options?: LogoutOptions) {
  const session = await auth();

  // A temporary validation failure must not turn "everywhere" into a local
  // cookie clear. If Auth.js can still identify the user, require durable
  // server-side revocation to succeed before ending the browser session.
  if (session?.user?.id) {
    await revokeAllAuthenticatedSessions(session.user.id);
  }

  await signOut({ redirectTo: getLogoutDestination(options) });
}
