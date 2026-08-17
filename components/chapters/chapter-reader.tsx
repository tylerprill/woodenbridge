import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CalendarDaysIcon,
  MapPinIcon,
  PencilIcon,
} from '@heroicons/react/24/outline';
import Image from 'next/image';
import Link from 'next/link';

import type {
  AtlasChapter,
  SharedAtlasChapter,
} from '@/app/lib/chapters/definitions';
import {
  chapterMemoryLabel,
  formatChapterDateRange,
} from '@/app/lib/chapters/format';
import { KeepsakeCard } from '@/components/atlas/keepsake-card';
import { ChapterMapLoader } from './chapter-map-loader';
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
  chapter: AtlasChapter | SharedAtlasChapter;
  mode: 'owner' | 'shared';
  saveNotice?: ChapterSaveNoticeKind;
}) {
  const places = chapter.entries
    .map((entry) => entry.placeLabel || entry.placeName)
    .filter((place): place is string => Boolean(place));
  const showMap = mode === 'owner' || chapter.shareMap;
  const mapEntries = showMap
    ? chapter.entries.flatMap((entry) =>
        typeof entry.latitude === 'number' &&
        typeof entry.longitude === 'number'
          ? [
              {
                id: entry.id,
                title: entry.title,
                placeLabel: entry.placeLabel,
                placeName: entry.placeName,
                latitude: entry.latitude,
                longitude: entry.longitude,
              },
            ]
          : [],
      )
    : [];
  const sharedChapterStart = chapter.introduction
    ? '#chapter-story'
    : showMap
      ? '#chapter-route'
      : '#chapter-memories';

  return (
    <article
      id="chapter-top"
      className={styles.chapterDetail}
      data-reader-mode={mode}
    >
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
          <div className={styles.chapterDetailActions}>
            <ChapterShareControl
              chapterId={chapter.id}
              chapterTitle={chapter.title}
              shareId={chapter.shareId}
              visibility={chapter.visibility}
            />
            <Link href="/sign-up">Start your atlas</Link>
          </div>
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
              sizes={
                mode === 'shared'
                  ? '(max-width: 860px) 100vw, 86rem'
                  : '(max-width: 800px) 100vw, 48vw'
              }
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
          {mode === 'owner' && chapter.introduction ? (
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
          {mode === 'shared' ? (
            <a className={styles.chapterHeroBegin} href={sharedChapterStart}>
              Begin the journey
              <ArrowDownIcon aria-hidden="true" />
            </a>
          ) : null}
        </div>
      </header>

      {mode === 'shared' && chapter.introduction ? (
        <section
          id="chapter-story"
          className={styles.sharedChapterPrologue}
          aria-label="Chapter introduction"
        >
          <div>
            <p className="section-kicker">The field note</p>
            <span aria-hidden="true" />
          </div>
          <p>{chapter.introduction}</p>
        </section>
      ) : null}

      {showMap ? (
        <section
          id="chapter-route"
          className={styles.routeSection}
          aria-labelledby="chapter-route-heading"
        >
          <div className={styles.chapterSectionHeading}>
            <div>
              <p className="section-kicker">The path between</p>
              <h2 id="chapter-route-heading">
                {mode === 'shared'
                  ? 'The route, remembered.'
                  : 'Your route, remembered.'}
              </h2>
            </div>
            <p>
              {mode === 'shared' &&
              chapter.shareLocationPrecision === 'approximate'
                ? 'Shared pins are intentionally approximate.'
                : 'Each stop follows the reading order you chose.'}
            </p>
          </div>
          <ChapterMapLoader entries={mapEntries} />
        </section>
      ) : null}

      <section
        id="chapter-memories"
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
          <p className={styles.sharedChapterFooterCopy}>
            Pin the places, photographs, and field notes that make your story
            yours.
          </p>
          <Link className={styles.sharedChapterFooterCta} href="/sign-up">
            Start your own atlas
            <ArrowRightIcon aria-hidden="true" />
          </Link>
          <a className={styles.sharedChapterBackToTop} href="#chapter-top">
            Back to the beginning
          </a>
        </footer>
      ) : null}
    </article>
  );
}
