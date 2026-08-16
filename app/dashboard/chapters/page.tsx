import { BookOpenIcon, PlusIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';

import { getAtlasChapters } from '@/app/lib/chapters/data';
import { ChapterCard } from '@/components/chapters/chapter-card';
import styles from '@/components/chapters/chapters.module.css';

export default async function ChaptersPage() {
  const chapters = await getAtlasChapters();

  return (
    <div className={`dashboard-page ${styles.chaptersPage}`}>
      <header className={styles.chaptersHeader}>
        <div>
          <p className="section-kicker">Stories from your atlas</p>
          <h1>My Chapters.</h1>
          <p>Connect the places that belong to the same story.</p>
        </div>
        <div className={styles.chaptersHeaderActions}>
          <p className={styles.chapterCount}>
            <BookOpenIcon aria-hidden="true" />
            <span>
              <strong>{String(chapters.length).padStart(2, '0')}</strong>
              {chapters.length === 1 ? 'chapter' : 'chapters'}
            </span>
          </p>
          <Link href="/dashboard/chapters/new" className={styles.newChapterButton}>
            <PlusIcon aria-hidden="true" />
            New chapter
          </Link>
        </div>
      </header>

      {chapters.length ? (
        <section className={styles.chapterGrid} aria-label="Your chapters">
          {chapters.map((chapter, index) => (
            <ChapterCard
              key={chapter.id}
              chapter={chapter}
              index={String(index + 1).padStart(2, '0')}
            />
          ))}
        </section>
      ) : (
        <section className={styles.chaptersEmpty} aria-labelledby="empty-chapters-title">
          <div className={styles.emptyChapterArt} aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <p className="section-kicker">A story waiting to be told</p>
          <h2 id="empty-chapters-title">Bring a journey into focus.</h2>
          <p>
            Select memories from your atlas, arrange the route, and preserve them
            together as one chapter.
          </p>
          <Link href="/dashboard/chapters/new">
            <PlusIcon aria-hidden="true" />
            Create your first chapter
          </Link>
        </section>
      )}
    </div>
  );
}
