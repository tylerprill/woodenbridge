import { ArrowLeftIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { BrandLockup } from '@/components/clean/brand-lockup';
import { AmbientBackground } from '@/components/home/ambient-background';

type AuthShellProps = {
  children: ReactNode;
  footer: ReactNode;
  headingId: string;
  panelDescription: string;
  panelEyebrow: string;
  panelTitle: string;
  storyDescription: string;
  storyEyebrow: string;
  storyNote: string;
  storyTitle: string;
};

export function AuthShell({
  children,
  footer,
  headingId,
  panelDescription,
  panelEyebrow,
  panelTitle,
  storyDescription,
  storyEyebrow,
  storyNote,
  storyTitle,
}: AuthShellProps) {
  return (
    <main className="auth-page">
      <AmbientBackground />

      <section className="auth-layout" aria-labelledby={headingId}>
        <aside className="auth-story" aria-label="Field Atlas travel journal">
          <BrandLockup className="auth-story-brand" />

          <div className="auth-story-copy">
            <p className="section-kicker">{storyEyebrow}</p>
            <h1>{storyTitle}</h1>
            <p>{storyDescription}</p>
          </div>

          <div className="auth-landscape" aria-hidden="true">
            <span className="auth-sun" />
            <span className="auth-mountain auth-mountain-far" />
            <span className="auth-mountain auth-mountain-near" />
            <span className="auth-bridge" />
          </div>

          <p className="auth-story-note">
            <span>Field note</span>
            {storyNote}
          </p>
        </aside>

        <div className="auth-panel-wrap">
          <BrandLockup className="auth-mobile-brand" />

          <Link className="auth-back-link" href="/">
            <ArrowLeftIcon aria-hidden="true" />
            Back to the atlas
          </Link>

          <div className="auth-panel">
            <div className="auth-panel-heading">
              <p className="section-kicker">{panelEyebrow}</p>
              <h2 id={headingId}>{panelTitle}</h2>
              <p>{panelDescription}</p>
            </div>

            {children}
            {footer}
          </div>

          <p className="auth-fine-print">
            Your atlas stays private and belongs only to you.
          </p>
        </div>
      </section>
    </main>
  );
}
