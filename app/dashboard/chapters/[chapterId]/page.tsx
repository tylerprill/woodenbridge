import {
  ArrowLeftIcon,
  CalendarDaysIcon,
  MapPinIcon,
  PencilIcon,
} from '@heroicons/react/24/outline';
import Image from 'next/image';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getAtlasChapter } from '@/app/lib/chapters/data';
import {
  chapterMemoryLabel,
  formatChapterDateRange,
} from '@/app/lib/chapters/format';
import { ChapterMap } from '@/components/chapters/chapter-map';
import styles from '@/components/chapters/chapters.module.css';
import { KeepsakeCard } from '@/components/atlas/keepsake-card';

export default async function ChapterPage({
  params,
}: {
  params: Promise<{ chapterId: string }>;
}) {
  const { chapterId } = await params;
  const chapter = await getAtlasChapter(chapterId);
  if (!chapter) notFound();

  const places = chapter.entries
    .map((entry) => entry.placeLabel || entry.placeName)
    .filter((place): place is string => Boolean(place));

  return (
    <article className={styles.chapterDetail}>
      <nav className={styles.chapterDetailNav} aria-label="Chapter actions">
        <Link href="/dashboard/chapters">
          <ArrowLeftIcon aria-hidden="true" />
          My Chapters
        </Link>
        <Link href={`/dashboard/chapters/${chapter.id}/edit`}>
          <PencilIcon aria-hidden="true" />
          Edit chapter
        </Link>
      </nav>

      <header className={styles.chapterHero} data-has-cover={chapter.coverMedia ? 'true' : 'false'}>
        <div className={styles.chapterHeroArtwork}>
          {chapter.coverMedia ? (
            <Image
              src={chapter.coverMedia.deliveryUrl}
              alt={chapter.coverMedia.altText || ''}
              fill
              sizes="(max-width: 800px) 100vw, 48vw"
              className={styles.chapterHeroImage}
              priority
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
        <div className={styles.chapterHeroStory}>
          <p className="section-kicker">A chapter from your atlas</p>
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

      <section className={styles.routeSection} aria-labelledby="chapter-route-heading">
        <div className={styles.chapterSectionHeading}>
          <div>
            <p className="section-kicker">The path between</p>
            <h2 id="chapter-route-heading">Your route, remembered.</h2>
          </div>
          <p>Each stop follows the reading order you chose.</p>
        </div>
        <ChapterMap entries={chapter.entries} />
      </section>

      <section className={styles.chapterMemories} aria-labelledby="chapter-memories-heading">
        <div className={styles.chapterSectionHeading}>
          <div>
            <p className="section-kicker">The chapter</p>
            <h2 id="chapter-memories-heading">Memory by memory.</h2>
          </div>
          <p>{chapterMemoryLabel(chapter.memoryCount)}, held in sequence.</p>
        </div>
        <div className={styles.chapterTimeline}>
          {chapter.entries.map((entry, index) => (
            <div className={styles.chapterStop} key={entry.id}>
              <div className={styles.chapterStopMarker} aria-hidden="true">
                <span>{String(index + 1).padStart(2, '0')}</span>
              </div>
              <KeepsakeCard
                entry={entry}
                index={String(index + 1).padStart(2, '0')}
                variant="row"
                href={`/dashboard/card/${entry.id}`}
              />
            </div>
          ))}
        </div>
      </section>
    </article>
  );
}
