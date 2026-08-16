import { ArrowRightIcon } from '@heroicons/react/24/outline';
import { BrandLockup } from '@/components/clean/brand-lockup';
import {
  getAccountDisplayName,
  getAccountInitial,
} from '@/app/lib/auth/account-display';
import Link from 'next/link';

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
      ) : (
        <Link className="header-action" href="/login">
          Sign in
          <span aria-hidden="true">↗</span>
        </Link>
      )}
    </header>
  );
}
