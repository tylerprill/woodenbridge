import {
  ArrowRightIcon,
  CalendarDaysIcon,
  GlobeAltIcon,
  LockClosedIcon,
  MapPinIcon,
  PhotoIcon,
} from '@heroicons/react/24/outline';
import Image from 'next/image';
import Link from 'next/link';
import type { ReactNode } from 'react';

import { getAtlasPlaceContextLabel } from '@/app/lib/atlas/place';
import {
  formatCalendarDate,
  onThisDayHref,
} from '@/app/lib/atlas/rediscovery/dates';
import type {
  RediscoveredMemory,
  RediscoveryData,
} from '@/app/lib/atlas/rediscovery/definitions';
import { BridgeScene } from '@/components/clean/bridge-scene';
import styles from './on-this-day.module.css';

function MemoryCard({
  memory: { entry, journey },
  eager,
}: {
  memory: RediscoveredMemory;
  eager: boolean;
}) {
  const title = entry.title.trim() || 'Untitled memory';
  const place = getAtlasPlaceContextLabel(entry);
  const photo = entry.media[0];

  return (
    <article className={styles.memoryCard}>
      <Link
        className={styles.memoryLink}
        href={`/dashboard/card/${encodeURIComponent(entry.id)}`}
        prefetch={false}
        aria-label={`Open ${title} memory — ${place}`}
      >
        <div className={styles.artwork}>
          {photo ? (
            <Image
              src={photo.thumbnailUrl}
              alt={photo.altText.trim() || title}
              fill
              sizes="(max-width: 680px) 100vw, (max-width: 1180px) 50vw, 33vw"
              loading={eager ? 'eager' : 'lazy'}
              fetchPriority={eager ? 'high' : 'auto'}
              unoptimized
            />
          ) : (
            <BridgeScene className={styles.fallbackArtwork} tone="cedar" />
          )}
          <span className={styles.readMemory}>
            Revisit memory
            <ArrowRightIcon aria-hidden="true" />
          </span>
        </div>
        <div className={styles.memoryCopy}>
          <p className={styles.memoryDate}>
            <CalendarDaysIcon aria-hidden="true" />
            {entry.visitedOn ? (
              <time dateTime={entry.visitedOn}>
                {formatCalendarDate(entry.visitedOn, {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </time>
            ) : (
              <span>Date not set</span>
            )}
          </p>
          <h3>{title}</h3>
          <p className={styles.memoryPlace}>
            <MapPinIcon aria-hidden="true" />
            <span>{place}</span>
          </p>
          {entry.description.trim() ? (
            <p className={styles.memoryDescription}>{entry.description}</p>
          ) : null}
        </div>
      </Link>
      <div className={styles.memoryActions}>
        <Link
          href={`/dashboard?memory=${encodeURIComponent(entry.id)}`}
          prefetch={false}
        >
          <GlobeAltIcon aria-hidden="true" />
          View on Atlas
        </Link>
        {journey ? (
          <Link
            href={`/dashboard/chapters/${encodeURIComponent(journey.id)}`}
            prefetch={false}
            aria-label={`Read journey: ${journey.title}`}
            className={styles.journeyLink}
          >
            <span>{journey.title.trim() || 'Read journey'}</span>
            <ArrowRightIcon aria-hidden="true" />
          </Link>
        ) : null}
      </div>
    </article>
  );
}

export function OnThisDay({
  data,
  controls,
}: {
  data: RediscoveryData;
  controls: ReactNode;
}) {
  const day = formatCalendarDate(data.date, {
    month: 'long',
    day: 'numeric',
  });
  const selectedYear = Number(data.date.slice(0, 4));
  const anniversary = data.mode === 'anniversary';
  const groups = new Map<string, RediscoveredMemory[]>();

  if (anniversary) {
    for (const memory of data.memories) {
      const year = memory.entry.visitedOn?.slice(0, 4) || 'Undated memories';
      const memories = groups.get(year) ?? [];
      memories.push(memory);
      groups.set(year, memories);
    }
  }

  return (
    <div className={`dashboard-page ${styles.page}`}>
      <header className={styles.header}>
        <div className={styles.headingCopy}>
          <p className="section-kicker">Your atlas, revisited</p>
          <h1>On this day</h1>
          <p className={styles.introduction}>
            Some places stay with you. Take a moment to return to them.
          </p>
          <p className={styles.privateNote}>
            <LockClosedIcon aria-hidden="true" />
            Only you can see these memories.
          </p>
        </div>
        <div className={styles.controls}>{controls}</div>
      </header>

      <section className={styles.dayNote} aria-label="Selected memory date">
        <CalendarDaysIcon aria-hidden="true" />
        <div>
          <time dateTime={data.date}>{formatCalendarDate(data.date)}</time>
          <p>
            {anniversary && data.total > 0
              ? `${data.total} ${data.total === 1 ? 'memory' : 'memories'} from ${day} in earlier years.`
              : `No memories from ${day} in earlier years.`}
          </p>
        </div>
      </section>

      {data.memories.length ? (
        anniversary ? (
          <div className={styles.yearGroups}>
            {Array.from(groups.entries())
              .sort(([first], [second]) => second.localeCompare(first))
              .map(([year, memories], groupIndex) => {
                const yearsEarlier = selectedYear - Number(year);
                return (
                  <section
                    className={styles.memoryGroup}
                    aria-labelledby={`rediscovery-year-${year}`}
                    key={year}
                  >
                    <div className={styles.groupHeading}>
                      <h2 id={`rediscovery-year-${year}`}>{year}</h2>
                      {Number.isFinite(yearsEarlier) && yearsEarlier > 0 ? (
                        <p>
                          {yearsEarlier} {yearsEarlier === 1 ? 'year' : 'years'}{' '}
                          earlier
                        </p>
                      ) : null}
                    </div>
                    <div className={styles.memoryGrid}>
                      {memories.map((memory, index) => (
                        <MemoryCard
                          key={memory.entry.id}
                          memory={memory}
                          eager={groupIndex === 0 && index === 0}
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
          </div>
        ) : (
          <section
            className={styles.memoryGroup}
            aria-labelledby="rediscovery-recent-heading"
          >
            <div className={styles.groupHeading}>
              <div>
                <p className="section-kicker">
                  Another moment worth revisiting
                </p>
                <h2 id="rediscovery-recent-heading">Recent memories</h2>
              </div>
              <p>These are recent visits, not anniversary matches.</p>
            </div>
            <div
              className={`${styles.memoryGrid} ${styles.uniformMemoryGrid}`}
              data-memory-grid="recent"
            >
              {data.memories.map((memory, index) => (
                <MemoryCard
                  key={memory.entry.id}
                  memory={memory}
                  eager={index === 0}
                />
              ))}
            </div>
          </section>
        )
      ) : (
        <section
          className={styles.empty}
          aria-labelledby="rediscovery-empty-title"
        >
          <span className={styles.emptyIcon} aria-hidden="true">
            <PhotoIcon />
          </span>
          <p className="section-kicker">A collection waiting to grow</p>
          <h2 id="rediscovery-empty-title">
            Your memories will meet you here.
          </h2>
          <p>
            Upload photographs from a past visit and add its date. As your atlas
            grows, this page brings those days back into view.
          </p>
          <div className={styles.emptyActions}>
            <Link href="/dashboard/import" className={styles.primaryAction}>
              <PhotoIcon aria-hidden="true" />
              Upload photos
            </Link>
            <Link href="/dashboard" prefetch={false}>
              Open Atlas
              <ArrowRightIcon aria-hidden="true" />
            </Link>
          </div>
        </section>
      )}

      {data.memories.length > 0 && data.totalPages > 1 ? (
        <nav className={styles.pagination} aria-label="Memory pages">
          {data.page > 1 ? (
            <Link href={onThisDayHref(data.date, data.page - 1)}>Previous</Link>
          ) : (
            <span />
          )}
          <p>
            Page {data.page} of {data.totalPages}
          </p>
          {data.page < data.totalPages ? (
            <Link href={onThisDayHref(data.date, data.page + 1)}>Next</Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
    </div>
  );
}
