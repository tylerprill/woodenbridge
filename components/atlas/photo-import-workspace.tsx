'use client';

import {
  ArrowLeftIcon,
  ArrowPathIcon,
  CheckCircleIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { upload } from '@vercel/blob/client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  cancelAtlasImportBatchAction,
  createAtlasImportBatchAction,
  finalizeAtlasImportBatchAction,
  prepareAtlasImportItemAction,
  resolveAtlasImportPlaceAction,
} from '@/app/lib/actions/atlas-import';
import {
  getAtlasImportMediaPairStatusAction,
  registerAtlasMediaAction,
} from '@/app/lib/actions/atlas-media';
import type {
  AtlasImportBatch,
  AtlasImportFinalization,
  CreateAtlasImportBatchInput,
} from '@/app/lib/atlas/import-definitions';
import {
  createAtlasMediaPath,
  createAtlasThumbnailPath,
  isAllowedAtlasMediaType,
} from '@/app/lib/atlas/media-policy';
import {
  analyzeAtlasImportPhoto,
  prepareAtlasImportPhoto,
  prepareAtlasImportPreview,
} from '@/app/lib/atlas/photo-import-client';
import { PhotoImportChapterStep } from './photo-import-chapter-step';
import { PhotoImportChooseStep } from './photo-import-choose-step';
import { PhotoImportCompletionStep } from './photo-import-completion-step';
import {
  ImportLeaveDialog,
  ImportLocationDialog,
} from './photo-import-dialogs';
import {
  applyImportAnalysis,
  createAnalyzingImportItem,
  formatImportSize,
  getImportFileProblem,
  getImportPlaceLabel,
  needsFileDateConfirmation,
  normalizeImportPlace,
  sortImportItems,
  toImportMapEntry,
  unwrapAction,
} from './photo-import-helpers';
import { PhotoImportReviewStep } from './photo-import-review-step';
import { PhotoImportStoriesStep } from './photo-import-stories-step';
import { ImportHeading, ImportNotice, ImportProgress } from './photo-import-ui';
import {
  IMPORT_DEFAULT_VIEW,
  MAX_IMPORT_PHOTOS,
  sourceMimeType,
  type ActiveBatch,
  type BatchMapping,
  type CaptureDateSource,
  type ImportCompletion,
  type ImportItem,
  type ImportStep,
  type LocationSource,
} from './photo-import-types';
import styles from './photo-import.module.css';

const ANALYSIS_CONCURRENCY = 3;
const MAX_SHORT_PLACE_RETRIES = 6;
const MAX_PROVIDER_PLACE_RETRIES = 1;
const MAX_CONSECUTIVE_PROVIDER_FAILURES = 3;
const PROVIDER_OUTAGE_MESSAGE =
  'Place recognition is temporarily paused. Every pin is safe; name places yourself or try them again later.';

type UploadedVariants = {
  original: { pathname: string } | null;
  thumbnail: { pathname: string } | null;
};

type PlaceResolution = {
  item: ImportItem;
  providerFailure: boolean;
};

function importAbortError() {
  return new DOMException('Photo import work was cancelled.', 'AbortError');
}

function isImportAbort(error: unknown) {
  return Boolean(
    error &&
    typeof error === 'object' &&
    'name' in error &&
    error.name === 'AbortError',
  );
}

function placeRetryJitter(item: ImportItem, attempt: number) {
  const latitude = Math.round(Math.abs(item.latitude ?? 0) * 1_000);
  const longitude = Math.round(Math.abs(item.longitude ?? 0) * 1_000);
  return 25 + ((latitude + longitude + attempt * 17) % 51);
}

function waitForPlaceRetry(milliseconds: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(importAbortError());
      return;
    }
    const finish = () => {
      signal?.removeEventListener('abort', cancel);
      resolve();
    };
    const timeout = window.setTimeout(finish, milliseconds);
    const cancel = () => {
      window.clearTimeout(timeout);
      signal?.removeEventListener('abort', cancel);
      reject(importAbortError());
    };
    signal?.addEventListener('abort', cancel, { once: true });
  });
}

async function withConcurrency<T, R>(
  values: T[],
  limit: number,
  run: (value: T, index: number) => Promise<R>,
) {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  const workers = Array.from(
    { length: Math.min(limit, values.length) },
    async () => {
      while (nextIndex < values.length) {
        const index = nextIndex;
        nextIndex += 1;
        results[index] = await run(values[index], index);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

function recoveryMapping(batch: AtlasImportBatch): ActiveBatch {
  return {
    batchId: batch.id,
    version: batch.version,
    createChapter: batch.coverClientItemId !== null,
    coverClientItemId: batch.coverClientItemId,
    items: batch.items.map((item) => ({
      clientItemId: item.clientItemId,
      itemId: item.id,
      entryId: item.entryId,
      mediaId: item.mediaId,
    })),
  };
}

export function PhotoImportWorkspace({
  recoveredBatch = null,
}: {
  recoveredBatch?: AtlasImportBatch | null;
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previewUrlsRef = useRef(new Set<string>());
  const selectionRunRef = useRef(0);
  const selectionAbortRef = useRef<AbortController | null>(null);
  const removedItemIdsRef = useRef(new Set<string>());
  const clientRequestIdRef = useRef<string | null>(null);
  const placeCacheRef = useRef(
    new Map<
      string,
      Pick<ImportItem, 'place' | 'placeLabel' | 'state' | 'error'>
    >(),
  );
  const locationRequestRef = useRef(0);
  const placeOutageRef = useRef(false);
  const locationAbortRef = useRef<AbortController | null>(null);
  const uploadedItemIdsRef = useRef(new Set<string>());
  const uploadedVariantsRef = useRef(new Map<string, UploadedVariants>());
  const [step, setStep] = useState<ImportStep>('choose');
  const [items, setItems] = useState<ImportItem[]>([]);
  const [storyIndex, setStoryIndex] = useState(0);
  const [chapterTitle, setChapterTitle] = useState('');
  const [chapterIntroduction, setChapterIntroduction] = useState('');
  const [coverClientItemId, setCoverClientItemId] = useState<string | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [selectionProcessing, setSelectionProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [rejections, setRejections] = useState<string[]>([]);
  const [locationEditorId, setLocationEditorId] = useState<string | null>(null);
  const [activeBatch, setActiveBatch] = useState<ActiveBatch | null>(null);
  const [completion, setCompletion] = useState<ImportCompletion | null>(null);
  const [leaveHref, setLeaveHref] = useState<string | null>(null);
  const [cancelArmed, setCancelArmed] = useState(false);
  const [openRecovery, setOpenRecovery] = useState(recoveredBatch);

  const activeItems = useMemo(
    () =>
      items.filter(
        (item) => item.state !== 'duplicate' && item.state !== 'error',
      ),
    [items],
  );
  const includeChapter = activeItems.length > 1;
  const currentStory = activeItems[storyIndex] ?? null;
  const locationItem =
    items.find((item) => item.clientItemId === locationEditorId) ?? null;
  const recoveredCover =
    openRecovery?.coverClientItemId === null ||
    openRecovery?.coverClientItemId === undefined
      ? null
      : (openRecovery.items.find(
          (item) => item.clientItemId === openRecovery.coverClientItemId,
        ) ?? null);
  const mapEntries = useMemo(
    () =>
      activeItems
        .map(toImportMapEntry)
        .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry)),
    [activeItems],
  );
  const confidentGpsCount = activeItems.filter(
    (item) =>
      item.locationSource === 'photo_gps' &&
      item.analysis?.location?.confidence === 'high',
  ).length;
  const unresolvedCount = activeItems.filter(
    (item) => item.latitude === null || item.longitude === null,
  ).length;
  const locatingCount = activeItems.filter(
    (item) => item.state === 'locating',
  ).length;
  const blockingCount = items.filter((item) => item.state === 'error').length;
  const completedStories = activeItems.filter(
    (item) =>
      item.title.trim() &&
      item.placeLabel.trim() &&
      !needsFileDateConfirmation(item),
  ).length;
  const hasUploadError = items.some((item) => item.uploadState === 'error');
  const totalSize = formatImportSize(
    items.reduce((sum, item) => sum + item.file.size, 0),
  );

  useEffect(() => {
    const previewUrls = previewUrlsRef.current;
    return () => {
      selectionAbortRef.current?.abort();
      locationAbortRef.current?.abort();
      previewUrls.forEach((url) => URL.revokeObjectURL(url));
      previewUrls.clear();
    };
  }, []);

  useEffect(() => {
    if (!items.length || step === 'complete') return;
    const currentHref = window.location.href;
    const originalHistoryState = window.history.state;
    const guardState = {
      ...(originalHistoryState && typeof originalHistoryState === 'object'
        ? originalHistoryState
        : {}),
      __fieldAtlasPhotoImportGuard: true,
    };
    window.history.replaceState(guardState, '', currentHref);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    const interceptNavigation = (event: MouseEvent) => {
      const target = event.target;
      const anchor =
        target instanceof Element
          ? target.closest<HTMLAnchorElement>('a[href]')
          : null;
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        !anchor ||
        anchor.target === '_blank' ||
        anchor.hasAttribute('download')
      )
        return;
      const destination = new URL(anchor.href, window.location.href);
      if (destination.href === window.location.href) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setLeaveHref(destination.href);
    };
    const interceptBackNavigation = () => {
      const attemptedHref = window.location.href;
      window.history.pushState(guardState, '', currentHref);
      setLeaveHref(attemptedHref);
    };
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('popstate', interceptBackNavigation);
    document.addEventListener('click', interceptNavigation, true);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      window.removeEventListener('popstate', interceptBackNavigation);
      document.removeEventListener('click', interceptNavigation, true);
      if (
        window.location.href === currentHref &&
        window.history.state?.__fieldAtlasPhotoImportGuard
      ) {
        window.history.replaceState(originalHistoryState, '', currentHref);
      }
    };
  }, [items.length, step]);

  const focusStep = useCallback(() => {
    window.requestAnimationFrame(() => {
      headingRef.current?.focus({ preventScroll: true });
      window.scrollTo({
        top: 0,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'auto'
          : 'smooth',
      });
    });
  }, []);

  const goToStep = useCallback(
    (nextStep: ImportStep) => {
      setMessage('');
      setProgress(0);
      setStep(nextStep);
      focusStep();
    },
    [focusStep],
  );

  const updateItem = useCallback((id: string, update: Partial<ImportItem>) => {
    setItems((current) =>
      current.map((item) =>
        item.clientItemId === id ? { ...item, ...update } : item,
      ),
    );
  }, []);

  const applyBackgroundPlaceResolution = useCallback(
    (candidate: ImportItem, resolved: ImportItem) => {
      setItems((current) =>
        current.map((item) => {
          if (item.clientItemId !== candidate.clientItemId) return item;
          const stillAtAnalyzedCoordinates =
            item.latitude === candidate.latitude &&
            item.longitude === candidate.longitude &&
            item.locationSource === candidate.locationSource;
          if (!stillAtAnalyzedCoordinates) return item;
          return {
            ...item,
            place: resolved.place,
            placeLabel: item.placeLabelEdited
              ? item.placeLabel
              : resolved.placeLabel,
            state: resolved.state,
            error: resolved.error,
          };
        }),
      );
    },
    [],
  );

  const resolveItemPlace = useCallback(
    async (
      item: ImportItem,
      source: LocationSource = item.locationSource,
      signal?: AbortSignal,
    ) => {
      if (item.latitude === null || item.longitude === null) {
        return { item, providerFailure: false } satisfies PlaceResolution;
      }
      try {
        let pacingAttempt = 0;
        let providerAttempt = 0;
        let place;
        while (true) {
          if (signal?.aborted) throw importAbortError();
          const result = await resolveAtlasImportPlaceAction({
            latitude: item.latitude,
            longitude: item.longitude,
          });
          if (signal?.aborted) throw importAbortError();
          if (result.ok) {
            place = normalizeImportPlace(result.data);
            break;
          }
          if (
            result.error === 'limit' &&
            result.retryAfterMs !== undefined &&
            pacingAttempt < MAX_SHORT_PLACE_RETRIES
          ) {
            pacingAttempt += 1;
            await waitForPlaceRetry(
              result.retryAfterMs + placeRetryJitter(item, pacingAttempt),
              signal,
            );
            continue;
          }
          if (
            result.error === 'provider' &&
            result.retryAfterMs !== undefined &&
            providerAttempt < MAX_PROVIDER_PLACE_RETRIES
          ) {
            providerAttempt += 1;
            await waitForPlaceRetry(
              result.retryAfterMs + placeRetryJitter(item, providerAttempt),
              signal,
            );
            continue;
          }
          if (result.error === 'provider') {
            return {
              item: {
                ...item,
                locationSource: source,
                state: 'ready' as const,
                error: `${result.message} You can still name this place yourself.`,
              },
              providerFailure: true,
            } satisfies PlaceResolution;
          }
          unwrapAction<unknown>(result);
        }
        const detectedLabel = getImportPlaceLabel(place);
        return {
          item: {
            ...item,
            place,
            placeLabel: item.placeLabelEdited ? item.placeLabel : detectedLabel,
            locationSource: source,
            state: 'ready' as const,
            error: '',
          },
          providerFailure: false,
        } satisfies PlaceResolution;
      } catch (error) {
        if (isImportAbort(error)) throw error;
        return {
          item: {
            ...item,
            locationSource: source,
            state: 'ready' as const,
            error:
              error instanceof Error
                ? `${error.message} You can still name this place yourself.`
                : 'Name this place before continuing.',
          },
          providerFailure: false,
        } satisfies PlaceResolution;
      }
    },
    [],
  );

  const enrichPlacesProgressively = useCallback(
    async (candidates: ImportItem[], signal?: AbortSignal) => {
      const groups = new Map<string, ImportItem[]>();
      for (const item of candidates) {
        if (
          item.state === 'duplicate' ||
          item.state === 'error' ||
          item.latitude === null ||
          item.longitude === null
        )
          continue;
        const key = `${item.latitude.toFixed(5)},${item.longitude.toFixed(5)}`;
        groups.set(key, [...(groups.get(key) ?? []), item]);
      }
      const resolvedById = new Map<string, ImportItem>();
      const coordinateGroups = Array.from(groups.entries());
      let consecutiveProviderFailures = 0;
      let providerCircuitOpen = false;
      for (let index = 0; index < coordinateGroups.length; index += 1) {
        if (signal?.aborted) return candidates;
        const [cell, group] = coordinateGroups[index];
        if (providerCircuitOpen) {
          for (const item of group) {
            const resolved = {
              ...item,
              state: 'ready' as const,
              error: PROVIDER_OUTAGE_MESSAGE,
            };
            resolvedById.set(item.clientItemId, resolved);
            applyBackgroundPlaceResolution(item, resolved);
          }
          continue;
        }
        const cached = placeCacheRef.current.get(cell);
        if (cached) {
          consecutiveProviderFailures = 0;
          for (const item of group) {
            const resolved = {
              ...item,
              ...cached,
              placeLabel: item.placeLabelEdited
                ? item.placeLabel
                : cached.placeLabel,
            };
            resolvedById.set(item.clientItemId, resolved);
            applyBackgroundPlaceResolution(item, resolved);
          }
          continue;
        }
        let resolution: PlaceResolution;
        try {
          resolution = await resolveItemPlace(
            group[0],
            group[0].locationSource,
            signal,
          );
        } catch (error) {
          if (isImportAbort(error)) return candidates;
          throw error;
        }
        const representative = resolution.item;
        if (resolution.providerFailure) {
          consecutiveProviderFailures += 1;
          if (
            consecutiveProviderFailures >= MAX_CONSECUTIVE_PROVIDER_FAILURES
          ) {
            providerCircuitOpen = true;
            placeOutageRef.current = true;
            setMessage(PROVIDER_OUTAGE_MESSAGE);
          }
        } else {
          consecutiveProviderFailures = 0;
        }
        const cacheValue = {
          place: representative.place,
          placeLabel: representative.placeLabel,
          state: representative.state,
          error: representative.error,
        };
        if (representative.place) placeCacheRef.current.set(cell, cacheValue);
        for (const item of group) {
          const resolved = {
            ...item,
            ...cacheValue,
            placeLabel: item.placeLabelEdited
              ? item.placeLabel
              : cacheValue.placeLabel,
          };
          resolvedById.set(item.clientItemId, resolved);
          applyBackgroundPlaceResolution(item, resolved);
        }
        setProgress(
          58 +
            Math.round(
              ((index + 1) / Math.max(coordinateGroups.length, 1)) * 42,
            ),
        );
      }
      return candidates.map(
        (item) => resolvedById.get(item.clientItemId) ?? item,
      );
    },
    [applyBackgroundPlaceResolution, resolveItemPlace],
  );

  const chooseFiles = async (selectedFiles: File[]) => {
    if (busy || openRecovery) return;
    const room = MAX_IMPORT_PHOTOS - items.length;
    const considered = selectedFiles.slice(0, Math.max(room, 0));
    const nextRejections: string[] = [];
    if (selectedFiles.length > room) {
      nextRejections.push(
        `This journey has room for ${room} more ${room === 1 ? 'photo' : 'photos'}.`,
      );
    }
    const valid = considered.filter((file) => {
      const problem = getImportFileProblem(file);
      if (problem) nextRejections.push(`${file.name}: ${problem}`);
      return !problem;
    });
    setRejections(nextRejections);
    if (!valid.length) return;

    const selectionRunId = selectionRunRef.current + 1;
    selectionRunRef.current = selectionRunId;
    placeOutageRef.current = false;
    selectionAbortRef.current?.abort();
    const selectionController = new AbortController();
    selectionAbortRef.current = selectionController;
    clientRequestIdRef.current ??= crypto.randomUUID();
    const placeholders = valid.map((file) =>
      createAnalyzingImportItem(file, crypto.randomUUID(), ''),
    );
    setItems((current) => [...current, ...placeholders]);
    if (!coverClientItemId) setCoverClientItemId(placeholders[0].clientItemId);
    setBusy(true);
    setProgress(1);
    setMessage(`Reading 0 of ${valid.length} photographs…`);

    try {
      let analyzedCount = 0;
      const analyzedItems = await withConcurrency(
        placeholders,
        ANALYSIS_CONCURRENCY,
        async (placeholder) => {
          try {
            const analysis = await analyzeAtlasImportPhoto(placeholder.file);
            const analyzed = applyImportAnalysis(placeholder, analysis);
            analyzedCount += 1;
            setProgress(Math.round((analyzedCount / valid.length) * 45));
            setMessage(
              `Reading ${analyzedCount} of ${valid.length} photographs…`,
            );
            updateItem(placeholder.clientItemId, analyzed);
            return analyzed;
          } catch (error) {
            analyzedCount += 1;
            const failed: ImportItem = {
              ...placeholder,
              state: 'error',
              error:
                error instanceof Error
                  ? error.message
                  : 'This photograph could not be read.',
            };
            updateItem(placeholder.clientItemId, failed);
            return failed;
          }
        },
      );

      const existingHashes = new Set(
        items.map((item) => item.contentHash).filter(Boolean),
      );
      const deduplicated = analyzedItems.map((item) => {
        if (!item.contentHash || item.state === 'error') return item;
        if (existingHashes.has(item.contentHash)) {
          const duplicate = { ...item, state: 'duplicate' as const };
          updateItem(item.clientItemId, duplicate);
          return duplicate;
        }
        existingHashes.add(item.contentHash);
        return item;
      });
      setBusy(false);
      setSelectionProcessing(true);
      setMessage(
        'Metadata is ready. Place names and lightweight previews will continue in the background.',
      );
      const previewFailures = new Map<string, string>();
      const previewItems = deduplicated.filter(
        (item) =>
          item.analysis?.canPrepare &&
          item.state !== 'duplicate' &&
          item.state !== 'error',
      );
      await Promise.all([
        (async () => {
          for (let index = 0; index < previewItems.length; index += 1) {
            if (selectionController.signal.aborted) break;
            const item = previewItems[index];
            setMessage(
              `Preparing lightweight preview ${index + 1} of ${previewItems.length}…`,
            );
            try {
              const preview = await prepareAtlasImportPreview(
                item.file,
                item.analysis!,
              );
              if (
                selectionRunId !== selectionRunRef.current ||
                selectionController.signal.aborted ||
                removedItemIdsRef.current.has(item.clientItemId)
              ) {
                continue;
              }
              const previewUrl = URL.createObjectURL(preview.blob);
              previewUrlsRef.current.add(previewUrl);
              const previewUpdate = {
                previewUrl,
                width: preview.width,
                height: preview.height,
              };
              Object.assign(item, previewUpdate);
              updateItem(item.clientItemId, previewUpdate);
              setProgress(
                45 +
                  Math.round(
                    ((index + 1) / Math.max(previewItems.length, 1)) * 45,
                  ),
              );
            } catch (error) {
              previewFailures.set(
                item.clientItemId,
                error instanceof Error
                  ? error.message
                  : 'This photograph could not be previewed.',
              );
            }
          }
        })(),
        enrichPlacesProgressively(deduplicated, selectionController.signal),
      ]);
      if (
        selectionController.signal.aborted ||
        selectionRunId !== selectionRunRef.current
      )
        return;
      previewFailures.forEach((error, id) => {
        updateItem(id, { state: 'error', error });
      });
      setItems((current) => [...current].sort(sortImportItems));
      setProgress(100);
      setMessage(
        placeOutageRef.current
          ? `${valid.length} ${valid.length === 1 ? 'photo is' : 'photos are'} ready. ${PROVIDER_OUTAGE_MESSAGE}`
          : `${valid.length} ${valid.length === 1 ? 'photo is' : 'photos are'} ready to review.`,
      );
    } finally {
      setBusy(false);
      setSelectionProcessing(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const removeItem = (id: string) => {
    if (activeBatch) return;
    removedItemIdsRef.current.add(id);
    const item = items.find((candidate) => candidate.clientItemId === id);
    if (item?.previewUrl) {
      URL.revokeObjectURL(item.previewUrl);
      previewUrlsRef.current.delete(item.previewUrl);
    }
    const remaining = items.filter(
      (candidate) => candidate.clientItemId !== id,
    );
    setItems(remaining);
    if (coverClientItemId === id) {
      setCoverClientItemId(
        remaining.find(
          (candidate) =>
            candidate.state !== 'duplicate' && candidate.state !== 'error',
        )?.clientItemId ?? null,
      );
    }
  };

  const confirmLocation = async (
    item: ImportItem,
    coordinates: { latitude: number; longitude: number },
  ) => {
    if (activeBatch) return;
    const requestId = locationRequestRef.current + 1;
    locationRequestRef.current = requestId;
    locationAbortRef.current?.abort();
    const locationController = new AbortController();
    locationAbortRef.current = locationController;
    const placed: ImportItem = {
      ...item,
      ...coordinates,
      place: null,
      placeLabel: item.placeLabelEdited ? item.placeLabel : '',
      locationSource: 'manual',
      state: 'locating',
      error: '',
    };
    updateItem(item.clientItemId, placed);
    setMessage('Recognizing the place from your pin…');
    let resolution: PlaceResolution;
    try {
      resolution = await resolveItemPlace(
        placed,
        'manual',
        locationController.signal,
      );
    } catch (error) {
      if (isImportAbort(error)) return;
      throw error;
    }
    if (requestId !== locationRequestRef.current) return;
    const resolved = resolution.item;
    updateItem(item.clientItemId, resolved);
    setLocationEditorId(null);
    setMessage(
      resolved.place
        ? `${resolved.placeLabel} is ready.`
        : 'Pin saved. Name the place while telling the story.',
    );
  };

  const closeLocationEditor = useCallback(() => {
    locationRequestRef.current += 1;
    locationAbortRef.current?.abort();
    const closingManualLookup =
      locationItem?.state === 'locating' &&
      locationItem.locationSource === 'manual';
    if (locationEditorId && closingManualLookup) {
      setItems((current) =>
        current.map((item) => {
          if (
            item.clientItemId !== locationEditorId ||
            item.state !== 'locating' ||
            item.locationSource !== 'manual'
          )
            return item;
          return {
            ...item,
            place: null,
            placeLabel: item.placeLabelEdited ? item.placeLabel : '',
            state: 'ready',
            error:
              'Place recognition stopped. Your pin is saved; name this place yourself.',
          };
        }),
      );
      setMessage('Pin saved. Name the place while telling the story.');
    }
    setLocationEditorId(null);
  }, [locationEditorId, locationItem?.locationSource, locationItem?.state]);

  const moveItem = (id: string, direction: -1 | 1) => {
    if (activeBatch) return;
    setItems((current) => {
      const activeIds = current
        .filter((item) => item.state !== 'duplicate' && item.state !== 'error')
        .map((item) => item.clientItemId);
      const activeIndex = activeIds.indexOf(id);
      const targetId = activeIds[activeIndex + direction];
      if (!targetId) return current;
      const sourceIndex = current.findIndex((item) => item.clientItemId === id);
      const targetIndex = current.findIndex(
        (item) => item.clientItemId === targetId,
      );
      const next = [...current];
      [next[sourceIndex], next[targetIndex]] = [
        next[targetIndex],
        next[sourceIndex],
      ];
      return next;
    });
  };

  const startStories = () => {
    const unresolved = activeItems.find(
      (item) => item.latitude === null || item.longitude === null,
    );
    if (unresolved) {
      setLocationEditorId(unresolved.clientItemId);
      setMessage('Place every photograph on the atlas before continuing.');
      return;
    }
    setStoryIndex(0);
    goToStep('stories');
  };

  const advanceStory = () => {
    if (!currentStory) return;
    if (activeBatch) {
      void createJourney(false);
      return;
    }
    if (!currentStory.title.trim() || !currentStory.placeLabel.trim()) {
      setMessage('Give this memory a title and place before continuing.');
      document
        .getElementById(
          !currentStory.title.trim()
            ? 'import-memory-title'
            : 'import-memory-place',
        )
        ?.focus();
      return;
    }
    if (needsFileDateConfirmation(currentStory)) {
      setMessage(
        'Confirm this low-confidence file date, edit it, or clear it before continuing.',
      );
      document.getElementById('confirm-import-memory-date')?.focus();
      return;
    }
    if (storyIndex < activeItems.length - 1) {
      setStoryIndex((current) => current + 1);
      setMessage('');
      focusStep();
      return;
    }
    if (includeChapter) goToStep('chapter');
    else void createJourney(false);
  };

  const makeBatchInput = (
    createChapter: boolean,
  ): CreateAtlasImportBatchInput => ({
    clientRequestId: (clientRequestIdRef.current ??= crypto.randomUUID()),
    chapterTitle: createChapter ? chapterTitle.trim() : '',
    chapterIntroduction: createChapter ? chapterIntroduction.trim() : '',
    coverClientItemId: createChapter ? coverClientItemId : null,
    items: activeItems.map((item) => {
      if (
        !item.analysis?.sourceHash ||
        item.latitude === null ||
        item.longitude === null ||
        needsFileDateConfirmation(item)
      ) {
        throw new Error(`${item.fileName} is not ready to import.`);
      }
      return {
        clientItemId: item.clientItemId,
        latitude: item.latitude,
        longitude: item.longitude,
        title: item.title.trim(),
        description: item.description.trim(),
        placeLabel: item.placeLabel.trim(),
        visitedOn: item.visitedOn || null,
        placeName: item.place?.placeName ?? null,
        placeLocality: item.place?.locality ?? null,
        placeRegion: item.place?.region ?? null,
        placeCountry: item.place?.country ?? null,
        placeCountryCode: item.place?.countryCode ?? null,
        placeGeocoder: item.place?.geocoder ?? null,
        placeGeocodedAt: item.place?.geocodedAt ?? null,
        locationSource:
          item.locationSource === 'photo_gps' ? 'photo_gps' : 'manual',
        dateSource: (item.visitedOn
          ? item.captureDateSource
          : 'missing') as CaptureDateSource,
        dateConfirmed:
          item.captureDateSource !== 'file_date' || item.fileDateConfirmed,
        sourceName: item.analysis.name,
        sourceMimeType: sourceMimeType(item.analysis),
        sourceByteSize: item.analysis.byteSize,
        sourceHash: item.analysis.sourceHash,
        sourceWidth: null,
        sourceHeight: null,
        mediaWidth: null,
        mediaHeight: null,
        preparedByteSize: null,
        thumbnailByteSize: null,
      };
    }),
  });

  const uploadVariant = async (
    kind: 'original' | 'thumbnail',
    mapping: BatchMapping,
    item: ImportItem,
    blob: Blob,
    uploadPathname: string,
    originalPathname: string,
    thumbnailPathname: string,
    onPercentage: (value: number) => void,
  ) => {
    const existing = uploadedVariantsRef.current.get(item.clientItemId)?.[kind];
    if (existing) return existing;
    const result = await upload(uploadPathname, blob, {
      access: 'private',
      handleUploadUrl: '/api/atlas/media/upload',
      clientPayload: JSON.stringify({
        entryId: mapping.entryId,
        mediaId: mapping.mediaId,
        pathname: originalPathname,
        thumbnailPathname,
      }),
      multipart: kind === 'original',
      onUploadProgress: ({ percentage }) => onPercentage(percentage),
    });
    const variants = uploadedVariantsRef.current.get(item.clientItemId) ?? {
      original: null,
      thumbnail: null,
    };
    variants[kind] = result;
    uploadedVariantsRef.current.set(item.clientItemId, variants);
    return result;
  };

  const prepareUploadAndRegisterItem = async (
    item: ImportItem,
    mapping: BatchMapping,
    batch: ActiveBatch,
    itemIndex: number,
  ) => {
    if (uploadedItemIdsRef.current.has(item.clientItemId)) return;
    if (!item.analysis?.canPrepare) {
      throw new Error(`${item.fileName} could not be prepared.`);
    }
    updateItem(item.clientItemId, { uploadState: 'preparing', error: '' });
    setMessage(
      `Preparing photograph ${itemIndex + 1} of ${activeItems.length}…`,
    );
    const prepared = await prepareAtlasImportPhoto(item.file, {
      analysis: item.analysis,
      onProgress: ({ percent: itemProgress, message: preparationMessage }) => {
        setMessage(preparationMessage);
        setProgress(
          Math.round(
            ((itemIndex + itemProgress / 100) / activeItems.length) * 100,
          ),
        );
      },
    });
    updateItem(item.clientItemId, {
      width: prepared.dimensions.sourceWidth,
      height: prepared.dimensions.sourceHeight,
    });
    try {
      unwrapAction(
        await prepareAtlasImportItemAction({
          batchId: batch.batchId,
          itemId: mapping.itemId,
          sourceWidth: prepared.dimensions.sourceWidth,
          sourceHeight: prepared.dimensions.sourceHeight,
          mediaWidth: prepared.dimensions.masterWidth,
          mediaHeight: prepared.dimensions.masterHeight,
          preparedByteSize: prepared.master.size,
          thumbnailByteSize: prepared.thumbnail.size,
        }),
      );
      if (!isAllowedAtlasMediaType(prepared.master.type)) {
        throw new Error(
          'This photograph did not produce a supported display copy.',
        );
      }
      const pathname = createAtlasMediaPath(
        mapping.entryId,
        mapping.mediaId,
        prepared.master.type,
      );
      const thumbnailPathname = createAtlasThumbnailPath(
        mapping.entryId,
        mapping.mediaId,
      );
      const registrationInput = {
        entryId: mapping.entryId,
        mediaId: mapping.mediaId,
        pathname,
        thumbnailPathname,
        width: prepared.dimensions.masterWidth,
        height: prepared.dimensions.masterHeight,
        altText: item.title.trim() || item.placeLabel.trim(),
      };
      const markRegistered = () => {
        uploadedItemIdsRef.current.add(item.clientItemId);
        updateItem(item.clientItemId, {
          prepared: null,
          uploadState: 'uploaded',
          error: '',
        });
      };
      const retryingUpload =
        item.uploadState === 'error' ||
        Boolean(uploadedVariantsRef.current.get(item.clientItemId));
      if (retryingUpload) {
        const pairStatus =
          await getAtlasImportMediaPairStatusAction(registrationInput);
        if (pairStatus.ok) {
          if (pairStatus.data.registered) {
            markRegistered();
            return;
          }
          const variants = uploadedVariantsRef.current.get(
            item.clientItemId,
          ) ?? {
            original: null,
            thumbnail: null,
          };
          if (pairStatus.data.originalCommitted) {
            variants.original = { pathname };
          }
          if (pairStatus.data.thumbnailCommitted) {
            variants.thumbnail = { pathname: thumbnailPathname };
          }
          uploadedVariantsRef.current.set(item.clientItemId, variants);
          if (
            pairStatus.data.originalCommitted &&
            pairStatus.data.thumbnailCommitted
          ) {
            const recovered = await registerAtlasMediaAction(registrationInput);
            if (recovered.ok) {
              markRegistered();
              return;
            }
          }
        }
      }
      const operationProgress = [0, 0];
      const reportProgress = (operation: 0 | 1, percentage: number) => {
        operationProgress[operation] = percentage / 100;
        setProgress(
          Math.round(
            ((itemIndex + (operationProgress[0] + operationProgress[1]) / 2) /
              activeItems.length) *
              100,
          ),
        );
      };
      updateItem(item.clientItemId, { uploadState: 'uploading' });
      setMessage(
        `Uploading photograph ${itemIndex + 1} of ${activeItems.length} privately…`,
      );
      const uploads = await Promise.allSettled([
        uploadVariant(
          'original',
          mapping,
          item,
          prepared.master,
          pathname,
          pathname,
          thumbnailPathname,
          (percentage) => reportProgress(0, percentage),
        ),
        uploadVariant(
          'thumbnail',
          mapping,
          item,
          prepared.thumbnail,
          thumbnailPathname,
          pathname,
          thumbnailPathname,
          (percentage) => reportProgress(1, percentage),
        ),
      ]);
      const rejectedUpload = uploads.find(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected',
      );
      if (rejectedUpload) throw rejectedUpload.reason;
      const registration = await registerAtlasMediaAction(registrationInput);
      if (registration.ok) {
        markRegistered();
        return;
      }
      unwrapAction(registration);
    } finally {
      updateItem(item.clientItemId, { prepared: null });
    }
  };

  async function createJourney(createChapter: boolean) {
    if (busy) return;
    if (activeBatch && activeBatch.createChapter !== createChapter) {
      setMessage(
        activeBatch.createChapter
          ? 'This private draft is already shaped as a chapter. Finish the chapter to keep the uploaded work.'
          : 'This private draft is already shaped as memories only. Finish the memories to keep the uploaded work.',
      );
      return;
    }
    if (createChapter && !chapterTitle.trim()) {
      setMessage('Give this chapter a title before creating it.');
      document.getElementById('import-chapter-title')?.focus();
      return;
    }
    const incomplete = activeItems.find(
      (item) =>
        !item.title.trim() ||
        !item.placeLabel.trim() ||
        item.latitude === null ||
        item.longitude === null,
    );
    if (incomplete) {
      setStoryIndex(Math.max(activeItems.indexOf(incomplete), 0));
      goToStep('stories');
      setMessage('One memory still needs a title or place.');
      return;
    }
    const unconfirmedFileDate = activeItems.find(needsFileDateConfirmation);
    if (unconfirmedFileDate) {
      setStoryIndex(Math.max(activeItems.indexOf(unconfirmedFileDate), 0));
      goToStep('stories');
      setMessage(
        'Confirm this low-confidence file date, edit it, or clear it before creating the journey.',
      );
      window.requestAnimationFrame(() =>
        document.getElementById('confirm-import-memory-date')?.focus(),
      );
      return;
    }

    setBusy(true);
    setProgress(0);
    setMessage('Opening a private import draft…');
    try {
      let batch = activeBatch;
      if (!batch) {
        const result = await createAtlasImportBatchAction(
          makeBatchInput(createChapter),
        );
        if (!result.ok && result.error === 'duplicate') {
          const duplicateIds = new Set(
            result.duplicates?.map((item) => item.clientItemId) ?? [],
          );
          setItems((current) =>
            current.map((item) =>
              duplicateIds.has(item.clientItemId)
                ? {
                    ...item,
                    state: 'duplicate',
                    error: 'This photograph is already in your Atlas.',
                  }
                : item,
            ),
          );
          throw new Error(
            'One or more photographs are already in your Atlas. Remove them, then continue.',
          );
        }
        const data = unwrapAction<AtlasImportBatch>(result);
        batch = recoveryMapping(data);
        setActiveBatch(batch);
      }

      for (let index = 0; index < batch.items.length; index += 1) {
        const mapping = batch.items[index];
        if (uploadedItemIdsRef.current.has(mapping.clientItemId)) continue;
        const item = activeItems.find(
          (candidate) => candidate.clientItemId === mapping.clientItemId,
        );
        if (!item)
          throw new Error('One photograph is no longer in this journey.');
        try {
          await prepareUploadAndRegisterItem(item, mapping, batch, index);
        } catch (error) {
          updateItem(item.clientItemId, {
            prepared: null,
            uploadState: 'error',
            error:
              error instanceof Error
                ? error.message
                : 'The photograph could not be uploaded.',
          });
          throw error;
        }
      }

      setProgress(100);
      setMessage(createChapter ? 'Shaping the chapter…' : 'Creating memories…');
      const persistedCoverClientItemId = batch.createChapter
        ? batch.coverClientItemId
        : null;
      const coverMapping = batch.items.find(
        (mapping) => mapping.clientItemId === persistedCoverClientItemId,
      );
      const finalized = unwrapAction<AtlasImportFinalization>(
        await finalizeAtlasImportBatchAction({
          batchId: batch.batchId,
          version: batch.version,
          createChapter,
          coverMediaId: createChapter ? (coverMapping?.mediaId ?? null) : null,
        }),
      );
      setCompletion({
        entryIds: finalized.entryIds,
        chapterId: finalized.chapterId,
      });
      setActiveBatch(null);
      goToStep('complete');
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'Your photographs and writing are still here. Try creating the journey again.',
      );
    } finally {
      setBusy(false);
    }
  }

  const discardActiveImport = async (destination = '/dashboard') => {
    setBusy(true);
    try {
      if (activeBatch) {
        unwrapAction(
          await cancelAtlasImportBatchAction({
            batchId: activeBatch.batchId,
            version: activeBatch.version,
          }),
        );
      }
      selectionRunRef.current += 1;
      selectionAbortRef.current?.abort();
      locationAbortRef.current?.abort();
      previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
      previewUrlsRef.current.clear();
      const destinationUrl = new URL(destination, window.location.href);
      if (destinationUrl.origin === window.location.origin) {
        router.push(
          `${destinationUrl.pathname}${destinationUrl.search}${destinationUrl.hash}`,
        );
      } else {
        window.location.assign(destinationUrl.href);
      }
    } catch {
      setMessage(
        'The import draft could not be cleared yet. Please try again.',
      );
      setLeaveHref(null);
    } finally {
      setBusy(false);
    }
  };

  const clearRecoveredImport = async () => {
    if (!openRecovery || busy) return;
    setBusy(true);
    setMessage('Clearing the interrupted private draft…');
    try {
      unwrapAction(
        await cancelAtlasImportBatchAction({
          batchId: openRecovery.id,
          version: openRecovery.version,
        }),
      );
      setOpenRecovery(null);
      setMessage(
        'The interrupted draft was cleared. Choose a journey to begin.',
      );
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'The interrupted draft could not be cleared.',
      );
    } finally {
      setBusy(false);
    }
  };

  const finishRecoveredImport = async () => {
    if (!openRecovery || openRecovery.status !== 'ready' || busy) return;
    setBusy(true);
    setMessage('Finishing the recovered private journey…');
    try {
      const createChapter = openRecovery.coverClientItemId !== null;
      const persistedCover = createChapter
        ? openRecovery.items.find(
            (item) => item.clientItemId === openRecovery.coverClientItemId,
          )
        : null;
      if (createChapter && !persistedCover) {
        throw new Error(
          'The selected chapter cover could not be recovered. Clear this draft and try again.',
        );
      }
      const finalized = unwrapAction<AtlasImportFinalization>(
        await finalizeAtlasImportBatchAction({
          batchId: openRecovery.id,
          version: openRecovery.version,
          createChapter,
          coverMediaId: persistedCover?.mediaId ?? null,
        }),
      );
      setOpenRecovery(null);
      router.push(
        finalized.chapterId
          ? `/dashboard/chapters/${finalized.chapterId}`
          : '/dashboard',
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : 'The recovered journey could not be finished.',
      );
      setBusy(false);
    }
  };

  const restart = () => {
    selectionRunRef.current += 1;
    selectionAbortRef.current?.abort();
    locationAbortRef.current?.abort();
    previewUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    previewUrlsRef.current.clear();
    clientRequestIdRef.current = null;
    uploadedItemIdsRef.current.clear();
    uploadedVariantsRef.current.clear();
    removedItemIdsRef.current.clear();
    placeCacheRef.current.clear();
    setItems([]);
    setStoryIndex(0);
    setChapterTitle('');
    setChapterIntroduction('');
    setCoverClientItemId(null);
    setCompletion(null);
    setMessage('');
    setProgress(0);
    setStep('choose');
    focusStep();
  };

  return (
    <div className={`dashboard-page ${styles.page}`} data-step={step}>
      <header className={styles.header}>
        <div>
          {items.length && step !== 'complete' ? (
            <button
              type="button"
              className={styles.backLink}
              onClick={() => setLeaveHref('/dashboard')}
            >
              <ArrowLeftIcon aria-hidden="true" /> Leave import
            </button>
          ) : (
            <Link className={styles.backLink} href="/dashboard">
              <ArrowLeftIcon aria-hidden="true" /> Back to the atlas
            </Link>
          )}
          <ImportHeading
            step={step}
            activeCount={activeItems.length}
            completionHasChapter={Boolean(completion?.chapterId)}
            headingRef={headingRef}
          />
        </div>
        {step !== 'complete' ? (
          <ImportProgress step={step} includeChapter={includeChapter} />
        ) : (
          <span className={styles.completeMark} aria-hidden="true">
            <CheckCircleIcon />
          </span>
        )}
      </header>

      <ImportNotice
        message={message}
        busy={busy}
        progress={progress}
        hasError={hasUploadError}
      />

      {openRecovery ? (
        <main className={styles.recoveryCard}>
          <span className={styles.dialogIcon} aria-hidden="true">
            <ArrowPathIcon />
          </span>
          <p className="section-kicker">Journey recovery</p>
          <h2>An interrupted private import is waiting.</h2>
          <p>
            {openRecovery.status === 'ready'
              ? `${openRecovery.items.length} ${openRecovery.items.length === 1 ? 'memory is' : 'memories are'} uploaded and ready to finish.`
              : 'The original files are not retained by the browser. Clear this incomplete draft, then select the photographs again.'}
          </p>
          {openRecovery.status === 'ready' && recoveredCover ? (
            <div className={styles.recoveryCoverIntent}>
              <CheckCircleIcon aria-hidden="true" />
              <span>
                <small>Chapter cover</small>
                <strong>
                  {recoveredCover.title ||
                    recoveredCover.placeLabel ||
                    'Selected memory'}
                </strong>
              </span>
            </div>
          ) : null}
          <div>
            {openRecovery.status === 'ready' ? (
              <button
                type="button"
                className={styles.primaryButton}
                onClick={() => void finishRecoveredImport()}
                disabled={busy}
              >
                Finish journey
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void clearRecoveredImport()}
              disabled={busy}
            >
              <TrashIcon aria-hidden="true" /> Clear private draft
            </button>
          </div>
        </main>
      ) : null}

      {!openRecovery && step === 'choose' ? (
        <PhotoImportChooseStep
          items={items}
          activeCount={activeItems.length}
          totalSize={totalSize}
          busy={busy}
          selectionLocked={selectionProcessing}
          inputRef={inputRef}
          rejections={rejections}
          onChoose={(files) => void chooseFiles(files)}
          onRemove={removeItem}
          onContinue={() => goToStep('review')}
        />
      ) : null}

      {!openRecovery && step === 'review' ? (
        <PhotoImportReviewStep
          items={items}
          activeCount={activeItems.length}
          mapEntries={mapEntries}
          initialView={IMPORT_DEFAULT_VIEW}
          confidentGpsCount={confidentGpsCount}
          unresolvedCount={unresolvedCount}
          locatingCount={locatingCount}
          processing={selectionProcessing}
          blockingCount={blockingCount}
          onEditLocation={setLocationEditorId}
          onRemove={removeItem}
          onBack={() => goToStep('choose')}
          onContinue={startStories}
        />
      ) : null}

      {!openRecovery && step === 'stories' && currentStory ? (
        <PhotoImportStoriesStep
          items={activeItems}
          currentItem={currentStory}
          storyIndex={storyIndex}
          completedStories={completedStories}
          includeChapter={includeChapter}
          busy={busy}
          locked={busy || Boolean(activeBatch)}
          updateItem={(id, update) => {
            if (!activeBatch) updateItem(id, update);
          }}
          onStoryIndex={setStoryIndex}
          onEditLocation={setLocationEditorId}
          onBack={() =>
            storyIndex
              ? setStoryIndex((current) => current - 1)
              : goToStep('review')
          }
          onContinue={advanceStory}
        />
      ) : null}

      {!openRecovery && step === 'chapter' ? (
        <PhotoImportChapterStep
          items={activeItems}
          coverClientItemId={coverClientItemId}
          chapterTitle={chapterTitle}
          chapterIntroduction={chapterIntroduction}
          busy={busy}
          locked={busy || Boolean(activeBatch)}
          lockedCreateChapter={activeBatch?.createChapter ?? null}
          onCover={setCoverClientItemId}
          onTitle={setChapterTitle}
          onIntroduction={setChapterIntroduction}
          onMove={moveItem}
          onBack={() => goToStep('stories')}
          onCreateMemories={() => void createJourney(false)}
          onCreateChapter={() => void createJourney(true)}
        />
      ) : null}

      {!openRecovery && step === 'complete' ? (
        <PhotoImportCompletionStep
          completion={completion}
          mapEntries={mapEntries}
          initialView={IMPORT_DEFAULT_VIEW}
          onRestart={restart}
        />
      ) : null}

      {locationItem ? (
        <ImportLocationDialog
          key={locationItem.clientItemId}
          item={locationItem}
          onClose={closeLocationEditor}
          onConfirm={confirmLocation}
        />
      ) : null}

      {leaveHref ? (
        <ImportLeaveDialog
          hasDraft={Boolean(activeBatch)}
          armed={cancelArmed}
          busy={busy}
          onKeepWorking={() => {
            setLeaveHref(null);
            setCancelArmed(false);
          }}
          onArmOrDiscard={() => {
            if (!cancelArmed) {
              setCancelArmed(true);
              return;
            }
            void discardActiveImport(leaveHref);
          }}
        />
      ) : null}
    </div>
  );
}
