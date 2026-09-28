import { MapIcon, PlusIcon } from '@heroicons/react/24/outline';

export default function AdventuresPage() {
  return (
    <div className="dashboard-page collection-page">
      <header className="dashboard-page-heading">
        <div>
          <p className="section-kicker">The whole trip</p>
          <h1>Adventures.</h1>
          <p>
            Bring several journeys together as one multi-day or multi-stage
            story.
          </p>
        </div>
        <div className="collection-heading-actions">
          <button
            type="button"
            disabled
            title="Adventure creation is coming next"
          >
            <PlusIcon aria-hidden="true" /> New adventure
          </button>
          <div className="collection-count">
            <MapIcon aria-hidden="true" />
            <span>
              <strong>0</strong>
              adventures
            </span>
          </div>
        </div>
      </header>

      <section
        className="collection-empty"
        aria-labelledby="empty-adventures-title"
      >
        <span aria-hidden="true" />
        <p className="section-kicker">A longer story</p>
        <h2 id="empty-adventures-title">Adventures are coming next.</h2>
        <p>
          Soon you will be able to group journeys into one complete trip while
          keeping each journey independent.
        </p>
      </section>
    </div>
  );
}
