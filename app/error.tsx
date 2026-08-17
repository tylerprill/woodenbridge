'use client';

import { StatusPage } from '@/components/clean/status-page';

export default function RootError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <StatusPage
      eyebrow="A trail went quiet"
      title="We could not open this page."
      description="Nothing in your atlas has been changed. Try the route again, or return home and continue from familiar ground."
      secondaryHref="/"
      secondaryLabel="Return home"
    >
      <button
        className="status-action status-action-primary"
        type="button"
        onClick={reset}
      >
        Try again
      </button>
    </StatusPage>
  );
}
