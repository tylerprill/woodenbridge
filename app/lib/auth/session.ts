import 'server-only';

import { cache } from 'react';
import { redirect } from 'next/navigation';

import { auth } from '@/auth';

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
