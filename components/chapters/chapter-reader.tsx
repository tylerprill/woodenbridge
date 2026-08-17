import {
  ArrowLeftIcon,
  CalendarDaysIcon,
  MapPinIcon,
  PencilIcon,
} from '@heroicons/react/24/outline';
import Image from 'next/image';
import Link from 'next/link';

import type { AtlasChapter } from '@/app/lib/chapters/definitions';
import {
  chapterMemoryLabel,
  formatChapterDateRange,
} from '@/app/lib/chapters/format';
import { KeepsakeCard } from '@/components/atlas/keepsake-card';
import { ChapterMap } from './chapter-map';
import {
  ChapterSaveNotice,
  type ChapterSaveNoticeKind,
} from './chapter-save-notice';
import { ChapterShareControl } from './chapter-share-control';
import styles from './chapters.module.css';

export function ChapterReader({
  chapter,
  mode,
  saveNotice,
}: {
  chapter: AtlasChapter;
  mode: 'owner' | 'shared';
  saveNotice?: ChapterSaveNoticeKind;
}) {
  const places = chapter.entries
    .map((entry) => entry.placeLabel || entry.placeName)
    .filter((place): place is string => Boolean(place));
  const mapEntries = chapter.entries.map((entry) => ({
    id: entry.id,
    title: entry.title,
    placeLabel: entry.placeLabel,
    placeName: entry.placeName,
    latitude: entry.latitude,
    longitude: entry.longitude,
  }));
  const showMap = mode === 'owner' || chapter.shareMap;

  return (
    <article className={styles.chapterDetail} data-reader-mode={mode}>
      <nav className={styles.chapterDetailNav} aria-label="Chapter actions">
        <Link href={mode === 'owner' ? '/dashboard/chapters' : '/'}>
          <ArrowLeftIcon aria-hidden="true" />
          {mode === 'owner' ? 'My Chapters' : 'Field Atlas'}
        </Link>
        {mode === 'owner' ? (
          <div className={styles.chapterDetailActions}>
            <ChapterShareControl
              chapterId={chapter.id}
              chapterTitle={chapter.title}
              shareId={chapter.shareId}
              visibility={chapter.visibility}
            />
            <Link href={`/dashboard/chapters/${chapter.id}/edit`}>
              <PencilIcon aria-hidden="true" />
              Edit chapter
            </Link>
          </div>
        ) : (
          <Link href="/sign-up">Create your atlas</Link>
        )}
      </nav>

      {mode === 'owner' && saveNotice ? (
        <ChapterSaveNotice chapterId={chapter.id} kind={saveNotice} />
      ) : null}

      <header
        className={styles.chapterHero}
        data-has-cover={chapter.coverMedia ? 'true' : 'false'}
      >
        <div className={styles.chapterHeroArtwork}>
          {chapter.coverMedia ? (
            <Image
              src={chapter.coverMedia.thumbnailUrl}
              alt={chapter.coverMedia.altText || ''}
              fill
              sizes="(max-width: 800px) 100vw, 48vw"
              className={styles.chapterHeroImage}
              loading="eager"
              fetchPriority="high"
              unoptimized
            />
          ) : (
            <div className={styles.chapterHeroFallback} aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </div>
          )}
        </div>
        <div
          className={styles.chapterHeroStory}
          data-long-title={chapter.title.length > 52 ? 'true' : undefined}
        >
          <p className="section-kicker">
            {mode === 'shared'
              ? 'A shared Field Atlas chapter'
              : 'A chapter from your atlas'}
          </p>
          <h1>{chapter.title}</h1>
          {chapter.introduction ? (
            <p className={styles.chapterIntroduction}>{chapter.introduction}</p>
          ) : null}
          <div className={styles.chapterHeroMeta}>
            <span>
              <CalendarDaysIcon aria-hidden="true" />
              {formatChapterDateRange(chapter.startDate, chapter.endDate)}
            </span>
            <span>
              <MapPinIcon aria-hidden="true" />
              {chapterMemoryLabel(chapter.memoryCount)}
            </span>
          </div>
          {places.length ? (
            <p className={styles.chapterPlaces}>
              {places.slice(0, 4).join(' · ')}
              {places.length > 4 ? ` · +${places.length - 4} more` : ''}
            </p>
          ) : null}
        </div>
      </header>

      {showMap ? (
        <section
          className={styles.routeSection}
          aria-labelledby="chapter-route-heading"
        >
          <div className={styles.chapterSectionHeading}>
            <div>
              <p className="section-kicker">The path between</p>
              <h2 id="chapter-route-heading">Your route, remembered.</h2>
            </div>
            <p>
              {mode === 'shared' &&
              chapter.shareLocationPrecision === 'approximate'
                ? 'Shared pins are intentionally approximate.'
                : 'Each stop follows the reading order you chose.'}
            </p>
          </div>
          <ChapterMap entries={mapEntries} />
        </section>
      ) : null}

      <section
        className={styles.chapterMemories}
        aria-labelledby="chapter-memories-heading"
      >
        <div className={styles.chapterSectionHeading}>
          <div>
            <p className="section-kicker">The chapter</p>
            <h2 id="chapter-memories-heading">Memory by memory.</h2>
          </div>
          <p>{chapterMemoryLabel(chapter.memoryCount)}, held in sequence.</p>
        </div>
        <div className={styles.chapterTimeline}>
          {chapter.entries.map((entry, index) => (
            <div className={styles.chapterStopGroup} key={entry.id}>
              {index > 0 && entry.transitionNote ? (
                <div className={styles.chapterTransition}>
                  <span aria-hidden="true" />
                  <p>{entry.transitionNote}</p>
                </div>
              ) : null}
              <div className={styles.chapterStop}>
                <div className={styles.chapterStopMarker} aria-hidden="true">
                  <span>{String(index + 1).padStart(2, '0')}</span>
                </div>
                <KeepsakeCard
                  entry={entry}
                  index={String(index + 1).padStart(2, '0')}
                  variant="row"
                  href={
                    mode === 'owner' ? `/dashboard/card/${entry.id}` : undefined
                  }
                  eager={false}
                  showDescription
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      {mode === 'shared' ? (
        <footer className={styles.sharedChapterFooter}>
          <p className="section-kicker">Field Atlas</p>
          <h2>Keep the places that shaped you.</h2>
          <Link href="/sign-up">Create your own atlas</Link>
        </footer>
      ) : null}
    </article>
  );
}
