'use client';

import {
  BookmarkIcon,
  MapIcon,
  Squares2X2Icon,
  UsersIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { hasRequiredRole, type AppRole } from '@/app/lib/auth/roles';

const links = [
  { name: 'Overview', href: '/dashboard', icon: Squares2X2Icon },
  { name: 'Collection', href: '/dashboard/users', icon: BookmarkIcon },
  { name: 'Discover', href: '/', icon: MapIcon },
];

const ownerLinks = [
  { name: 'Users', href: '/dashboard/owner/users', icon: UsersIcon },
];

export default function NavLinks({ role }: { role: AppRole }) {
  const pathname = usePathname();
  const visibleLinks = hasRequiredRole(role, 'admin')
    ? [...links, ...ownerLinks]
    : links;

  return (
    <>
      {visibleLinks.map((link) => {
        const LinkIcon = link.icon;

        return (
          <Link
            key={link.name}
            href={link.href}
            className={clsx('dashboard-nav-link', {
              'dashboard-nav-link-active':
                pathname === link.href ||
                (link.href !== '/dashboard' &&
                  pathname.startsWith(`${link.href}/`)),
            })}
          >
            <LinkIcon aria-hidden="true" />
            <span>{link.name}</span>
          </Link>
        );
      })}
    </>
  );
}
