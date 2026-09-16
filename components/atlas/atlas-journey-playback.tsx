'use client';

import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BookOpenIcon,
  PauseIcon,
  PlayIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useRef } from 'react';

import type { AtlasJourneyDetail } from '@/app/lib/atlas/journeys/definitions';
import styles from './atlas.module.css';

export function AtlasJourneyPlayback({
  journey,
  stopIndex,
  playing,
  loading,
  errorMessage,
  onPrevious,
  onNext,
  onTogglePlaying,
  onExit,
  onRetry,
}: {
  journey: AtlasJourneyDetail | null;
  stopIndex: number;
  playing: boolean;
  loading: boolean;
  errorMessage: string;
  onPrevious: () => void;
  onNext: () => void;
  onTogglePlaying: () => void;
  onExit: () => void;
  onRetry: () => void;
}) {
  const stop = journey?.stops[stopIndex] ?? null;
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <section
      className={`${styles.memoryTray} ${styles.journeyTray} ${styles.journeyPlayback}`}
      aria-labelledby="journey-playback-title"
    >
      <header>
        <div>
          <p className={styles.eyebrow}>Relive journey</p>
          <h2 ref={headingRef} id="journey-playback-title" tabIndex={-1}>
            {journey?.title ?? 'Opening journey…'}
          </h2>
        </div>
        <button
          type="button"
          className={styles.iconButton}
          onClick={onExit}
          aria-label="Exit journey playback"
        >
          <XMarkIcon aria-hidden="true" />
        </button>
      </header>

      {loading ? (
        <div className={styles.journeyLoading} role="status">
          <span aria-hidden="true" />
          <p>Opening the first memory…</p>
        </div>
      ) : !journey || !stop ? (
        <div className={styles.journeyError} role="alert">
          <strong>This journey could not be relived.</strong>
          <p>{errorMessage}</p>
          <button type="button" onClick={onRetry}>
            Try again
          </button>
        </div>
      ) : (
        <>
          <div
            className={styles.journeyPlaybackBody}
            role="region"
            aria-label={`Stop ${stopIndex + 1} details`}
            aria-live="polite"
            aria-atomic="true"
            tabIndex={0}
          >
            <div
              className={styles.journeyPlaybackArtwork}
              data-has-image={stop.thumbnailUrl ? 'true' : 'false'}
            >
              {stop.thumbnailUrl ? (
                <Image
                  src={stop.thumbnailUrl}
                  alt={stop.thumbnailAlt}
                  fill
                  sizes="(max-width: 760px) 100vw, 24rem"
                  unoptimized
                />
              ) : (
                <span aria-hidden="true">{stopIndex + 1}</span>
              )}
            </div>
            <p className={styles.journeyPlaybackProgress}>
              Stop {stopIndex + 1} of {journey.stops.length}
            </p>
            <h3>{stop.title || 'Untitled memory'}</h3>
            <p className={styles.journeyPlaybackPlace}>
              {stop.placeLabel || stop.placeName || 'Pinned place'}
            </p>
            {stop.transitionNote && stopIndex > 0 ? (
              <blockquote>{stop.transitionNote}</blockquote>
            ) : null}
            {stop.description ? <p>{stop.description}</p> : null}
          </div>

          <div
            className={styles.journeyPlaybackControls}
            role="group"
            aria-label="Journey playback"
          >
            <button
              type="button"
              onClick={onPrevious}
              disabled={stopIndex === 0}
              aria-label="Previous stop"
            >
              <ArrowLeftIcon aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={onTogglePlaying}
              aria-label={playing ? 'Pause journey' : 'Play journey'}
            >
              {playing ? (
                <PauseIcon aria-hidden="true" />
              ) : (
                <PlayIcon aria-hidden="true" />
              )}
              <span>{playing ? 'Pause' : 'Play'}</span>
            </button>
            <button
              type="button"
              onClick={onNext}
              disabled={stopIndex === journey.stops.length - 1}
              aria-label="Next stop"
            >
              <ArrowRightIcon aria-hidden="true" />
            </button>
          </div>
          <div className={styles.journeyPlaybackFooter}>
            <button type="button" onClick={onExit}>
              Exit playback
            </button>
            <Link href={`/dashboard/chapters/${journey.id}`}>
              <BookOpenIcon aria-hidden="true" /> Read full journey
            </Link>
          </div>
        </>
      )}
    </section>
  );
}
