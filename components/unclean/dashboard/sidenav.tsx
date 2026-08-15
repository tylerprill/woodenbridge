'use client';

import { ArrowRightStartOnRectangleIcon } from '@heroicons/react/24/outline';

import { logOut } from '@/app/lib/actions/auth';
import { BrandLockup } from '@/components/clean/brand-lockup';
import NavLinks from '@/components/unclean/dashboard/nav-links';

type SideNavProps = {
  userEmail?: string | null;
};

export default function SideNav({ userEmail }: SideNavProps) {
  const initial = userEmail?.charAt(0).toUpperCase() ?? 'E';

  return (
    <aside className="dashboard-sidebar">
      <div className="dashboard-sidebar-inner">
        <BrandLockup className="dashboard-brand" label="Personal atlas" />

        <nav className="dashboard-nav" aria-label="Dashboard navigation">
          <p>Your atlas</p>
          <div className="dashboard-nav-links">
            <NavLinks />
          </div>
        </nav>

        <div className="dashboard-account">
          <span className="dashboard-avatar" aria-hidden="true">
            {initial}
          </span>
          <span className="dashboard-account-copy">
            <strong>Explorer</strong>
            <small>{userEmail ?? 'Your account'}</small>
          </span>
          <button
            type="button"
            onClick={() => logOut({ redirectTo: '/' })}
            aria-label="Sign out"
          >
            <ArrowRightStartOnRectangleIcon aria-hidden="true" />
          </button>
        </div>
      </div>
    </aside>
  );
}
