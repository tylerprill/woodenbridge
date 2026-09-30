import {
  BookmarkIcon,
  CalendarDaysIcon,
  PlusIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';

import {
  type AtlasCollectionSort,
  getAtlasCollectionData,
} from '@/app/lib/atlas/data';
import { KeepsakeCard } from '@/components/atlas/keepsake-card';
import {
  MemoryActionGroup,
  MemoryActions,
} from '@/components/atlas/memory-actions';

function collectionHref(sort: AtlasCollectionSort, page = 1) {
  const params = new URLSearchParams();
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
  const sort: AtlasCollectionSort =
    query.sort === 'oldest' ? 'oldest' : 'newest';
  const requestedPage = Number.parseInt(query.page ?? '1', 10);
  const data = await getAtlasCollectionData({
    filter: 'all',
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
        <nav className="collection-sort" aria-label="Sort memories">
          <span>Sort</span>
          <Link
            href={collectionHref('newest')}
            data-active={sort === 'newest' ? 'true' : 'false'}
            aria-current={sort === 'newest' ? 'page' : undefined}
          >
            Newest
          </Link>
          <Link
            href={collectionHref('oldest')}
            data-active={sort === 'oldest' ? 'true' : 'false'}
            aria-current={sort === 'oldest' ? 'page' : undefined}
          >
            Oldest
          </Link>
        </nav>
      </div>

      {memories.length ? (
        <MemoryActionGroup>
          <section className="collection-grid" aria-label="Memories">
            {memories.map((entry, index) => (
              <KeepsakeCard
                key={entry.id}
                entry={entry}
                index={String(data.offset + index + 1).padStart(2, '0')}
                variant="grid"
                href={`/dashboard/card/${entry.id}`}
                actions={
                  <MemoryActions
                    entryId={entry.id}
                    title={entry.title}
                    variant="card"
                    returnTo={
                      memories.length === 1 && data.page > 1
                        ? collectionHref(sort, data.page - 1)
                        : undefined
                    }
                  />
                }
              />
            ))}
          </section>
        </MemoryActionGroup>
      ) : data.counts.total ? (
        <section
          className="collection-empty"
          aria-labelledby="empty-page-title"
        >
          <span aria-hidden="true" />
          <p className="section-kicker">An empty page</p>
          <h2 id="empty-page-title">There are no memories on this page.</h2>
          <p>Your memories are still right where you left them.</p>
          <Link href={collectionHref(sort)}>Back to memories</Link>
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
            <Link href={collectionHref(sort, data.page - 1)}>Previous</Link>
          ) : (
            <span aria-hidden="true" />
          )}
          <p>
            Page {data.page} of {data.totalPages}
          </p>
          {data.page < data.totalPages ? (
            <Link href={collectionHref(sort, data.page + 1)}>Next</Link>
          ) : (
            <span aria-hidden="true" />
          )}
        </nav>
      ) : null}
    </div>
  );
}
