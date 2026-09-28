import {
  BookmarkIcon,
  CalendarDaysIcon,
  PlusIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';

import {
  type AtlasCollectionFilter,
  type AtlasCollectionSort,
  getAtlasCollectionData,
} from '@/app/lib/atlas/data';
import { KeepsakeCard } from '@/components/atlas/keepsake-card';

function collectionHref(
  filter: AtlasCollectionFilter,
  sort: AtlasCollectionSort,
  page = 1,
) {
  const params = new URLSearchParams();
  if (filter !== 'all') params.set('view', filter);
  if (sort !== 'newest') params.set('sort', sort);
  if (page > 1) params.set('page', String(page));
  const query = params.toString();
  return query ? `/dashboard/places?${query}` : '/dashboard/places';
}

export default async function CollectionPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; sort?: string; page?: string }>;
}) {
  const query = await searchParams;
  const filter: AtlasCollectionFilter =
    query.view === 'visited' || query.view === 'ahead' ? query.view : 'all';
  const sort: AtlasCollectionSort =
    query.sort === 'oldest' ? 'oldest' : 'newest';
  const requestedPage = Number.parseInt(query.page ?? '1', 10);
  const data = await getAtlasCollectionData({
    filter,
    sort,
    page: Number.isFinite(requestedPage) ? requestedPage : 1,
  });
  const memories = data.entries;

  return (
    <div className="dashboard-page collection-page">
      <header className="dashboard-page-heading">
        <div>
          <p className="section-kicker">Personal atlas</p>
          <h1>Memories.</h1>
          <p>The moments you have saved and those still taking shape.</p>
        </div>
        <div className="collection-heading-actions">
          <Link href="/dashboard/on-this-day">
            <CalendarDaysIcon aria-hidden="true" /> On this day
          </Link>
          <Link href="/dashboard?new=memory">
            <PlusIcon aria-hidden="true" /> New memory
          </Link>
          <div className="collection-count">
            <BookmarkIcon aria-hidden="true" />
            <span>
              <strong>{data.counts.total}</strong>
              {data.counts.total === 1 ? 'memory' : 'memories'}
            </span>
          </div>
        </div>
      </header>

      <div className="collection-controls">
        <nav className="collection-filter" aria-label="Filter memories">
          <Link
            href={collectionHref('all', sort)}
            data-active={filter === 'all' ? 'true' : 'false'}
            aria-current={filter === 'all' ? 'page' : undefined}
          >
            All memories
          </Link>
          <Link
            href={collectionHref('visited', sort)}
            data-active={filter === 'visited' ? 'true' : 'false'}
            aria-current={filter === 'visited' ? 'page' : undefined}
          >
            {data.counts.visited} remembered
          </Link>
          <Link
            href={collectionHref('ahead', sort)}
            data-active={filter === 'ahead' ? 'true' : 'false'}
            aria-current={filter === 'ahead' ? 'page' : undefined}
          >
            {data.counts.future} ahead
          </Link>
        </nav>
        <nav className="collection-sort" aria-label="Sort memories">
          <span>Sort</span>
          <Link
            href={collectionHref(filter, 'newest')}
            data-active={sort === 'newest' ? 'true' : 'false'}
            aria-current={sort === 'newest' ? 'page' : undefined}
          >
            Newest
          </Link>
          <Link
            href={collectionHref(filter, 'oldest')}
            data-active={sort === 'oldest' ? 'true' : 'false'}
            aria-current={sort === 'oldest' ? 'page' : undefined}
          >
            Oldest
          </Link>
        </nav>
      </div>

      {memories.length ? (
        <section className="collection-grid" aria-label="Memories">
          {memories.map((entry, index) => (
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
          <p className="section-kicker">No memories in this view</p>
          <h2 id="empty-filter-title">
            {filter === 'ahead'
              ? 'No future memories are waiting in the wings.'
              : 'No memories match this view.'}
          </h2>
          <p>Your other memories are still right where you left them.</p>
          <Link href={collectionHref('all', sort)}>View all memories</Link>
        </section>
      ) : (
        <section
          className="collection-empty"
          aria-labelledby="empty-collection-title"
        >
          <span aria-hidden="true" />
          <p className="section-kicker">An open page</p>
          <h2 id="empty-collection-title">Your first memory is waiting.</h2>
          <p>
            Choose its place, then add the details and photographs together.
          </p>
          <div className="collection-empty-actions">
            <Link href="/dashboard?new=memory">New memory</Link>
            <Link href="/dashboard">Open your atlas</Link>
          </div>
        </section>
      )}

      {memories.length && data.totalPages > 1 ? (
        <nav className="collection-pagination" aria-label="Memory pages">
          {data.page > 1 ? (
            <Link href={collectionHref(filter, sort, data.page - 1)}>
              Previous
            </Link>
          ) : (
            <span aria-hidden="true" />
          )}
          <p>
            Page {data.page} of {data.totalPages}
          </p>
          {data.page < data.totalPages ? (
            <Link href={collectionHref(filter, sort, data.page + 1)}>Next</Link>
          ) : (
            <span aria-hidden="true" />
          )}
        </nav>
      ) : null}
    </div>
  );
}
