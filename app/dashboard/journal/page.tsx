import {
  ArrowRightIcon,
  BookmarkIcon,
  CheckCircleIcon,
  GlobeAltIcon,
  MapPinIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';

import { getAtlasData } from '@/app/lib/atlas/data';
import { MemoryArtwork } from '@/components/atlas/memory-artwork';

const tones = ['cedar', 'alpine', 'ember'] as const;

export default async function JournalPage() {
  const { entries } = await getAtlasData();
  const saved = entries.filter((entry) => entry.recordState === 'saved');
  const visited = saved.filter((entry) => entry.journeyState === 'visited');
  const future = saved.filter(
    (entry) => entry.journeyState === 'want_to_visit',
  );

  const stats = [
    { label: 'Memories kept', value: saved.length, icon: BookmarkIcon },
    { label: 'Places explored', value: visited.length, icon: GlobeAltIcon },
    { label: 'Journeys ahead', value: future.length, icon: CheckCircleIcon },
  ];

  return (
    <div className="dashboard-page">
      <header className="dashboard-page-heading">
        <div>
          <p className="section-kicker">Field journal</p>
          <h1>The places that stay.</h1>
          <p>
            Your most recently written memories, gathered from across the atlas.
          </p>
        </div>
        <Link className="dashboard-header-action" href="/dashboard">
          Open the atlas
          <ArrowRightIcon aria-hidden="true" />
        </Link>
      </header>

      <section className="dashboard-stat-grid" aria-label="Journal summary">
        {stats.map(({ icon: Icon, label, value }) => (
          <article className="dashboard-stat" key={label}>
            <span>
              <Icon aria-hidden="true" />
            </span>
            <div>
              <strong>{String(value).padStart(2, '0')}</strong>
              <p>{label}</p>
            </div>
          </article>
        ))}
      </section>

      <section
        className="dashboard-panel journal-memory-panel"
        aria-labelledby="recent-memories-title"
      >
        <header className="dashboard-panel-heading">
          <div>
            <p className="section-kicker">Recently remembered</p>
            <h2 id="recent-memories-title">Latest field notes</h2>
          </div>
          <Link href="/dashboard/users">View all</Link>
        </header>

        {saved.length ? (
          <div className="dashboard-bridge-list">
            {saved.slice(0, 6).map((entry, index) => (
              <Link
                className="dashboard-bridge-row journal-memory-row"
                key={entry.id}
                href={`/dashboard?memory=${entry.id}`}
              >
                <MemoryArtwork
                  entry={entry}
                  tone={tones[index % tones.length]}
                />
                <div>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <h3>{entry.title}</h3>
                  <p>
                    <MapPinIcon aria-hidden="true" />
                    {entry.placeLabel || 'Pinned place'}
                  </p>
                </div>
                <span className="dashboard-status">
                  {entry.journeyState === 'visited' ? 'Remembered' : 'Ahead'}
                </span>
              </Link>
            ))}
          </div>
        ) : (
          <div className="dashboard-empty-panel">
            <h3>Your journal begins with a pin.</h3>
            <p>Open the atlas and mark the first place you want to remember.</p>
            <Link href="/dashboard">Place a memory</Link>
          </div>
        )}
      </section>
    </div>
  );
}
