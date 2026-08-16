import { ArrowRightIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';

import {
  getAccountDisplayName,
  getAccountInitial,
} from '@/app/lib/auth/account-display';
import { BrandLockup } from '@/components/clean/brand-lockup';
import { HeaderLogoutButton } from '@/components/home/header-logout-button';

const navigation = [
  { label: 'Explore', href: '#featured' },
  { label: 'Journal', href: '#journal' },
  { label: 'About', href: '#about' },
];

type SiteHeaderProps = {
  user?: {
    name?: string | null;
    email?: string | null;
  };
};

export function SiteHeader({ user }: SiteHeaderProps) {
  const displayName = getAccountDisplayName(user);

  return (
    <header className="site-header">
      <BrandLockup />

      <nav className="site-nav" aria-label="Primary navigation">
        {navigation.map((item) => (
          <a key={item.href} href={item.href}>
            {item.label}
          </a>
        ))}
      </nav>

      {user ? (
        <div className="header-session-actions">
          <Link
            className="header-account"
            href="/dashboard"
            aria-label={`Open ${displayName}'s dashboard`}
          >
            <span className="header-account-avatar" aria-hidden="true">
              {getAccountInitial(user)}
            </span>
            <span className="header-account-copy">
              <strong>{displayName}</strong>
              <small>View your atlas</small>
            </span>
            <ArrowRightIcon aria-hidden="true" />
          </Link>
          <HeaderLogoutButton />
        </div>
      ) : (
        <div className="header-auth-actions">
          <Link className="header-action header-action-secondary" href="/login">
            Sign in
          </Link>
          <Link className="header-action header-action-primary" href="/sign-up">
            Create account
            <span aria-hidden="true">↗</span>
          </Link>
        </div>
      )}
    </header>
  );
}
