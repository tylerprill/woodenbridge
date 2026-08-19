import { BookmarkIcon, PhotoIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';

import {
  type AtlasCollectionFilter,
  getAtlasCollectionData,
} from '@/app/lib/atlas/data';
import { KeepsakeCard } from '@/components/atlas/keepsake-card';

function collectionHref(filter: AtlasCollectionFilter, page = 1) {
  const params = new URLSearchParams();
  if (filter !== 'all') params.set('view', filter);
  if (page > 1) params.set('page', String(page));
  const query = params.toString();
  return query ? `/dashboard/places?${query}` : '/dashboard/places';
}

export default async function CollectionPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; page?: string }>;
}) {
  const query = await searchParams;
  const filter: AtlasCollectionFilter =
    query.view === 'visited' || query.view === 'ahead' ? query.view : 'all';
  const requestedPage = Number.parseInt(query.page ?? '1', 10);
  const data = await getAtlasCollectionData({
    filter,
    page: Number.isFinite(requestedPage) ? requestedPage : 1,
  });
  const places = data.entries;

  return (
    <div className="dashboard-page collection-page">
      <header className="dashboard-page-heading">
        <div>
          <p className="section-kicker">Personal atlas</p>
          <h1>Your collection.</h1>
          <p>Places you have explored and those still calling you onward.</p>
        </div>
        <div className="collection-heading-actions">
          <Link href="/dashboard/import">
            <PhotoIcon aria-hidden="true" /> Import photos
          </Link>
          <div className="collection-count">
            <BookmarkIcon aria-hidden="true" />
            <span>
              <strong>{data.counts.total}</strong>
              saved places
            </span>
          </div>
        </div>
      </header>

      <nav className="collection-filter" aria-label="Filter saved places">
        <Link
          href={collectionHref('all')}
          data-active={filter === 'all' ? 'true' : 'false'}
          aria-current={filter === 'all' ? 'page' : undefined}
        >
          All places
        </Link>
        <Link
          href={collectionHref('visited')}
          data-active={filter === 'visited' ? 'true' : 'false'}
          aria-current={filter === 'visited' ? 'page' : undefined}
        >
          {data.counts.visited} remembered
        </Link>
        <Link
          href={collectionHref('ahead')}
          data-active={filter === 'ahead' ? 'true' : 'false'}
          aria-current={filter === 'ahead' ? 'page' : undefined}
        >
          {data.counts.future} ahead
        </Link>
      </nav>

      {places.length ? (
        <section className="collection-grid" aria-label="Saved places">
          {places.map((entry, index) => (
            <KeepsakeCard
              key={entry.id}
              entry={entry}
              index={String(data.offset + index + 1).padStart(2, '0')}
              variant="grid"
              href={`/dashboard/card/${entry.id}`}
            />
          ))}
        </section>
      ) : data.counts.total ? (
        <section
          className="collection-empty collection-filter-empty"
          aria-labelledby="empty-filter-title"
        >
          <span aria-hidden="true" />
          <p className="section-kicker">No places in this view</p>
          <h2 id="empty-filter-title">
            {filter === 'ahead'
              ? 'No journeys are waiting in the wings.'
              : 'No remembered places match this view.'}
          </h2>
          <p>Your other keepsakes are still right where you left them.</p>
          <Link href="/dashboard/places">View all places</Link>
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
          <div className="collection-empty-actions">
            <Link href="/dashboard/import">Import photos</Link>
            <Link href="/dashboard">Open your atlas</Link>
          </div>
        </section>
      )}

      {places.length && data.totalPages > 1 ? (
        <nav className="collection-pagination" aria-label="Collection pages">
          {data.page > 1 ? (
            <Link href={collectionHref(filter, data.page - 1)}>Previous</Link>
          ) : (
            <span aria-hidden="true" />
          )}
          <p>
            Page {data.page} of {data.totalPages}
          </p>
          {data.page < data.totalPages ? (
            <Link href={collectionHref(filter, data.page + 1)}>Next</Link>
          ) : (
            <span aria-hidden="true" />
          )}
        </nav>
      ) : null}
    </div>
  );
}
