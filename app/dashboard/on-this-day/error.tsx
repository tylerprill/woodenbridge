'use client';

export default function OnThisDayError({ reset }: { reset: () => void }) {
  return (
    <div className="dashboard-page dashboard-error-state" role="alert">
      <span aria-hidden="true" />
      <p className="section-kicker">A moment out of view</p>
      <h1>Your memories could not finish opening.</h1>
      <p>Nothing was changed. Try again, or return to your atlas.</p>
      <div>
        <button type="button" onClick={reset}>
          Try again
        </button>
        <a href="/dashboard">Open atlas</a>
      </div>
    </div>
  );
}
