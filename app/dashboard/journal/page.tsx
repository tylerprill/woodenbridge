import {
  ArrowRightIcon,
  BookmarkIcon,
  CheckCircleIcon,
  GlobeAltIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';

import { getAtlasJournalData } from '@/app/lib/atlas/data';
import { KeepsakeCard } from '@/components/atlas/keepsake-card';

export default async function JournalPage() {
  const { entries: saved, counts } = await getAtlasJournalData();

  const stats = [
    { label: 'Memories kept', value: counts.total, icon: BookmarkIcon },
    { label: 'Places explored', value: counts.visited, icon: GlobeAltIcon },
    { label: 'Journeys ahead', value: counts.future, icon: CheckCircleIcon },
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
              <KeepsakeCard
                key={entry.id}
                entry={entry}
                index={String(index + 1).padStart(2, '0')}
                variant="row"
                href={`/dashboard/card/${entry.id}`}
              />
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
