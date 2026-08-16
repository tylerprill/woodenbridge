import {
  ArrowRightIcon,
  BookmarkIcon,
  CheckCircleIcon,
  GlobeAltIcon,
  MapPinIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';

import { getAccountDisplayName } from '@/app/lib/auth/account-display';
import { requireVerifiedSession } from '@/app/lib/auth/session';
import { BridgeScene } from '@/components/clean/bridge-scene';
import { savedBridges } from '@/components/dashboard/bridge-data';

const stats = [
  { label: 'Saved places', value: '03', icon: BookmarkIcon },
  { label: 'Places explored', value: '02', icon: GlobeAltIcon },
  { label: 'Memories added', value: '03', icon: CheckCircleIcon },
];

export default async function DashboardPage() {
  const session = await requireVerifiedSession();
  const displayName = getAccountDisplayName(session.user);

  return (
    <div className="dashboard-page">
      <header className="dashboard-page-heading">
        <div>
          <p className="section-kicker">Field dashboard</p>
          <h1>
            Welcome back, <span>{displayName}</span>.
          </h1>
          <p>Your saved places and field notes, gathered in one atlas.</p>
        </div>
        <Link className="dashboard-header-action" href="/">
          Explore the map
          <ArrowRightIcon aria-hidden="true" />
        </Link>
      </header>

      <section
        className="dashboard-welcome"
        aria-labelledby="dashboard-welcome-title"
      >
        <div className="dashboard-welcome-copy">
          <p>Next on the horizon</p>
          <h2 id="dashboard-welcome-title">Cathedral Rock Trail</h2>
          <span>
            <MapPinIcon aria-hidden="true" />
            Sedona, Arizona
          </span>
          <p>
            A red-rock trail turning gold as the final light reaches the canyon.
          </p>
          <Link href="/dashboard/users">
            View your collection
            <ArrowRightIcon aria-hidden="true" />
          </Link>
        </div>
        <BridgeScene className="dashboard-welcome-scene" tone="cedar" />
        <div className="dashboard-welcome-rings" aria-hidden="true" />
      </section>

      <section className="dashboard-stat-grid" aria-label="Collection summary">
        {stats.map(({ icon: Icon, label, value }) => (
          <article className="dashboard-stat" key={label}>
            <span>
              <Icon aria-hidden="true" />
            </span>
            <div>
              <strong>{value}</strong>
              <p>{label}</p>
            </div>
          </article>
        ))}
      </section>

      <div className="dashboard-content-grid">
        <section className="dashboard-panel" aria-labelledby="recent-title">
          <header className="dashboard-panel-heading">
            <div>
              <p className="section-kicker">Recently saved</p>
              <h2 id="recent-title">Your places</h2>
            </div>
            <Link href="/dashboard/users">View all</Link>
          </header>

          <div className="dashboard-bridge-list">
            {savedBridges.map((bridge, index) => (
              <article className="dashboard-bridge-row" key={bridge.name}>
                <BridgeScene tone={bridge.tone} />
                <div>
                  <span>{String(index + 1).padStart(2, '0')}</span>
                  <h3>{bridge.name}</h3>
                  <p>{bridge.location}</p>
                </div>
                <span className="dashboard-status">{bridge.status}</span>
              </article>
            ))}
          </div>
        </section>

        <aside className="dashboard-note" aria-labelledby="field-note-title">
          <p className="section-kicker">Field note · 04</p>
          <h2 id="field-note-title">Leave room for the unplanned stop.</h2>
          <p>
            The place you remember most may be the one you found because the
            road bent unexpectedly.
          </p>
          <span>From your Field Atlas journal</span>
        </aside>
      </div>
    </div>
  );
}
