import { BrandLockup } from '@/components/clean/brand-lockup';
import Link from 'next/link';

const navigation = [
  { label: 'Explore', href: '#featured' },
  { label: 'Journal', href: '#journal' },
  { label: 'About', href: '#about' },
];

export function SiteHeader() {
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

      <Link className="header-action" href="/login">
        Sign in
        <span aria-hidden="true">↗</span>
      </Link>
    </header>
  );
}
