'use client';

import { ArrowRightIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';
import type { AtlasEntry, AtlasView } from '@/app/lib/atlas/definitions';
import AtlasMap from './atlas-map-loader';
import type { ImportCompletion } from './photo-import-types';
import styles from './photo-import.module.css';

function chapterSuggestionHref(entryIds: string[]) {
  const params = new URLSearchParams({ source: 'import' });
  entryIds.forEach((entryId) => params.append('memory', entryId));
  return `/dashboard/chapters/new?${params.toString()}`;
}

export function PhotoImportCompletionStep({
  completion,
  mapEntries,
  initialView,
  onRestart,
}: {
  completion: ImportCompletion | null;
  mapEntries: AtlasEntry[];
  initialView: AtlasView;
  onRestart: () => void;
}) {
  const chapterId = completion?.chapterId ?? null;
  const entryIds = completion?.entryIds ?? [];
  const firstEntryId = entryIds[0] ?? null;
  const canShapeJourney = !chapterId && entryIds.length > 1;

  return (
    <div className={styles.completion}>
      <div className={styles.completionMap} aria-hidden="true" inert>
        <AtlasMap
          entries={mapEntries}
          initialView={initialView}
          interactionLocked
          selectedId={null}
          placementMode={false}
          focusRequest={{ id: null, nonce: 0 }}
          fitRequest={1}
          onSelect={() => undefined}
          onPlace={() => undefined}
          onViewChange={() => undefined}
        />
        <div className={styles.routeLine}>
          <span />
          <span />
          <span />
        </div>
      </div>
      <section>
        <p className="section-kicker">
          {chapterId
            ? 'Journey preserved'
            : entryIds.length === 1
              ? 'Memory preserved'
              : 'Memories preserved'}
        </p>
        <h2>
          {chapterId
            ? 'Your journey is ready.'
            : entryIds.length === 1
              ? 'Your atlas has a new memory.'
              : 'Your atlas has new memories.'}
        </h2>
        <p>
          The original photographs remain yours. Field Atlas has kept the
          places, dates, and words you approved.
        </p>
        <div className={styles.completionActions}>
          {chapterId ? (
            <Link
              href={`/dashboard?view=journeys&journey=${encodeURIComponent(chapterId)}`}
            >
              View journey on Atlas <ArrowRightIcon aria-hidden="true" />
            </Link>
          ) : canShapeJourney ? (
            <Link href={chapterSuggestionHref(entryIds)}>
              Turn these memories into a journey
              <ArrowRightIcon aria-hidden="true" />
            </Link>
          ) : firstEntryId ? (
            <Link href={`/dashboard/card/${encodeURIComponent(firstEntryId)}`}>
              View keepsake <ArrowRightIcon aria-hidden="true" />
            </Link>
          ) : null}
          {chapterId ? (
            <Link href={`/dashboard/chapters/${encodeURIComponent(chapterId)}`}>
              Read journey
            </Link>
          ) : firstEntryId ? (
            <Link
              href={`/dashboard?memory=${encodeURIComponent(firstEntryId)}`}
            >
              View on the Atlas
            </Link>
          ) : (
            <Link href="/dashboard">View on the Atlas</Link>
          )}
          <button type="button" onClick={onRestart}>
            Upload more photos
          </button>
        </div>
      </section>
    </div>
  );
}
