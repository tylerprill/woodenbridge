'use client';

import {
  ArrowUpRightIcon,
  MapPinIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

import type { AtlasEntry } from '@/app/lib/atlas/definitions';
import {
  formatAtlasDate,
  getAtlasPlaceContextLabel,
} from '@/app/lib/atlas/place';
import styles from './atlas.module.css';

type MemoryTrayProps = {
  entries: AtlasEntry[];
  hasAnyEntries: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
};

export function MemoryTray({
  entries,
  hasAnyEntries,
  onClose,
  onSelect,
}: MemoryTrayProps) {
  return (
    <section className={styles.memoryTray} aria-labelledby="memory-tray-title">
      <header>
        <div>
          <p className={styles.eyebrow}>Field notes</p>
          <h2 id="memory-tray-title">Your memories</h2>
        </div>
        <button
          type="button"
          className={styles.iconButton}
          onClick={onClose}
          aria-label="Close memory list"
        >
          <XMarkIcon aria-hidden="true" />
        </button>
      </header>
      <div className={styles.memoryTrayList}>
        {entries.length ? (
          entries.map((entry, index) => (
            <button
              type="button"
              className={styles.memoryRow}
              key={entry.id}
              onClick={() => onSelect(entry.id)}
            >
              <span className={styles.memoryIndex}>
                {String(index + 1).padStart(2, '0')}
              </span>
              <span className={styles.memoryRowCopy}>
                <strong>{entry.title || 'Untitled place'}</strong>
                <small>
                  <MapPinIcon aria-hidden="true" />
                  {getAtlasPlaceContextLabel(entry)}
                </small>
                <em data-draft={entry.recordState === 'draft' ? 'true' : null}>
                  {entry.recordState === 'draft'
                    ? 'Draft · Finish this memory'
                    : formatAtlasDate(entry)}
                </em>
              </span>
              <ArrowUpRightIcon aria-hidden="true" />
            </button>
          ))
        ) : (
          <div className={styles.emptyTray}>
            <span aria-hidden="true" />
            <strong>
              {hasAnyEntries
                ? 'No places match this view.'
                : 'No memories yet.'}
            </strong>
            <p>
              {hasAnyEntries
                ? 'Try another filter or search term.'
                : 'Place your first pin and begin the record.'}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
