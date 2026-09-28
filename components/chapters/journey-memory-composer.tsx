'use client';

import { MapPinIcon, PlusIcon } from '@heroicons/react/24/outline';
import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from 'react';
import { createPortal } from 'react-dom';

import {
  createAtlasDraftAction,
  resolveAtlasPlaceAction,
} from '@/app/lib/actions/atlas';
import type {
  AtlasEntry,
  AtlasMedia,
  AtlasView,
} from '@/app/lib/atlas/definitions';
import { withAtlasPlaceContext } from '@/app/lib/atlas/place';
import type { AtlasJourneyContinuation } from '@/app/lib/chapters/definitions';
import AtlasMap from '@/components/atlas/atlas-map-loader';
import { MemoryDrawer } from '@/components/atlas/memory-drawer';
import styles from './chapters.module.css';

const DEFAULT_CONTINUATION_VIEW: AtlasView = {
  latitude: 22,
  longitude: -18,
  zoom: 1.65,
  bearing: 0,
  pitch: 0,
};

export function JourneyMemoryComposer({
  journey,
}: {
  journey: AtlasJourneyContinuation;
}) {
  const router = useRouter();
  const initialView = useMemo<AtlasView>(() => {
    if (!journey.latestMemoryLocation) return DEFAULT_CONTINUATION_VIEW;
    return {
      ...journey.latestMemoryLocation,
      zoom: 10,
      bearing: 0,
      pitch: 0,
    };
  }, [journey.latestMemoryLocation]);
  const [view, setView] = useState(initialView);
  const [entry, setEntry] = useState<AtlasEntry | null>(null);
  const [message, setMessage] = useState('');
  const [placeResolving, setPlaceResolving] = useState(false);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!entry) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [entry]);

  const returnToJourney = useCallback(() => {
    router.push(`/dashboard/chapters/${journey.id}`);
  }, [journey.id, router]);

  const placeMemory = useCallback(
    ({ latitude, longitude }: { latitude: number; longitude: number }) => {
      if (isPending || entry) return;
      setMessage('');
      startTransition(async () => {
        try {
          const result = await createAtlasDraftAction({
            clientRequestId: crypto.randomUUID(),
            latitude,
            longitude,
          });
          if (!result.ok) {
            setMessage(result.message);
            return;
          }

          setEntry(result.data);
          setPlaceResolving(true);
          void resolveAtlasPlaceAction(result.data.id)
            .then((resolution) => {
              if (!resolution.ok) {
                setMessage(resolution.message);
                return;
              }
              setEntry((current) =>
                current?.id === resolution.data.entryId
                  ? withAtlasPlaceContext(current, resolution.data.place)
                  : current,
              );
            })
            .catch(() => {
              setMessage(
                'The place name could not be found. You can still name it yourself.',
              );
            })
            .finally(() => setPlaceResolving(false));
        } catch {
          setMessage(
            'The memory could not be started. Check your connection and try again.',
          );
        }
      });
    },
    [entry, isPending],
  );

  const updateMedia = useCallback((entryId: string, media: AtlasMedia[]) => {
    setEntry((current) =>
      current?.id === entryId ? { ...current, media } : current,
    );
  }, []);

  const selectedSegment = journey.segments.find(
    (segment) => segment.id === journey.selectedSegmentId,
  );

  return (
    <section
      className={styles.continueComposer}
      aria-labelledby="continue-journey-heading"
    >
      <div className={styles.continueComposerIntro}>
        <div>
          <p className="section-kicker">Continue {journey.title}</p>
          <h2 id="continue-journey-heading" tabIndex={-1}>
            Place the next memory.
          </h2>
          <p>
            Move the map to the place, then add photos, a title, notes, and the
            time. You can keep the current segment or start the next day before
            saving.
          </p>
        </div>
        <div className={styles.continueTarget}>
          <span>Starting in</span>
          <strong>{selectedSegment?.title ?? 'No segment'}</strong>
          <small>You can change this in the Memory editor.</small>
        </div>
      </div>

      <div
        className={styles.continueMap}
        role="region"
        aria-label="Place a memory"
      >
        <AtlasMap
          entries={[]}
          initialView={initialView}
          interactionLocked={isPending}
          selectedId={null}
          placementMode
          focusRequest={{ id: null, nonce: 0 }}
          fitRequest={0}
          onSelect={() => undefined}
          onPlace={placeMemory}
          onViewChange={setView}
        />
        <div className={styles.continueMapPrompt}>
          <MapPinIcon aria-hidden="true" />
          <div>
            <strong>Where did this memory happen?</strong>
            <span>Tap the map or center the crosshair over the place.</span>
          </div>
          <button
            type="button"
            onClick={() => placeMemory(view)}
            disabled={isPending}
            aria-busy={isPending}
          >
            <PlusIcon aria-hidden="true" />
            {isPending ? 'Opening Memory…' : 'Use map center'}
          </button>
        </div>
      </div>

      {message ? (
        <p className={styles.continueMessage} role="alert">
          {message}
        </p>
      ) : null}

      {entry
        ? createPortal(
            <>
              <div className={styles.continueBackdrop} aria-hidden="true" />
              <MemoryDrawer
                entry={entry}
                onClose={() => setEntry(null)}
                onDirtyChange={() => undefined}
                onUpdate={setEntry}
                onMediaChange={updateMedia}
                onArchive={() => {
                  setEntry(null);
                  returnToJourney();
                }}
                mediaLoading={false}
                placeResolving={placeResolving}
                continuationJourney={journey}
                onContinuationSaved={() => {
                  router.push(
                    `/dashboard/chapters/${journey.id}?saved=continued#chapter-memories`,
                  );
                }}
                surface="journey-editor"
              />
            </>,
            document.body,
          )
        : null}
    </section>
  );
}
