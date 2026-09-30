'use client';

import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BookOpenIcon,
  ChevronDownIcon,
  MapPinIcon,
  PencilIcon,
  PlayIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';
import { type RefObject, useEffect, useMemo, useRef } from 'react';

import type { AtlasJourneySummary } from '@/app/lib/atlas/journeys/definitions';
import { formatChapterDateRange } from '@/app/lib/chapters/format';
import {
  journeySegmentGroups,
  type JourneyStop,
} from './atlas-journey-segments';
import styles from './atlas.module.css';

type JourneyLoadState = 'idle' | 'loading' | 'ready' | 'error';

function journeyPlace(stop: AtlasJourneySummary['stops'][number] | undefined) {
  return stop?.placeLabel || stop?.placeName || 'Pinned place';
}

function JourneyMemoryList({
  journey,
  stops,
  selectedStopId,
  onSelectStop,
  label,
  activeStopRef,
}: {
  journey: AtlasJourneySummary;
  stops: JourneyStop[];
  selectedStopId: string | null;
  onSelectStop: (id: string) => void;
  label: string;
  activeStopRef: RefObject<HTMLButtonElement | null>;
}) {
  const stopNumbers = new Map(
    journey.stops.map((stop, index) => [stop.entryId, index + 1]),
  );

  return (
    <ol className={styles.journeyStopList} aria-label={label}>
      {stops.map((stop) => (
        <li key={stop.entryId}>
          <button
            ref={selectedStopId === stop.entryId ? activeStopRef : undefined}
            type="button"
            data-active={selectedStopId === stop.entryId ? 'true' : 'false'}
            aria-current={selectedStopId === stop.entryId ? 'step' : undefined}
            onClick={() => onSelectStop(stop.entryId)}
          >
            <span className={styles.journeyStopNumber}>
              {stopNumbers.get(stop.entryId)}
            </span>
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
  );
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
        {journey.segments.length
          ? `${journey.segments.length} ${
              journey.segments.length === 1 ? 'segment' : 'segments'
            } · `
          : ''}
        {journey.memoryCount}{' '}
        {journey.memoryCount === 1 ? 'memory' : 'memories'} ·{' '}
        {formatChapterDateRange(journey.startDate, journey.endDate)}
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
  selectedJourney,
  selectedStopId,
  selectedSegmentKey,
  loadState,
  errorMessage,
  onClose,
  onRetry,
  onSelectJourney,
  onSelectStop,
  onSelectSegment,
  onShowOverview,
  onStartPlayback,
}: {
  journeys: AtlasJourneySummary[];
  selectedJourney: AtlasJourneySummary | null;
  selectedStopId: string | null;
  selectedSegmentKey: string | null;
  loadState: JourneyLoadState;
  errorMessage: string;
  onClose: () => void;
  onRetry: () => void;
  onSelectJourney: (id: string) => void;
  onSelectStop: (id: string) => void;
  onSelectSegment: (key: string | null) => void;
  onShowOverview: () => void;
  onStartPlayback: (id: string) => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const activeStopRef = useRef<HTMLButtonElement>(null);
  const segmentGroups = useMemo(
    () => (selectedJourney ? journeySegmentGroups(selectedJourney) : []),
    [selectedJourney],
  );
  const selectedGroupKey = selectedStopId
    ? segmentGroups.find((group) =>
        group.stops.some((stop) => stop.entryId === selectedStopId),
      )?.key
    : null;
  const openSegmentKey = selectedGroupKey ?? selectedSegmentKey;

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [selectedJourney?.id]);

  useEffect(() => {
    if (!selectedStopId) return;
    activeStopRef.current?.scrollIntoView?.({
      block: 'center',
      inline: 'nearest',
    });
  }, [openSegmentKey, selectedStopId]);

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
            {selectedJourney.segments.length ? (
              <span>
                {selectedJourney.segments.length}{' '}
                {selectedJourney.segments.length === 1 ? 'segment' : 'segments'}
              </span>
            ) : null}
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
          {segmentGroups.length ? (
            <ol
              className={styles.journeySegmentList}
              aria-label={`${selectedJourney.title} segments`}
            >
              {segmentGroups.map((group) => {
                const panelId = `journey-segment-${selectedJourney.id}-${group.key}`;
                const expanded = openSegmentKey === group.key;

                return (
                  <li className={styles.journeySegment} key={group.key}>
                    <h3>
                      <button
                        type="button"
                        className={styles.journeySegmentHeading}
                        aria-expanded={expanded}
                        aria-controls={panelId}
                        onClick={() =>
                          onSelectSegment(
                            openSegmentKey === group.key ? null : group.key,
                          )
                        }
                      >
                        <span>
                          <small>{group.eyebrow}</small>
                          <strong>{group.title}</strong>
                          <em>
                            {group.stops.length
                              ? `${formatChapterDateRange(
                                  group.startDate,
                                  group.endDate,
                                )} · `
                              : ''}
                            {group.stops.length}{' '}
                            {group.stops.length === 1 ? 'memory' : 'memories'}
                          </em>
                        </span>
                        <ChevronDownIcon aria-hidden="true" />
                      </button>
                    </h3>
                    <div id={panelId} hidden={!expanded}>
                      {group.stops.length ? (
                        <JourneyMemoryList
                          journey={selectedJourney}
                          stops={group.stops}
                          selectedStopId={selectedStopId}
                          onSelectStop={onSelectStop}
                          label={`${group.eyebrow}: ${group.title} memories`}
                          activeStopRef={activeStopRef}
                        />
                      ) : (
                        <p className={styles.journeySegmentEmpty}>
                          No memories here yet.
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          ) : (
            <JourneyMemoryList
              journey={selectedJourney}
              stops={selectedJourney.stops}
              selectedStopId={selectedStopId}
              onSelectStop={onSelectStop}
              label={`${selectedJourney.title} stops`}
              activeStopRef={activeStopRef}
            />
          )}
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
              <div className={styles.journeyListActions}>
                <p>
                  {journeys.length
                    ? `${journeys.length} ${journeys.length === 1 ? 'journey' : 'journeys'}`
                    : 'No journeys yet'}
                </p>
                <Link href="/dashboard/chapters">All journeys</Link>
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
                  <strong>Your first journey starts with memories.</strong>
                  <p>
                    Create and arrange journeys from the Journeys page, then
                    return here to explore their paths.
                  </p>
                  <div className={styles.journeyEmptyActions}>
                    <Link href="/dashboard/chapters">Open Journeys</Link>
                    <Link href="/dashboard?new=memory">Add memory</Link>
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
            aria-label="Relive"
            onClick={() => onStartPlayback(selectedJourney.id)}
            disabled={!selectedJourney.drawable}
          >
            <PlayIcon aria-hidden="true" /> <span>Relive</span>
          </button>
          <Link
            href={`/dashboard/chapters/${selectedJourney.id}`}
            aria-label="Read journey"
          >
            <BookOpenIcon aria-hidden="true" />
            <span className={styles.journeyActionFull}>Read journey</span>
            <span className={styles.journeyActionCompact} aria-hidden="true">
              Read
            </span>
          </Link>
          <Link
            href={`/dashboard/chapters/${selectedJourney.id}/edit?source=atlas`}
            aria-label="Edit journey"
          >
            <PencilIcon aria-hidden="true" /> <span>Edit</span>
          </Link>
        </footer>
      ) : null}
    </section>
  );
}
