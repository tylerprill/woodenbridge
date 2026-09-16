import { BookOpenIcon, PlusIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getAtlasChapters } from '@/app/lib/chapters/data';
import { CHAPTER_MIN_MEMORIES } from '@/app/lib/chapters/validation';
import { ChapterCard } from '@/components/chapters/chapter-card';
import styles from '@/components/chapters/chapters.module.css';

function chaptersHref(page = 1) {
  return page > 1 ? `/dashboard/chapters?page=${page}` : '/dashboard/chapters';
}

export default async function ChaptersPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const query = await searchParams;
  const requestedPage = Number.parseInt(query.page ?? '1', 10);
  const data = await getAtlasChapters({
    page: Number.isFinite(requestedPage) ? requestedPage : 1,
  });
  if (data.total && data.page > data.totalPages) {
    redirect(chaptersHref(data.totalPages));
  }
  const canCreateJourney = data.availableMemoryCount >= CHAPTER_MIN_MEMORIES;
  const journeyActionHref = canCreateJourney
    ? '/dashboard/chapters/new'
    : '/dashboard/import';
  const journeyActionLabel = canCreateJourney
    ? 'New journey'
    : data.availableMemoryCount === 1
      ? 'Add one more memory'
      : 'Add memories';

  return (
    <div className={`dashboard-page ${styles.chaptersPage}`}>
      <header className={styles.chaptersHeader}>
        <div>
          <p className="section-kicker">Stories from your atlas</p>
          <h1>My Journeys.</h1>
          <p>Connect the places that belong to the same story.</p>
        </div>
        <div className={styles.chaptersHeaderActions}>
          <p className={styles.chapterCount}>
            <BookOpenIcon aria-hidden="true" />
            <span>
              <strong>{String(data.total).padStart(2, '0')}</strong>
              {data.total === 1 ? 'journey' : 'journeys'}
            </span>
          </p>
          <Link href={journeyActionHref} className={styles.newChapterButton}>
            <PlusIcon aria-hidden="true" />
            {journeyActionLabel}
          </Link>
        </div>
      </header>

      {data.chapters.length ? (
        <section className={styles.chapterGrid} aria-label="Your journeys">
          {data.chapters.map((chapter, index) => (
            <ChapterCard
              key={chapter.id}
              chapter={chapter}
              index={String(data.offset + index + 1).padStart(2, '0')}
              eager={index === 0}
            />
          ))}
        </section>
      ) : (
        <section
          className={styles.chaptersEmpty}
          aria-labelledby="empty-chapters-title"
        >
          <div className={styles.emptyChapterArt} aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <p className="section-kicker">
            {canCreateJourney
              ? 'A story waiting to be told'
              : 'Memories come first'}
          </p>
          <h2 id="empty-chapters-title">
            {canCreateJourney
              ? 'Bring a journey into focus.'
              : 'Start with two memories.'}
          </h2>
          <p>
            {canCreateJourney
              ? 'Select memories from your atlas, arrange the route, and preserve them together as one journey.'
              : data.availableMemoryCount === 1
                ? 'Add one more saved memory, then return to connect both places into a journey.'
                : 'Upload photographs or place memories in your Atlas. Once two are saved, you can connect them into a journey.'}
          </p>
          <Link href={journeyActionHref}>
            <PlusIcon aria-hidden="true" />
            {canCreateJourney
              ? 'Create your first journey'
              : journeyActionLabel}
          </Link>
        </section>
      )}

      {data.chapters.length && data.totalPages > 1 ? (
        <nav className="collection-pagination" aria-label="Journey pages">
          {data.page > 1 ? (
            <Link href={chaptersHref(data.page - 1)}>Previous</Link>
          ) : (
            <span aria-hidden="true" />
          )}
          <p>
            Page {data.page} of {data.totalPages}
          </p>
          {data.page < data.totalPages ? (
            <Link href={chaptersHref(data.page + 1)}>Next</Link>
          ) : (
            <span aria-hidden="true" />
          )}
        </nav>
      ) : null}
    </div>
  );
}
