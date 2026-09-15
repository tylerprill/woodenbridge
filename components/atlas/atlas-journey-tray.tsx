'use client';

import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BookOpenIcon,
  LightBulbIcon,
  MapPinIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';
import { useEffect, useRef } from 'react';

import type {
  AtlasJourneySuggestion,
  AtlasJourneySummary,
} from '@/app/lib/atlas/journeys/definitions';
import { formatChapterDateRange } from '@/app/lib/chapters/format';
import styles from './atlas.module.css';

type JourneyLoadState = 'idle' | 'loading' | 'ready' | 'error';

function journeyPlace(stop: AtlasJourneySummary['stops'][number] | undefined) {
  return stop?.placeLabel || stop?.placeName || 'Pinned place';
}

function JourneySummaryCopy({ journey }: { journey: AtlasJourneySummary }) {
  const first = journey.stops[0];
  const last = journey.stops.at(-1);
  const hasDistinctEnd =
    first &&
    last &&
    (first.latitude !== last.latitude || first.longitude !== last.longitude);

  return (
    <span className={styles.journeyRowCopy}>
      <strong>{journey.title}</strong>
      <small>
        {formatChapterDateRange(journey.startDate, journey.endDate)} ·{' '}
        {journey.memoryCount}{' '}
        {journey.memoryCount === 1 ? 'memory' : 'memories'}
      </small>
      <em>
        {journeyPlace(first)}
        {hasDistinctEnd ? ` → ${journeyPlace(last)}` : ''}
      </em>
    </span>
  );
}

export function AtlasJourneyTray({
  journeys,
  suggestions,
  selectedJourney,
  selectedStopId,
  loadState,
  errorMessage,
  onClose,
  onRetry,
  onSelectJourney,
  onSelectStop,
  onShowOverview,
  onStartBuilder,
  onStartPlayback,
  onReviewSuggestion,
  onDismissSuggestion,
}: {
  journeys: AtlasJourneySummary[];
  suggestions: AtlasJourneySuggestion[];
  selectedJourney: AtlasJourneySummary | null;
  selectedStopId: string | null;
  loadState: JourneyLoadState;
  errorMessage: string;
  onClose: () => void;
  onRetry: () => void;
  onSelectJourney: (id: string) => void;
  onSelectStop: (id: string) => void;
  onShowOverview: () => void;
  onStartBuilder: (entryIds?: string[]) => void;
  onStartPlayback: (id: string) => void;
  onReviewSuggestion: (suggestion: AtlasJourneySuggestion) => void;
  onDismissSuggestion: (suggestion: AtlasJourneySuggestion) => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [selectedJourney?.id]);

  return (
    <section
      className={`${styles.memoryTray} ${styles.journeyTray}`}
      aria-labelledby="journey-tray-title"
      data-detail={selectedJourney ? 'true' : 'false'}
    >
      <header>
        {selectedJourney ? (
          <button
            type="button"
            className={styles.iconButton}
            onClick={onShowOverview}
            aria-label="Back to journeys"
          >
            <ArrowLeftIcon aria-hidden="true" />
          </button>
        ) : null}
        <div>
          <p className={styles.eyebrow}>
            {selectedJourney ? 'Remembered path' : 'Journey lens'}
          </p>
          <h2 ref={headingRef} id="journey-tray-title" tabIndex={-1}>
            {selectedJourney ? selectedJourney.title : 'Your journeys'}
          </h2>
        </div>
        <button
          type="button"
          className={styles.iconButton}
          onClick={onClose}
          aria-label="Close journeys"
        >
          <XMarkIcon aria-hidden="true" />
        </button>
      </header>

      {selectedJourney ? (
        <div className={styles.journeyDetail}>
          <div className={styles.journeyDetailMeta}>
            <span>
              {formatChapterDateRange(
                selectedJourney.startDate,
                selectedJourney.endDate,
              )}
            </span>
            <span>
              {selectedJourney.memoryCount}{' '}
              {selectedJourney.memoryCount === 1 ? 'memory' : 'memories'}
            </span>
          </div>
          {!selectedJourney.drawable ? (
            <div className={styles.journeyAttention} role="status">
              <strong>This journey needs attention.</strong>
              <p>Add another available memory before drawing its path.</p>
            </div>
          ) : null}
          <ol
            className={styles.journeyStopList}
            aria-label={`${selectedJourney.title} stops`}
          >
            {selectedJourney.stops.map((stop, index) => (
              <li key={stop.entryId}>
                <button
                  type="button"
                  data-active={
                    selectedStopId === stop.entryId ? 'true' : 'false'
                  }
                  aria-current={
                    selectedStopId === stop.entryId ? 'step' : undefined
                  }
                  onClick={() => onSelectStop(stop.entryId)}
                >
                  <span className={styles.journeyStopNumber}>{index + 1}</span>
                  <span>
                    <strong>{stop.title || 'Untitled memory'}</strong>
                    <small>
                      <MapPinIcon aria-hidden="true" />
                      {journeyPlace(stop)}
                    </small>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <div className={styles.journeyOverview}>
          {loadState === 'loading' || loadState === 'idle' ? (
            <div className={styles.journeyLoading} role="status">
              <span aria-hidden="true" />
              <p>Drawing your remembered paths…</p>
            </div>
          ) : loadState === 'error' ? (
            <div className={styles.journeyError} role="alert">
              <strong>Journeys could not be opened.</strong>
              <p>{errorMessage}</p>
              <button type="button" onClick={onRetry}>
                Try again
              </button>
            </div>
          ) : (
            <>
              {suggestions.length ? (
                <section
                  className={styles.journeySuggestions}
                  aria-labelledby="journey-suggestions-title"
                >
                  <div className={styles.journeySectionHeading}>
                    <LightBulbIcon aria-hidden="true" />
                    <h3 id="journey-suggestions-title">Possibly connected</h3>
                  </div>
                  {suggestions.map((suggestion) => (
                    <article key={suggestion.key}>
                      <strong>{suggestion.suggestedTitle}</strong>
                      <p>{suggestion.explanation}</p>
                      <div>
                        <button
                          type="button"
                          onClick={() => onReviewSuggestion(suggestion)}
                        >
                          Review
                        </button>
                        <button
                          type="button"
                          onClick={() => onDismissSuggestion(suggestion)}
                        >
                          Dismiss
                        </button>
                      </div>
                    </article>
                  ))}
                </section>
              ) : null}

              <div className={styles.journeyListActions}>
                <p>
                  {journeys.length
                    ? `${journeys.length} ${journeys.length === 1 ? 'journey' : 'journeys'}`
                    : 'No journeys yet'}
                </p>
                <button type="button" onClick={() => onStartBuilder()}>
                  <PlusIcon aria-hidden="true" /> Create journey
                </button>
              </div>
              {journeys.length ? (
                <div className={styles.journeyList}>
                  {journeys.map((journey, index) => (
                    <button
                      type="button"
                      key={journey.id}
                      onClick={() => onSelectJourney(journey.id)}
                    >
                      <span className={styles.journeyIndex}>
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <JourneySummaryCopy journey={journey} />
                      <ArrowRightIcon aria-hidden="true" />
                    </button>
                  ))}
                </div>
              ) : (
                <div className={styles.emptyTray}>
                  <span aria-hidden="true" />
                  <strong>Turn memories into a journey.</strong>
                  <p>
                    Choose at least two saved memories and shape their story.
                  </p>
                  <div className={styles.journeyEmptyActions}>
                    <button type="button" onClick={() => onStartBuilder()}>
                      Create a journey
                    </button>
                    <Link href="/dashboard/import">Upload photos</Link>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
      {selectedJourney ? (
        <footer className={styles.journeyActions}>
          <button
            type="button"
            onClick={() => onStartPlayback(selectedJourney.id)}
            disabled={!selectedJourney.drawable}
          >
            <PlayIcon aria-hidden="true" /> Relive
          </button>
          <Link href={`/dashboard/chapters/${selectedJourney.id}`}>
            <BookOpenIcon aria-hidden="true" /> Read chapter
          </Link>
          <Link
            href={`/dashboard/chapters/${selectedJourney.id}/edit?source=atlas`}
          >
            <PencilIcon aria-hidden="true" /> Edit
          </Link>
        </footer>
      ) : null}
    </section>
  );
}
