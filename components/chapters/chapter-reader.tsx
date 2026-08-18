import {
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
import { ChapterJumpLink } from './chapter-jump-link';
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
  const journeyStart = places[0];
  const journeyEnd =
    places.length > 1 && places.some((place) => place !== journeyStart)
      ? places[places.length - 1]
      : null;
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
  const chapterStart = chapter.introduction
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
          {journeyStart ? (
            <p
              className={styles.chapterPlaces}
              aria-label={
                journeyEnd
                  ? `From ${journeyStart} to ${journeyEnd}`
                  : journeyStart
              }
            >
              <span>{journeyStart}</span>
              {journeyEnd ? (
                <>
                  <ArrowRightIcon aria-hidden="true" />
                  <span>{journeyEnd}</span>
                </>
              ) : null}
            </p>
          ) : null}
          <ChapterJumpLink
            className={styles.chapterHeroBegin}
            href={chapterStart}
            label={
              mode === 'shared' ? 'Begin the journey' : 'Read your chapter'
            }
          />
        </div>
      </header>

      {chapter.introduction ? (
        <section
          id="chapter-story"
          className={styles.chapterPrologue}
          aria-label="Chapter introduction"
          tabIndex={-1}
        >
          <div>
            <p
              className={`${styles.chapterFocusTarget} section-kicker`}
              data-chapter-focus-target
              tabIndex={-1}
            >
              The field note
            </p>
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
          tabIndex={-1}
        >
          <div className={styles.chapterSectionHeading}>
            <div>
              <p className="section-kicker">The path between</p>
              <h2
                id="chapter-route-heading"
                className={styles.chapterFocusTarget}
                data-chapter-focus-target
                tabIndex={-1}
              >
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
        tabIndex={-1}
      >
        <div className={styles.chapterSectionHeading}>
          <div>
            <p className="section-kicker">The chapter</p>
            <h2
              id="chapter-memories-heading"
              className={styles.chapterFocusTarget}
              data-chapter-focus-target
              tabIndex={-1}
            >
              Memory by memory.
            </h2>
          </div>
          <p>{chapterMemoryLabel(chapter.memoryCount)}, held in sequence.</p>
        </div>
        <ol
          className={styles.chapterTimeline}
          aria-label="Chapter memories in journey order"
        >
          {chapter.entries.map((entry, index) => (
            <li className={styles.chapterStopGroup} key={entry.id}>
              {index > 0 && entry.transitionNote ? (
                <div className={styles.chapterTransition}>
                  <span aria-hidden="true" />
                  <div className={styles.chapterTransitionCopy}>
                    <span>Between stops</span>
                    <p>{entry.transitionNote}</p>
                  </div>
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
            </li>
          ))}
        </ol>
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
