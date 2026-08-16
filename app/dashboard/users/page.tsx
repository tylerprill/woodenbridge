import { BookmarkIcon, MapPinIcon } from '@heroicons/react/24/outline';

import { BridgeScene } from '@/components/clean/bridge-scene';
import { savedBridges } from '@/components/dashboard/bridge-data';

export default function CollectionPage() {
  return (
    <div className="dashboard-page collection-page">
      <header className="dashboard-page-heading">
        <div>
          <p className="section-kicker">Personal atlas</p>
          <h1>Your collection.</h1>
          <p>Places you have explored and those still calling you onward.</p>
        </div>
        <div className="collection-count">
          <BookmarkIcon aria-hidden="true" />
          <span>
            <strong>{String(savedBridges.length).padStart(2, '0')}</strong>
            saved places
          </span>
        </div>
      </header>

      <div className="collection-filter" aria-label="Collection summary">
        <span>All places</span>
        <span>02 visited</span>
        <span>01 want to visit</span>
      </div>

      <section className="collection-grid" aria-label="Saved places">
        {savedBridges.map((bridge, index) => (
          <article className="collection-card" key={bridge.name}>
            <BridgeScene
              index={String(index + 1).padStart(2, '0')}
              tone={bridge.tone}
            />
            <div className="collection-card-copy">
              <p className="bridge-location">
                <MapPinIcon aria-hidden="true" />
                {bridge.location}
              </p>
              <h2>{bridge.name}</h2>
              <p>{bridge.description}</p>
              <div className="collection-card-note">
                <span>Field note</span>
                <p>{bridge.note}</p>
              </div>
              <span className="dashboard-status">{bridge.status}</span>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
