'use client';

import {
  BookmarkIcon,
  MapIcon,
  Squares2X2Icon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const links = [
  { name: 'Overview', href: '/dashboard', icon: Squares2X2Icon },
  { name: 'Collection', href: '/dashboard/users', icon: BookmarkIcon },
  { name: 'Discover', href: '/', icon: MapIcon },
];

export default function NavLinks() {
  const pathname = usePathname();

  return (
    <>
      {links.map((link) => {
        const LinkIcon = link.icon;

        return (
          <Link
            key={link.name}
            href={link.href}
            className={clsx('dashboard-nav-link', {
              'dashboard-nav-link-active': pathname === link.href,
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
