'use client';

import {
  ArrowUpTrayIcon,
  MapPinIcon,
  PhotoIcon,
  PlusIcon,
} from '@heroicons/react/24/outline';
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
import { ATLAS_MEDIA_MAX_FILES } from '@/app/lib/atlas/media-policy';
import { withAtlasPlaceContext } from '@/app/lib/atlas/place';
import { analyzeAtlasImportPhoto } from '@/app/lib/atlas/photo-import-client';
import { getAtlasPhotoFileProblem } from '@/app/lib/atlas/photo-upload-validation';
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
  const [initialPhotoFiles, setInitialPhotoFiles] = useState<File[]>([]);
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
    (
      coordinates: { latitude: number; longitude: number },
      photoFiles: File[] = [],
    ) => {
      if (isPending || entry) return;
      setMessage('');
      startTransition(async () => {
        try {
          if (photoFiles.length > ATLAS_MEDIA_MAX_FILES) {
            setMessage(
              `Choose up to ${ATLAS_MEDIA_MAX_FILES} photos for one Memory.`,
            );
            return;
          }

          const invalidFile = photoFiles.find((file) =>
            getAtlasPhotoFileProblem(file),
          );
          if (invalidFile) {
            setMessage(
              `${invalidFile.name}: ${getAtlasPhotoFileProblem(invalidFile)}`,
            );
            return;
          }

          let { latitude, longitude } = coordinates;
          if (photoFiles[0]) {
            const analysis = await analyzeAtlasImportPhoto(photoFiles[0]);
            const blockingIssue = analysis.issues.find(
              (issue) => issue.severity === 'error',
            );
            if (blockingIssue || !analysis.canPrepare) {
              setMessage(
                `${photoFiles[0].name}: ${blockingIssue?.message ?? 'This photograph could not be prepared.'}`,
              );
              return;
            }
            if (analysis.location) {
              latitude = analysis.location.latitude;
              longitude = analysis.location.longitude;
            }
          }

          const result = await createAtlasDraftAction({
            clientRequestId: crypto.randomUUID(),
            latitude,
            longitude,
          });
          if (!result.ok) {
            setMessage(result.message);
            return;
          }

          setInitialPhotoFiles(photoFiles);
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
        } catch (error) {
          console.error('Journey memory could not be started:', error);
          setMessage(
            'The memory could not be started. Check your connection and try again.',
          );
        }
      });
    },
    [entry, isPending],
  );

  const closeEditor = useCallback(() => {
    setInitialPhotoFiles([]);
    setEntry(null);
  }, []);

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
            Start with photos or a place.
          </h2>
          <p>
            Start with photos or choose the place on the map. Photo location is
            used when available; otherwise Atlas starts from the map center.
          </p>
          <label
            className={styles.continuePhotoStart}
            data-disabled={isPending || entry ? 'true' : 'false'}
          >
            <PhotoIcon aria-hidden="true" />
            <span>
              <strong>{isPending ? 'Opening Memory…' : 'Upload photos'}</strong>
              <small>
                Choose up to {ATLAS_MEDIA_MAX_FILES} images for this Memory
              </small>
            </span>
            <ArrowUpTrayIcon aria-hidden="true" />
            <input
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif"
              aria-label="Start memory with photos"
              disabled={isPending || Boolean(entry)}
              onChange={(event) => {
                const files = Array.from(event.currentTarget.files ?? []);
                event.currentTarget.value = '';
                if (files.length) placeMemory(view, files);
              }}
            />
          </label>
        </div>
        <div className={styles.continueTarget}>
          <span>Starting in</span>
          <strong>{selectedSegment?.title ?? 'No segment'}</strong>
          <small>You can change this in the Memory editor.</small>
        </div>
      </div>

      {message ? (
        <p className={styles.continueMessage} role="alert">
          {message}
        </p>
      ) : null}

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

      {entry
        ? createPortal(
            <>
              <div className={styles.continueBackdrop} aria-hidden="true" />
              <MemoryDrawer
                entry={entry}
                onClose={closeEditor}
                onDirtyChange={() => undefined}
                onUpdate={setEntry}
                onMediaChange={updateMedia}
                onArchive={() => {
                  setEntry(null);
                  returnToJourney();
                }}
                mediaLoading={false}
                placeResolving={placeResolving}
                initialPhotoFiles={initialPhotoFiles}
                onInitialPhotoFilesConsumed={() => setInitialPhotoFiles([])}
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
