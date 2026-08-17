'use client';

import {
  BookOpenIcon,
  BookmarkIcon,
  GlobeAltIcon,
  ShieldCheckIcon,
  UsersIcon,
} from '@heroicons/react/24/outline';
import clsx from 'clsx';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { hasRequiredRole, type AppRole } from '@/app/lib/auth/roles';

const atlasLinks = [
  { name: 'Atlas', href: '/dashboard', icon: GlobeAltIcon },
  { name: 'My places', href: '/dashboard/places', icon: BookmarkIcon },
  { name: 'My Chapters', href: '/dashboard/chapters', icon: BookOpenIcon },
];

type NavigationLink = (typeof atlasLinks)[number];

const accountLinks: NavigationLink[] = [
  { name: 'Security', href: '/dashboard/security', icon: ShieldCheckIcon },
];

const managementLinks: NavigationLink[] = [
  { name: 'Users', href: '/dashboard/owner/users', icon: UsersIcon },
];

function isLinkActive(pathname: string, href: string) {
  return (
    pathname === href ||
    (href !== '/dashboard' && pathname.startsWith(`${href}/`))
  );
}

function NavigationSection({
  id,
  label,
  links,
  pathname,
}: {
  id: string;
  label: string;
  links: NavigationLink[];
  pathname: string;
}) {
  return (
    <div className="dashboard-nav-section" role="group" aria-labelledby={id}>
      <p id={id} className="dashboard-nav-section-label">
        {label}
      </p>
      <div className="dashboard-nav-links">
        {links.map((link) => {
          const LinkIcon = link.icon;
          const isActive = isLinkActive(pathname, link.href);

          return (
            <Link
              key={link.name}
              href={link.href}
              aria-label={link.name}
              aria-current={isActive ? 'page' : undefined}
              title={link.name}
              className={clsx('dashboard-nav-link', {
                'dashboard-nav-link-active': isActive,
              })}
            >
              <LinkIcon aria-hidden="true" />
              <span>{link.name}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export default function NavLinks({ role }: { role: AppRole }) {
  const pathname = usePathname();
  const visibleAccountLinks = hasRequiredRole(role, 'admin')
    ? [...accountLinks, ...managementLinks]
    : accountLinks;

  return (
    <div className="dashboard-nav-sections">
      <NavigationSection
        id="dashboard-atlas-navigation"
        label="Your atlas"
        links={atlasLinks}
        pathname={pathname}
      />
      <NavigationSection
        id="dashboard-account-navigation"
        label="Account"
        links={visibleAccountLinks}
        pathname={pathname}
      />
    </div>
  );
}
