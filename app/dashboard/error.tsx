'use client';

export default function DashboardError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="dashboard-page dashboard-error-state" role="alert">
      <span aria-hidden="true" />
      <p className="section-kicker">A trail went quiet</p>
      <h1>Your atlas could not finish opening.</h1>
      <p>
        Your memories are safe and nothing was changed. Try again, or return to
        the atlas overview.
      </p>
      <div>
        <button type="button" onClick={reset}>
          Try again
        </button>
        <a href="/dashboard">Open atlas</a>
      </div>
    </div>
  );
}
