'use client';

import { ArrowRightOnRectangleIcon } from '@heroicons/react/24/outline';

import { logOut } from '@/app/lib/actions/auth';
import type { AppRole } from '@/app/lib/auth/roles';
import { BrandLockup } from '@/components/clean/brand-lockup';
import NavLinks from '@/components/unclean/dashboard/nav-links';

type SideNavProps = {
  userEmail?: string | null;
  userName?: string | null;
  role: AppRole;
};

export default function SideNav({ userEmail, userName, role }: SideNavProps) {
  const displayName = userName?.trim() || 'Explorer';
  const initial = displayName.charAt(0).toUpperCase();

  return (
    <aside className="dashboard-sidebar">
      <div className="dashboard-sidebar-inner">
        <BrandLockup className="dashboard-brand" label="Personal atlas" />

        <nav className="dashboard-nav" aria-label="Dashboard navigation">
          <NavLinks role={role} />
        </nav>

        <div className="dashboard-account">
          <span className="dashboard-avatar" aria-hidden="true">
            {initial}
          </span>
          <span className="dashboard-account-copy">
            <strong>{displayName}</strong>
            <small>{userEmail ?? 'Your account'}</small>
          </span>
          <button
            type="button"
            onClick={() => logOut({ redirectTo: '/' })}
            aria-label="Sign out"
          >
            <ArrowRightOnRectangleIcon aria-hidden="true" />
          </button>
        </div>
      </div>
    </aside>
  );
}
