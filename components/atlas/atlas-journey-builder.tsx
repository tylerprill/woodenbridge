'use client';

import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  CheckIcon,
  MapPinIcon,
  PlusIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import type { AtlasEntry } from '@/app/lib/atlas/definitions';
import type { AtlasJourneySuggestion } from '@/app/lib/atlas/journeys/definitions';
import { getAtlasPlaceContextLabel } from '@/app/lib/atlas/place';
import styles from './atlas.module.css';

const MIN_JOURNEY_MEMORIES = 2;
const MAX_JOURNEY_MEMORIES = 50;

export function chapterBuilderHref(
  entryIds: string[],
  source = 'atlas',
  suggestion?: Pick<
    AtlasJourneySuggestion,
    'key' | 'source' | 'suggestedTitle'
  > | null,
) {
  const query = new URLSearchParams({ source });
  entryIds.forEach((id) => query.append('memory', id));
  if (suggestion) {
    query.set('suggestion', suggestion.key);
    query.set('suggestionSource', suggestion.source);
    query.set('title', suggestion.suggestedTitle);
  }
  return `/dashboard/chapters/new?${query.toString()}`;
}

export function AtlasJourneyBuilder({
  entries,
  selectedEntryIds,
  suggestion = null,
  onToggle,
  onMove,
  onCancel,
}: {
  entries: AtlasEntry[];
  selectedEntryIds: string[];
  suggestion?: AtlasJourneySuggestion | null;
  onToggle: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onCancel: () => void;
}) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [reorderAnnouncement, setReorderAnnouncement] = useState('');
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  const selectedEntries = selectedEntryIds.flatMap((id) => {
    const entry = entriesById.get(id);
    return entry ? [entry] : [];
  });
  const selectedSet = new Set(selectedEntryIds);
  const canContinue = selectedEntryIds.length >= MIN_JOURNEY_MEMORIES;

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <section
      className={`${styles.memoryTray} ${styles.journeyTray} ${styles.journeyBuilder}`}
      aria-labelledby="journey-builder-title"
    >
      <header>
        <button
          type="button"
          className={styles.iconButton}
          onClick={onCancel}
          aria-label="Back to journeys"
        >
          <ArrowLeftIcon aria-hidden="true" />
        </button>
        <div>
          <p className={styles.eyebrow}>Build from the Atlas</p>
          <h2 ref={headingRef} id="journey-builder-title" tabIndex={-1}>
            Choose the memories
          </h2>
        </div>
        <button
          type="button"
          className={styles.iconButton}
          onClick={onCancel}
          aria-label="Cancel journey builder"
        >
          <XMarkIcon aria-hidden="true" />
        </button>
      </header>

      <div className={styles.journeyBuilderBody}>
        <div className={styles.journeyBuilderStatus} role="status">
          <strong>{selectedEntryIds.length} selected</strong>
          <span>
            Choose {MIN_JOURNEY_MEMORIES}–{MAX_JOURNEY_MEMORIES} saved memories.
          </span>
        </div>

        {selectedEntries.length ? (
          <ol className={styles.journeyBuilderSequence}>
            {selectedEntries.map((entry, index) => (
              <li key={entry.id}>
                <span>{index + 1}</span>
                <div>
                  <strong>{entry.title || 'Untitled memory'}</strong>
                  <small>{getAtlasPlaceContextLabel(entry)}</small>
                </div>
                <div>
                  <button
                    type="button"
                    onClick={() => {
                      onMove(entry.id, -1);
                      setReorderAnnouncement(
                        `${entry.title || 'Memory'} moved to position ${index} of ${selectedEntries.length}.`,
                      );
                    }}
                    disabled={index === 0}
                    aria-label={`Move ${entry.title || 'memory'} earlier`}
                  >
                    <ArrowUpIcon aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onMove(entry.id, 1);
                      setReorderAnnouncement(
                        `${entry.title || 'Memory'} moved to position ${index + 2} of ${selectedEntries.length}.`,
                      );
                    }}
                    disabled={index === selectedEntries.length - 1}
                    aria-label={`Move ${entry.title || 'memory'} later`}
                  >
                    <ArrowDownIcon aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggle(entry.id)}
                    aria-label={`Remove ${entry.title || 'memory'} from journey`}
                  >
                    <XMarkIcon aria-hidden="true" />
                  </button>
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <div className={styles.journeyBuilderHint}>
            <MapPinIcon aria-hidden="true" />
            <p>Select pins on the map or choose memories below.</p>
          </div>
        )}

        <div className={styles.journeyBuilderAvailable}>
          <h3>Saved memories</h3>
          {entries.map((entry) => {
            const selected = selectedSet.has(entry.id);
            const limitReached =
              !selected && selectedEntryIds.length >= MAX_JOURNEY_MEMORIES;
            return (
              <button
                type="button"
                key={entry.id}
                data-selected={selected ? 'true' : 'false'}
                aria-pressed={selected}
                disabled={limitReached}
                onClick={() => onToggle(entry.id)}
              >
                <span>
                  {selected ? (
                    <CheckIcon aria-hidden="true" />
                  ) : (
                    <PlusIcon aria-hidden="true" />
                  )}
                </span>
                <span>
                  <strong>{entry.title || 'Untitled memory'}</strong>
                  <small>{getAtlasPlaceContextLabel(entry)}</small>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <footer className={styles.journeyBuilderFooter}>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        {canContinue ? (
          <Link
            href={chapterBuilderHref(selectedEntryIds, 'atlas', suggestion)}
          >
            Shape chapter <ArrowRightIcon aria-hidden="true" />
          </Link>
        ) : (
          <button type="button" disabled>
            Choose {MIN_JOURNEY_MEMORIES - selectedEntryIds.length} more
          </button>
        )}
      </footer>
      <p className="sr-only" role="status" aria-live="polite">
        {reorderAnnouncement}
      </p>
    </section>
  );
}
