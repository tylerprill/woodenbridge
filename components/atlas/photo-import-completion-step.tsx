'use client';

import { ArrowRightIcon } from '@heroicons/react/24/outline';
import Link from 'next/link';
import type { AtlasEntry, AtlasView } from '@/app/lib/atlas/definitions';
import AtlasMap from './atlas-map-loader';
import type { ImportCompletion } from './photo-import-types';
import styles from './photo-import.module.css';

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
  return (
    <main className={styles.completion}>
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
        <p className="section-kicker">Journey preserved</p>
        <h2>
          {completion?.chapterId
            ? 'Your chapter is ready.'
            : 'Your atlas has a new memory.'}
        </h2>
        <p>
          The original photographs remain yours. Field Atlas has kept the
          places, dates, and words you approved.
        </p>
        <div className={styles.completionActions}>
          {completion?.chapterId ? (
            <Link href={`/dashboard/chapters/${completion.chapterId}`}>
              Open chapter <ArrowRightIcon aria-hidden="true" />
            </Link>
          ) : completion?.entryIds[0] ? (
            <Link href={`/dashboard/card/${completion.entryIds[0]}`}>
              View keepsake <ArrowRightIcon aria-hidden="true" />
            </Link>
          ) : null}
          <Link href="/dashboard">View on the Atlas</Link>
          <button type="button" onClick={onRestart}>
            Import another journey
          </button>
        </div>
      </section>
    </main>
  );
}
