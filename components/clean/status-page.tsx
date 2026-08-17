import { ArrowRightIcon, MapIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { BrandLockup } from '@/components/clean/brand-lockup';
import { AmbientBackground } from '@/components/home/ambient-background';

type StatusPageProps = {
  eyebrow: string;
  title: string;
  description: string;
  primaryHref?: string;
  primaryLabel?: string;
  secondaryHref?: string;
  secondaryLabel?: string;
  children?: ReactNode;
};

export function StatusPage({
  eyebrow,
  title,
  description,
  primaryHref,
  primaryLabel,
  secondaryHref,
  secondaryLabel,
  children,
}: StatusPageProps) {
  return (
    <main className="status-page">
      <AmbientBackground />
      <section className="status-card" aria-labelledby="status-page-title">
        <BrandLockup className="status-brand" />
        <span className="status-icon" aria-hidden="true">
          <MapIcon />
        </span>
        <p className="section-kicker">{eyebrow}</p>
        <h1 id="status-page-title">{title}</h1>
        <p className="status-description">{description}</p>
        <div className="status-actions">
          {primaryHref && primaryLabel ? (
            <Link
              className="status-action status-action-primary"
              href={primaryHref}
            >
              {primaryLabel}
              <ArrowRightIcon aria-hidden="true" />
            </Link>
          ) : null}
          {children}
          {secondaryHref && secondaryLabel ? (
            <Link
              className="status-action status-action-secondary"
              href={secondaryHref}
            >
              {secondaryLabel}
            </Link>
          ) : null}
        </div>
        <p className="status-note">
          The path is still here. We will help you find it.
        </p>
      </section>
    </main>
  );
}
