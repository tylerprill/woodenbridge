'use client';

import {
  ArrowUpRightIcon,
  MapPinIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';

import type { AtlasEntry } from '@/app/lib/atlas/definitions';
import styles from './atlas.module.css';

type MemoryTrayProps = {
  entries: AtlasEntry[];
  onClose: () => void;
  onSelect: (id: string) => void;
};

function formatDate(entry: AtlasEntry) {
  if (!entry.visitedOn)
    return entry.journeyState === 'visited' ? 'Date open' : 'Future journey';
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(`${entry.visitedOn}T12:00:00`));
}

export function MemoryTray({ entries, onClose, onSelect }: MemoryTrayProps) {
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
                  {entry.placeLabel ||
                    `${entry.latitude.toFixed(2)}, ${entry.longitude.toFixed(2)}`}
                </small>
                <em>{formatDate(entry)}</em>
              </span>
              <ArrowUpRightIcon aria-hidden="true" />
            </button>
          ))
        ) : (
          <div className={styles.emptyTray}>
            <span aria-hidden="true" />
            <strong>No memories here yet.</strong>
            <p>Place your first pin and begin the record.</p>
          </div>
        )}
      </div>
    </section>
  );
}
