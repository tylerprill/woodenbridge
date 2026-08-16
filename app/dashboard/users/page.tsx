import { BookmarkIcon, MapPinIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';

import { getAtlasData } from '@/app/lib/atlas/data';
import { MemoryArtwork } from '@/components/atlas/memory-artwork';

const tones = ['cedar', 'alpine', 'ember'] as const;

export default async function CollectionPage() {
  const { entries } = await getAtlasData();
  const places = entries.filter((entry) => entry.recordState === 'saved');
  const visited = places.filter(
    (entry) => entry.journeyState === 'visited',
  ).length;
  const future = places.length - visited;

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
            <strong>{String(places.length).padStart(2, '0')}</strong>
            saved places
          </span>
        </div>
      </header>

      <div className="collection-filter" aria-label="Collection summary">
        <span>All places</span>
        <span>{String(visited).padStart(2, '0')} remembered</span>
        <span>{String(future).padStart(2, '0')} ahead</span>
      </div>

      {places.length ? (
        <section className="collection-grid" aria-label="Saved places">
          {places.map((entry, index) => (
            <Link
              className="collection-card"
              key={entry.id}
              href={`/dashboard?memory=${entry.id}`}
            >
              <MemoryArtwork
                entry={entry}
                index={String(index + 1).padStart(2, '0')}
                tone={tones[index % tones.length]}
              />
              <div className="collection-card-copy">
                <p className="bridge-location">
                  <MapPinIcon aria-hidden="true" />
                  {entry.placeLabel || 'Pinned place'}
                </p>
                <h2>{entry.title}</h2>
                <p>
                  {entry.description || 'A place held quietly in your atlas.'}
                </p>
                <div className="collection-card-note">
                  <span>Coordinates</span>
                  <p>
                    {entry.latitude.toFixed(4)}, {entry.longitude.toFixed(4)}
                  </p>
                </div>
                <span className="dashboard-status">
                  {entry.journeyState === 'visited' ? 'Remembered' : 'Ahead'}
                </span>
              </div>
            </Link>
          ))}
        </section>
      ) : (
        <section
          className="collection-empty"
          aria-labelledby="empty-collection-title"
        >
          <span aria-hidden="true" />
          <p className="section-kicker">An open page</p>
          <h2 id="empty-collection-title">
            Your collection is ready for its first place.
          </h2>
          <p>Drop a pin, write what matters, and it will appear here.</p>
          <Link href="/dashboard">Open your atlas</Link>
        </section>
      )}
    </div>
  );
}
