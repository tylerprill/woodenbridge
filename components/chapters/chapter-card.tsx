import { ArrowUpRightIcon, MapPinIcon } from '@heroicons/react/24/outline';
import Image from 'next/image';
import Link from 'next/link';

import type { AtlasChapterSummary } from '@/app/lib/chapters/definitions';
import {
  chapterMemoryLabel,
  formatChapterDateRange,
} from '@/app/lib/chapters/format';
import styles from './chapters.module.css';

export function ChapterCard({
  chapter,
  index,
}: {
  chapter: AtlasChapterSummary;
  index: string;
}) {
  return (
    <article className={styles.chapterCard}>
      <Link
        href={`/dashboard/chapters/${chapter.id}`}
        className={styles.chapterCardLink}
        aria-label={`Open ${chapter.title}`}
      >
        <div className={styles.chapterCardArtwork}>
          {chapter.coverMedia ? (
            <Image
              src={chapter.coverMedia.thumbnailUrl}
              alt={chapter.coverMedia.altText || ''}
              fill
              sizes="(max-width: 760px) 100vw, (max-width: 1180px) 50vw, 33vw"
              className={styles.chapterCardImage}
              unoptimized
            />
          ) : (
            <div className={styles.chapterCardFallback} aria-hidden="true">
              <span />
              <span />
              <span />
            </div>
          )}
          <div className={styles.chapterCardShade} />
          <p className={styles.chapterCardIndex}>{index}</p>
          <div className={styles.chapterCardOpen} aria-hidden="true">
            <ArrowUpRightIcon />
          </div>
        </div>

        <div className={styles.chapterCardBody}>
          <p className={styles.chapterCardMeta}>
            <span>{formatChapterDateRange(chapter.startDate, chapter.endDate)}</span>
            <span aria-hidden="true">·</span>
            <span>{chapterMemoryLabel(chapter.memoryCount)}</span>
          </p>
          <h2>{chapter.title}</h2>
          {chapter.introduction ? (
            <p className={styles.chapterCardIntroduction}>
              {chapter.introduction}
            </p>
          ) : (
            <p className={styles.chapterCardIntroduction}>
              A journey composed from the places in your atlas.
            </p>
          )}
          <p className={styles.chapterCardRoute}>
            <MapPinIcon aria-hidden="true" />
            Follow the route
          </p>
        </div>
      </Link>
    </article>
  );
}
