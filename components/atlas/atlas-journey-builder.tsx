'use client';

import {
  ArrowDownIcon,
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
  listOpen,
  onListOpenChange,
  onToggle,
  onMove,
  onCancel,
}: {
  entries: AtlasEntry[];
  selectedEntryIds: string[];
  suggestion?: AtlasJourneySuggestion | null;
  listOpen: boolean;
  onListOpenChange: (open: boolean) => void;
  onToggle: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
  onCancel: () => void;
}) {
  const toggleRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [reorderAnnouncement, setReorderAnnouncement] = useState('');
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  const selectedEntries = selectedEntryIds.flatMap((id) => {
    const entry = entriesById.get(id);
    return entry ? [entry] : [];
  });
  const selectedSet = new Set(selectedEntryIds);
  const canContinue = selectedEntryIds.length >= MIN_JOURNEY_MEMORIES;

  useEffect(() => {
    toggleRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (listOpen) listRef.current?.focus({ preventScroll: true });
  }, [listOpen]);

  return (
    <section
      className={styles.journeyBuilder}
      aria-labelledby="journey-builder-title"
    >
      <header>
        <div>
          <h2
            id="journey-builder-title"
            className={listOpen ? undefined : 'sr-only'}
          >
            Choose the memories
          </h2>
          {listOpen ? <p>Pick memories, then arrange your path.</p> : null}
        </div>
      </header>

      <div
        ref={listRef}
        id="atlas-builder-memories"
        className={styles.journeyBuilderBody}
        role="region"
        aria-label="Journey memories"
        tabIndex={0}
        hidden={!listOpen}
      >
        <div className={styles.journeyBuilderStatus}>
          Choose {MIN_JOURNEY_MEMORIES}–{MAX_JOURNEY_MEMORIES} saved memories.
        </div>

        {selectedEntries.length ? (
          <ol
            className={styles.journeyBuilderSequence}
            aria-label="Selected memories"
          >
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
        ) : null}

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
        <button
          type="button"
          className={styles.journeyBuilderCancel}
          onClick={onCancel}
          aria-label="Cancel journey builder"
        >
          <XMarkIcon aria-hidden="true" />
        </button>
        <button
          ref={toggleRef}
          id="atlas-builder-toggle"
          type="button"
          className={styles.journeyBuilderToggle}
          onClick={() => onListOpenChange(!listOpen)}
          aria-label={listOpen ? 'Hide memories' : 'Show memories'}
          aria-expanded={listOpen}
          aria-controls="atlas-builder-memories"
        >
          <MapPinIcon aria-hidden="true" />
          <span>
            <strong role="status" aria-live="polite" aria-atomic="true">
              {selectedEntryIds.length} selected
            </strong>
            <small>{listOpen ? 'Hide memories' : 'Memories'}</small>
          </span>
        </button>
        {canContinue ? (
          <Link
            href={chapterBuilderHref(selectedEntryIds, 'atlas', suggestion)}
          >
            Continue <ArrowRightIcon aria-hidden="true" />
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
