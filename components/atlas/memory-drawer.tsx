'use client';

import {
  ArchiveBoxIcon,
  ArrowUpRightIcon,
  CalendarDaysIcon,
  CheckIcon,
  ClockIcon,
  MapPinIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';

import {
  archiveAtlasEntryAction,
  updateAtlasEntryAction,
} from '@/app/lib/actions/atlas';
import type {
  AtlasEntry,
  AtlasEntryUpdateInput,
  AtlasMedia,
  AtlasOccurrenceSuggestion,
  JourneyState,
} from '@/app/lib/atlas/definitions';
import {
  ATLAS_DESCRIPTION_MAX_LENGTH,
  ATLAS_PLACE_MAX_LENGTH,
  ATLAS_TITLE_MAX_LENGTH,
} from '@/app/lib/atlas/validation';
import type { AtlasJourneyContinuation } from '@/app/lib/chapters/definitions';
import { CHAPTER_SEGMENT_TITLE_MAX_LENGTH } from '@/app/lib/chapters/validation';
import {
  getAtlasPlaceContextLabel,
  getAtlasPlaceInputLabel,
} from '@/app/lib/atlas/place';
import styles from './atlas.module.css';
import { MemoryPhotos } from './memory-photos';

type MemoryDrawerProps = {
  entry: AtlasEntry;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onUpdate: (entry: AtlasEntry) => void;
  onMediaChange: (entryId: string, media: AtlasMedia[]) => void;
  onArchive: (id: string) => void;
  mediaLoading: boolean;
  placeResolving: boolean;
  continuationJourney?: AtlasJourneyContinuation | null;
  onContinuationSaved?: (entry: AtlasEntry) => void;
};

type FormState = Pick<
  AtlasEntryUpdateInput,
  | 'title'
  | 'description'
  | 'placeLabel'
  | 'visitedOn'
  | 'occurredTime'
  | 'occurredUtcOffsetMinutes'
  | 'journeyState'
>;

type ContinuationTarget = 'journey' | 'new' | string;

const SEGMENT_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
});

function segmentDateLabel(date: string) {
  return SEGMENT_DATE_FORMATTER.format(new Date(`${date}T12:00:00`));
}

function formFromEntry(entry: AtlasEntry): FormState {
  return {
    title: entry.title,
    description: entry.description,
    placeLabel: entry.placeLabel,
    visitedOn: entry.visitedOn,
    occurredTime: entry.occurredTime,
    occurredUtcOffsetMinutes: entry.occurredUtcOffsetMinutes,
    journeyState: entry.journeyState,
  };
}

export function MemoryDrawer({
  entry,
  onClose,
  onDirtyChange,
  onUpdate,
  onMediaChange,
  onArchive,
  mediaLoading,
  placeResolving,
  continuationJourney = null,
  onContinuationSaved,
}: MemoryDrawerProps) {
  const [form, setForm] = useState<FormState>(() => formFromEntry(entry));
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle');
  const [message, setMessage] = useState('');
  const [archiveArmed, setArchiveArmed] = useState(false);
  const [discardArmed, setDiscardArmed] = useState(false);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [placeTouched, setPlaceTouched] = useState(false);
  const [continuationTarget, setContinuationTarget] =
    useState<ContinuationTarget>(
      () => continuationJourney?.selectedSegmentId ?? 'journey',
    );
  const [newSegmentTitle, setNewSegmentTitle] = useState('');
  const drawerRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const versionRef = useRef(entry.version);
  const mediaRef = useRef(entry.media);
  const savingRef = useRef(false);
  const editRevisionRef = useRef(0);
  const occurrenceEditedRef = useRef(
    Boolean(entry.visitedOn || entry.occurredTime),
  );
  const captureOccurrenceKeyRef = useRef<string | null>(null);
  const navigationGuardId = useId();
  const didLeaveRef = useRef(false);

  useLayoutEffect(() => {
    const initialTarget =
      entry.recordState === 'draft' ? titleRef.current : headingRef.current;
    initialTarget?.focus();
  }, [entry.recordState]);

  useEffect(() => {
    const drawer = drawerRef.current;
    if (!drawer) return;

    const sidebar = document.querySelector<HTMLElement>('.dashboard-sidebar');
    const sidebarWasInert = sidebar?.inert ?? false;
    if (sidebar) sidebar.inert = true;

    const keepFocusInside = (event: FocusEvent) => {
      if (event.target instanceof Node && drawer.contains(event.target)) return;
      const target =
        entry.recordState === 'draft' ? titleRef.current : headingRef.current;
      target?.focus();
    };

    document.addEventListener('focusin', keepFocusInside);
    return () => {
      document.removeEventListener('focusin', keepFocusInside);
      if (sidebar) sidebar.inert = sidebarWasInert;
    };
  }, [entry.recordState]);

  useLayoutEffect(() => {
    const title = titleRef.current;
    if (!title) return;

    title.style.height = 'auto';
    title.style.height = `${Math.min(Math.max(title.scrollHeight, 44), 92)}px`;
  }, [form.title]);

  useEffect(() => {
    mediaRef.current = entry.media;
  }, [entry.media]);

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

  const markLeaving = useCallback(() => {
    didLeaveRef.current = true;
    window.__FIELD_ATLAS_NAVIGATION_GUARD__?.clear(navigationGuardId);
  }, [navigationGuardId]);

  useEffect(() => {
    if (!dirty && !mediaBusy && saveState !== 'saving') {
      window.__FIELD_ATLAS_NAVIGATION_GUARD__?.clear(navigationGuardId);
      return;
    }

    const leaveMessage = mediaBusy
      ? 'Leave this memory while photo changes are still saving? They may not finish.'
      : saveState === 'saving'
        ? 'Leave this memory while it is still saving? The save may not finish.'
        : 'Leave this memory? Your unsaved field changes will be lost.';

    window.__FIELD_ATLAS_NAVIGATION_GUARD__?.set({
      id: navigationGuardId,
      message: leaveMessage,
      onLeave: markLeaving,
    });

    const protectPendingChanges = (event: BeforeUnloadEvent) => {
      if (didLeaveRef.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', protectPendingChanges);
    return () => {
      window.removeEventListener('beforeunload', protectPendingChanges);
      window.__FIELD_ATLAS_NAVIGATION_GUARD__?.clear(navigationGuardId);
    };
  }, [dirty, markLeaving, mediaBusy, navigationGuardId, saveState]);

  const setField = <K extends keyof FormState>(
    field: K,
    value: FormState[K],
  ) => {
    editRevisionRef.current += 1;
    setForm((current) => ({ ...current, [field]: value }));
    setDirty(true);
    setDiscardArmed(false);
    setSaveState('idle');
    setMessage('');
  };

  const detectedPlace = entry.placeName
    ? getAtlasPlaceContextLabel({ ...entry, placeLabel: '' })
    : '';
  const storedPlaceLabel = form.placeLabel.trim() || entry.placeLabel.trim();
  const placeValue = placeTouched
    ? form.placeLabel
    : getAtlasPlaceInputLabel({
        ...entry,
        placeLabel: storedPlaceLabel,
      });
  const hasCustomPlaceLabel = Boolean(
    placeTouched ||
    (storedPlaceLabel &&
      placeValue.toLocaleLowerCase() !== detectedPlace.toLocaleLowerCase()),
  );
  const selectedContinuationSegment = continuationJourney?.segments.find(
    (segment) => segment.id === continuationTarget,
  );
  const continuationBaselineDate =
    selectedContinuationSegment?.endDate ??
    (continuationTarget === 'journey'
      ? continuationJourney?.latestMemoryDate
      : null);
  const suggestNewSegment = Boolean(
    continuationJourney &&
    continuationTarget !== 'new' &&
    form.journeyState === 'visited' &&
    form.visitedOn &&
    continuationBaselineDate &&
    form.visitedOn !== continuationBaselineDate,
  );

  const chooseContinuationTarget = (target: ContinuationTarget) => {
    editRevisionRef.current += 1;
    setContinuationTarget(target);
    setDirty(true);
    setDiscardArmed(false);
    setSaveState('idle');
    setMessage('');
  };

  const beginSuggestedSegment = () => {
    const date = form.visitedOn;
    chooseContinuationTarget('new');
    if (date && !newSegmentTitle.trim()) {
      setNewSegmentTitle(
        `Day ${(continuationJourney?.segments.length ?? 0) + 1} · ${segmentDateLabel(date)}`,
      );
    }
  };

  const save = useCallback(async () => {
    if (savingRef.current) return;
    if (mediaBusy) {
      setMessage('Wait for the photo changes to finish before saving details.');
      return;
    }
    if (!form.title.trim()) {
      setSaveState('error');
      setMessage('Give this memory a title before saving it.');
      return;
    }
    if (
      continuationJourney &&
      continuationTarget === 'new' &&
      !newSegmentTitle.trim()
    ) {
      setSaveState('error');
      setMessage('Give the new journey segment a title.');
      return;
    }

    savingRef.current = true;
    const savingRevision = editRevisionRef.current;
    setDirty(false);
    setDiscardArmed(false);
    setSaveState('saving');
    setMessage('');

    try {
      const result = await updateAtlasEntryAction({
        id: entry.id,
        version: versionRef.current,
        ...form,
        placeLabel: placeValue,
        appendToJourneyId: continuationJourney?.id,
        appendToJourneySegmentId:
          continuationJourney &&
          continuationTarget !== 'journey' &&
          continuationTarget !== 'new'
            ? continuationTarget
            : undefined,
        appendToNewJourneySegmentTitle:
          continuationJourney && continuationTarget === 'new'
            ? newSegmentTitle
            : undefined,
      });

      if (result.ok) {
        versionRef.current = result.data.version;
        setSaveState(
          editRevisionRef.current === savingRevision ? 'saved' : 'idle',
        );
        const updatedEntry = { ...result.data, media: mediaRef.current };
        onUpdate(updatedEntry);
        if (continuationJourney) {
          markLeaving();
          onContinuationSaved?.(updatedEntry);
        }
        return;
      }

      setDirty(true);
      setSaveState('error');
      setMessage(result.message);
    } catch (error) {
      console.error('Atlas memory save failed:', error);
      setDirty(true);
      setSaveState('error');
      setMessage('The memory could not be saved. Please try again.');
    } finally {
      savingRef.current = false;
    }
  }, [
    continuationJourney,
    continuationTarget,
    entry.id,
    form,
    markLeaving,
    mediaBusy,
    onContinuationSaved,
    onUpdate,
    placeValue,
    newSegmentTitle,
  ]);

  const cancelContinuation = async () => {
    if (savingRef.current || mediaBusy) {
      setMessage(
        'Wait for the current changes to finish before canceling this memory.',
      );
      return;
    }
    if (!discardArmed) {
      setDiscardArmed(true);
      setMessage(
        `Discard this new memory and return to ${continuationJourney?.title ?? 'the journey'}?`,
      );
      return;
    }

    savingRef.current = true;
    setSaveState('saving');
    setMessage('');
    let archived = false;
    try {
      const result = await archiveAtlasEntryAction(entry.id);
      if (result.ok) {
        archived = true;
        markLeaving();
        onDirtyChange(false);
        onArchive(entry.id);
        return;
      }

      setSaveState('error');
      setMessage(result.message);
    } catch (error) {
      console.error('Journey memory cancellation failed:', error);
      setSaveState('error');
      setMessage('The new memory could not be discarded. Please try again.');
    } finally {
      savingRef.current = false;
      if (!archived) setDiscardArmed(false);
    }
  };

  const archive = async () => {
    if (savingRef.current || mediaBusy) {
      setMessage(
        'Wait for the current changes to finish before removing this memory.',
      );
      return;
    }
    if (!archiveArmed) {
      setArchiveArmed(true);
      return;
    }

    savingRef.current = true;
    setSaveState('saving');
    setMessage('');
    let archived = false;
    try {
      const result = await archiveAtlasEntryAction(entry.id);
      if (result.ok) {
        archived = true;
        onArchive(entry.id);
        return;
      }

      setSaveState('error');
      setMessage(result.message);
    } catch (error) {
      console.error('Atlas memory removal failed:', error);
      setSaveState('error');
      setMessage('The memory could not be removed. Please try again.');
    } finally {
      savingRef.current = false;
      if (!archived) setArchiveArmed(false);
    }
  };

  const requestClose = () => {
    if (mediaBusy) {
      setMessage(
        'Photo changes are still saving. Keep this memory open until they finish.',
      );
      return;
    }
    if (savingRef.current || saveState === 'saving') {
      setMessage(
        'This memory is still saving. Keep it open until it finishes.',
      );
      return;
    }
    if (continuationJourney) {
      setDiscardArmed(true);
      setMessage(
        `Discard this new memory and return to ${continuationJourney.title}?`,
      );
      return;
    }
    if (!dirty) {
      onClose();
      return;
    }

    setDiscardArmed(true);
    setMessage(
      'You have unsaved field changes. Save them, or confirm discard below.',
    );
  };

  const discard = () => {
    if (savingRef.current || mediaBusy) return;
    if (!discardArmed) {
      setDiscardArmed(true);
      setMessage(
        'Select confirm discard to close without saving field changes.',
      );
      return;
    }

    onDirtyChange(false);
    onClose();
  };

  const handleMediaChange = useCallback(
    (media: AtlasMedia[]) => {
      mediaRef.current = media;
      onMediaChange(entry.id, media);
    },
    [entry.id, onMediaChange],
  );

  const handleMediaBusyChange = useCallback((busy: boolean) => {
    setMediaBusy(busy);
  }, []);

  const handleCaptureSuggestion = useCallback(
    (suggestion: AtlasOccurrenceSuggestion) => {
      if (occurrenceEditedRef.current) return;
      const suggestionKey = `${suggestion.visitedOn}T${suggestion.occurredTime}`;
      if (
        captureOccurrenceKeyRef.current &&
        captureOccurrenceKeyRef.current <= suggestionKey
      ) {
        return;
      }

      captureOccurrenceKeyRef.current = suggestionKey;
      editRevisionRef.current += 1;
      setForm((current) => ({
        ...current,
        visitedOn: suggestion.visitedOn,
        occurredTime: suggestion.occurredTime,
        occurredUtcOffsetMinutes: suggestion.occurredUtcOffsetMinutes,
      }));
      setDirty(true);
      setDiscardArmed(false);
      setSaveState('idle');
      setMessage('');
    },
    [],
  );

  return (
    <div
      ref={drawerRef}
      className={styles.memoryDrawer}
      role="dialog"
      aria-modal="true"
      aria-labelledby="memory-drawer-heading"
      aria-describedby="memory-drawer-context"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          requestClose();
          return;
        }

        if (event.key !== 'Tab') return;
        const drawer = drawerRef.current;
        if (!drawer) return;
        const focusable = Array.from(
          drawer.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ),
        ).filter((element) => {
          const style = getComputedStyle(element);
          return (
            style.display !== 'none' &&
            style.visibility !== 'hidden' &&
            element.getAttribute('aria-hidden') !== 'true'
          );
        });
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) {
          event.preventDefault();
          headingRef.current?.focus();
          return;
        }

        if (!focusable.includes(document.activeElement as HTMLElement)) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
          return;
        }

        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
    >
      <header className={styles.drawerHeader}>
        <div>
          <h2
            ref={headingRef}
            id="memory-drawer-heading"
            className="sr-only"
            tabIndex={-1}
          >
            {entry.recordState === 'draft' ? 'Create memory' : 'Edit memory'}
          </h2>
          <p id="memory-drawer-context" className="sr-only">
            Add the place, date, field note, and photos you want to remember.
          </p>
          <p className={styles.eyebrow}>
            {entry.recordState === 'draft' ? 'New memory' : 'Atlas memory'}
          </p>
          <span className={styles.saveStatus} aria-live="polite">
            {mediaBusy ? 'Saving photo changes…' : null}
            {!mediaBusy && saveState === 'saving' ? 'Saving…' : null}
            {!mediaBusy && saveState === 'saved' ? (
              <>
                <CheckIcon aria-hidden="true" /> Saved to your atlas
              </>
            ) : null}
            {!mediaBusy && saveState === 'idle' && dirty
              ? 'Unsaved field changes'
              : null}
            {!mediaBusy &&
            saveState === 'idle' &&
            !dirty &&
            entry.recordState === 'draft'
              ? 'Draft pin saved · Finish it anytime'
              : null}
          </span>
        </div>
        <div className={styles.drawerHeaderActions}>
          {entry.recordState === 'saved' &&
          !dirty &&
          !mediaBusy &&
          saveState !== 'saving' ? (
            <Link
              className={styles.drawerKeepsakeLink}
              href={`/dashboard/card/${entry.id}`}
            >
              View keepsake
              <ArrowUpRightIcon aria-hidden="true" />
            </Link>
          ) : null}
          <button
            type="button"
            className={styles.iconButton}
            onClick={requestClose}
            aria-label={
              mediaBusy
                ? 'Wait for photo changes before closing'
                : dirty
                  ? 'Review unsaved field changes'
                  : continuationJourney
                    ? 'Cancel new journey memory'
                    : entry.recordState === 'draft'
                      ? 'Close saved draft'
                      : 'Close memory'
            }
          >
            <XMarkIcon aria-hidden="true" />
          </button>
        </div>
        {message ? (
          <p
            id="memory-drawer-message"
            className={styles.drawerMessage}
            role="alert"
          >
            {message}
          </p>
        ) : null}
      </header>

      <div className={styles.drawerBody}>
        {continuationJourney ? (
          <div className={styles.journeyContinuation}>
            <span>Continuing journey</span>
            <strong>{continuationJourney.title}</strong>
            <label>
              <span>Journey segment</span>
              <select
                value={continuationTarget}
                onChange={(event) =>
                  chooseContinuationTarget(event.target.value)
                }
              >
                {continuationJourney.segments.map((segment, index) => (
                  <option key={segment.id} value={segment.id}>
                    {segment.title}
                    {index === continuationJourney.segments.length - 1
                      ? ' (latest)'
                      : ''}
                  </option>
                ))}
                <option value="journey">No segment</option>
                <option value="new">+ Start a new segment…</option>
              </select>
            </label>
            {continuationTarget === 'new' ? (
              <label>
                <span>New segment name</span>
                <input
                  type="text"
                  value={newSegmentTitle}
                  maxLength={CHAPTER_SEGMENT_TITLE_MAX_LENGTH}
                  placeholder="Day 2 · The coast"
                  autoComplete="off"
                  autoCapitalize="words"
                  onChange={(event) => {
                    editRevisionRef.current += 1;
                    setNewSegmentTitle(event.target.value);
                    setDirty(true);
                    setSaveState('idle');
                    setMessage('');
                  }}
                />
              </label>
            ) : null}
            <small aria-live="polite">
              {continuationTarget === 'new'
                ? 'The segment will be created only when this memory is saved.'
                : selectedContinuationSegment
                  ? `This memory will follow the last stop in ${selectedContinuationSegment.title}.`
                  : 'This memory will be added to the journey without a segment.'}
            </small>
            {suggestNewSegment ? (
              <button type="button" onClick={beginSuggestedSegment}>
                Start a new segment for {segmentDateLabel(form.visitedOn!)}
              </button>
            ) : null}
          </div>
        ) : null}

        <label className={styles.titleField}>
          <span>Title</span>
          <textarea
            ref={titleRef}
            id="memory-title"
            name="title"
            value={form.title}
            maxLength={ATLAS_TITLE_MAX_LENGTH}
            rows={1}
            placeholder="Name this memory"
            autoComplete="off"
            autoCapitalize="words"
            enterKeyHint="next"
            aria-invalid={saveState === 'error' && !form.title.trim()}
            aria-describedby={message ? 'memory-drawer-message' : undefined}
            onChange={(event) => setField('title', event.target.value)}
          />
        </label>

        <fieldset className={styles.fieldGroup}>
          <legend className={styles.fieldLabel}>Journey</legend>
          <div className={styles.segmentedControl}>
            {(
              [
                ['visited', 'I went here'],
                ['want_to_visit', 'I want to go'],
              ] as [JourneyState, string][]
            ).map(([value, label]) => (
              <button
                type="button"
                key={value}
                data-active={form.journeyState === value ? 'true' : 'false'}
                aria-pressed={form.journeyState === value}
                onClick={() => setField('journeyState', value)}
              >
                {label}
              </button>
            ))}
          </div>
        </fieldset>

        <label className={styles.inputField}>
          <span className={styles.fieldLabel}>
            <MapPinIcon aria-hidden="true" /> Place
          </span>
          <input
            id="memory-place"
            name="place"
            value={placeValue}
            maxLength={ATLAS_PLACE_MAX_LENGTH}
            placeholder="City, region, or landmark"
            autoComplete="off"
            autoCapitalize="words"
            spellCheck={false}
            aria-describedby={
              detectedPlace || placeResolving ? 'memory-place-hint' : undefined
            }
            onChange={(event) => {
              setPlaceTouched(true);
              setField('placeLabel', event.target.value);
            }}
          />
          {detectedPlace || placeResolving ? (
            <small
              id="memory-place-hint"
              className={styles.inputHint}
              aria-live="polite"
            >
              {placeResolving && !detectedPlace
                ? 'Finding the city, region, and country…'
                : hasCustomPlaceLabel
                  ? `Atlas context: ${detectedPlace}`
                  : 'Autofilled from your pin · Edit to rename'}
            </small>
          ) : null}
        </label>

        <div className={styles.occurrenceFields}>
          <label className={styles.inputField}>
            <span className={styles.fieldLabel}>
              <CalendarDaysIcon aria-hidden="true" />
              {form.journeyState === 'visited'
                ? 'Date visited'
                : 'Planned date'}
            </span>
            <input
              type="date"
              name="visitedOn"
              value={form.visitedOn ?? ''}
              onChange={(event) => {
                occurrenceEditedRef.current = true;
                captureOccurrenceKeyRef.current = null;
                const visitedOn = event.target.value || null;
                editRevisionRef.current += 1;
                setForm((current) => ({
                  ...current,
                  visitedOn,
                  occurredTime: visitedOn ? current.occurredTime : null,
                  occurredUtcOffsetMinutes: null,
                }));
                setDirty(true);
                setDiscardArmed(false);
                setSaveState('idle');
                setMessage('');
              }}
            />
          </label>
          <label className={styles.inputField}>
            <span className={styles.fieldLabel}>
              <ClockIcon aria-hidden="true" />
              {form.journeyState === 'visited'
                ? 'Time visited'
                : 'Planned time'}
            </span>
            <input
              type="time"
              name="occurredTime"
              value={form.occurredTime ?? ''}
              disabled={!form.visitedOn}
              onChange={(event) => {
                occurrenceEditedRef.current = true;
                captureOccurrenceKeyRef.current = null;
                setField('occurredTime', event.target.value || null);
                setForm((current) => ({
                  ...current,
                  occurredUtcOffsetMinutes: null,
                }));
              }}
            />
          </label>
          <small className={styles.occurrenceHint}>
            Local time · Photo capture details fill this automatically when
            available.
          </small>
        </div>

        <label className={styles.descriptionField}>
          <span className={styles.fieldLabel}>Field note</span>
          <textarea
            id="memory-description"
            name="description"
            value={form.description}
            maxLength={ATLAS_DESCRIPTION_MAX_LENGTH}
            placeholder="The small detail you do not want to forget…"
            autoCapitalize="sentences"
            spellCheck
            onChange={(event) => setField('description', event.target.value)}
          />
          <small>
            {form.description.length} / {ATLAS_DESCRIPTION_MAX_LENGTH}
          </small>
        </label>

        <MemoryPhotos
          entryId={entry.id}
          title={form.title}
          placeLabel={placeValue}
          placeName={entry.placeName}
          media={entry.media}
          loading={mediaLoading}
          onChange={handleMediaChange}
          onBusyChange={handleMediaBusyChange}
          onCaptureSuggestion={handleCaptureSuggestion}
        />

        <div className={styles.coordinateNote}>
          <span>Exact pin</span>
          <code>
            {entry.latitude.toFixed(5)}, {entry.longitude.toFixed(5)}
          </code>
        </div>
      </div>

      <footer className={styles.drawerFooter}>
        {continuationJourney ? (
          <button
            type="button"
            className={styles.archiveButton}
            data-armed={discardArmed ? 'true' : 'false'}
            onClick={() => void cancelContinuation()}
            disabled={saveState === 'saving' || mediaBusy}
          >
            <XMarkIcon aria-hidden="true" />
            {discardArmed ? 'Discard memory?' : 'Cancel'}
          </button>
        ) : dirty ? (
          <button
            type="button"
            className={styles.archiveButton}
            data-armed={discardArmed ? 'true' : 'false'}
            onClick={discard}
            disabled={saveState === 'saving' || mediaBusy}
          >
            <XMarkIcon aria-hidden="true" />
            {discardArmed ? 'Confirm discard' : 'Discard field changes'}
          </button>
        ) : (
          <button
            type="button"
            className={styles.archiveButton}
            data-armed={archiveArmed ? 'true' : 'false'}
            onClick={() => void archive()}
            disabled={saveState === 'saving' || mediaBusy}
          >
            <ArchiveBoxIcon aria-hidden="true" />
            {archiveArmed ? 'Remove this memory?' : 'Remove'}
          </button>
        )}
        <div className={styles.drawerFooterActions}>
          <button
            type="button"
            className={styles.saveButton}
            onClick={() => void save()}
            disabled={
              saveState === 'saving' ||
              mediaBusy ||
              (!dirty && entry.recordState === 'saved')
            }
          >
            {saveState === 'saving'
              ? 'Saving…'
              : continuationJourney
                ? 'Add to journey'
                : entry.recordState === 'draft'
                  ? 'Keep memory'
                  : 'Save changes'}
          </button>
        </div>
      </footer>
    </div>
  );
}
