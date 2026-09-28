'use client';

import {
  ArrowRightOnRectangleIcon,
  ShieldCheckIcon,
  UserCircleIcon,
  UsersIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';
import { useRef } from 'react';

import { logOut } from '@/app/lib/actions/auth';
import { hasRequiredRole, type AppRole } from '@/app/lib/auth/roles';
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
  const canManageAccounts = hasRequiredRole(role, 'admin');
  const compactAccountMenuRef = useRef<HTMLDetailsElement>(null);
  const closeCompactAccountMenu = () => {
    compactAccountMenuRef.current?.removeAttribute('open');
  };

  return (
    <aside className="dashboard-sidebar">
      <div className="dashboard-sidebar-inner">
        <BrandLockup className="dashboard-brand" label="Personal atlas" />

        <nav className="dashboard-nav" aria-label="Dashboard navigation">
          <NavLinks role={role} />
        </nav>

        <div className="dashboard-account">
          <Link
            className="dashboard-account-profile"
            href="/dashboard/security"
            aria-label={`Open account security for ${displayName}`}
          >
            <span className="dashboard-avatar" aria-hidden="true">
              {initial}
            </span>
            <span className="dashboard-account-copy">
              <strong>{displayName}</strong>
              <small>{userEmail ?? 'Your account'}</small>
            </span>
          </Link>
          <button
            type="button"
            onClick={() => logOut({ redirectTo: '/' })}
            aria-label="Sign out"
            title="Sign out"
          >
            <ArrowRightOnRectangleIcon aria-hidden="true" />
          </button>
        </div>

        <details
          ref={compactAccountMenuRef}
          className="dashboard-mobile-account-menu"
        >
          <summary>
            <UserCircleIcon aria-hidden="true" />
            <span>Account</span>
          </summary>
          <div className="dashboard-mobile-account-popover">
            <div className="dashboard-mobile-account-identity">
              <span className="dashboard-avatar" aria-hidden="true">
                {initial}
              </span>
              <span className="dashboard-account-copy">
                <strong>{displayName}</strong>
                <small>{userEmail ?? 'Your account'}</small>
              </span>
            </div>

            <Link href="/dashboard/security" onClick={closeCompactAccountMenu}>
              <ShieldCheckIcon aria-hidden="true" />
              <span>
                <strong>Account &amp; security</strong>
                <small>Sessions and account access</small>
              </span>
            </Link>

            {canManageAccounts ? (
              <Link
                href="/dashboard/owner/users"
                onClick={closeCompactAccountMenu}
              >
                <UsersIcon aria-hidden="true" />
                <span>
                  <strong>Users</strong>
                  <small>Protected account management</small>
                </span>
              </Link>
            ) : null}

            <button
              className="dashboard-mobile-signout"
              type="button"
              onClick={() => logOut({ redirectTo: '/' })}
            >
              <ArrowRightOnRectangleIcon aria-hidden="true" />
              <span>
                <strong>Sign out</strong>
                <small>Leave Field Atlas on this device</small>
              </span>
            </button>
          </div>
        </details>
      </div>
    </aside>
  );
}
