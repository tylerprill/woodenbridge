'use client';

import { ArrowRightOnRectangleIcon } from '@heroicons/react/24/outline';
import { useTransition } from 'react';

import { logOut } from '@/app/lib/actions/auth';

export function HeaderLogoutButton() {
  const [pending, startTransition] = useTransition();

  return (
    <button
      className="header-logout"
      type="button"
      aria-label={pending ? 'Signing out' : 'Sign out'}
      title={pending ? 'Signing out…' : 'Sign out'}
      disabled={pending}
      onClick={() => {
        startTransition(() => logOut({ redirectTo: '/' }));
      }}
    >
      <ArrowRightOnRectangleIcon aria-hidden="true" />
    </button>
  );
}
