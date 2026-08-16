'use client';

import {
  ArchiveBoxIcon,
  ArrowUpRightIcon,
  CalendarDaysIcon,
  CheckIcon,
  MapPinIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  archiveAtlasEntryAction,
  updateAtlasEntryAction,
} from '@/app/lib/actions/atlas';
import type {
  AtlasEntry,
  AtlasEntryUpdateInput,
  JourneyState,
} from '@/app/lib/atlas/definitions';
import {
  ATLAS_DESCRIPTION_MAX_LENGTH,
  ATLAS_PLACE_MAX_LENGTH,
  ATLAS_TITLE_MAX_LENGTH,
} from '@/app/lib/atlas/validation';
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
  onArchive: (id: string) => void;
  mediaLoading: boolean;
  placeResolving: boolean;
};

type FormState = Pick<
  AtlasEntryUpdateInput,
  'title' | 'description' | 'placeLabel' | 'visitedOn' | 'journeyState'
>;

function formFromEntry(entry: AtlasEntry): FormState {
  return {
    title: entry.title,
    description: entry.description,
    placeLabel: entry.placeLabel,
    visitedOn: entry.visitedOn,
    journeyState: entry.journeyState,
  };
}

export function MemoryDrawer({
  entry,
  onClose,
  onDirtyChange,
  onUpdate,
  onArchive,
  mediaLoading,
  placeResolving,
}: MemoryDrawerProps) {
  const [form, setForm] = useState<FormState>(() => formFromEntry(entry));
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle');
  const [message, setMessage] = useState('');
  const [archiveArmed, setArchiveArmed] = useState(false);
  const [discardArmed, setDiscardArmed] = useState(false);
  const [placeTouched, setPlaceTouched] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const versionRef = useRef(entry.version);
  const mediaRef = useRef(entry.media);
  const savingRef = useRef(false);
  const editRevisionRef = useRef(0);

  useEffect(() => {
    requestAnimationFrame(() =>
      entry.recordState === 'draft'
        ? titleRef.current?.focus()
        : headingRef.current?.focus(),
    );
  }, [entry.recordState]);

  useEffect(() => {
    mediaRef.current = entry.media;
  }, [entry.media]);

  useEffect(() => {
    onDirtyChange(dirty);
  }, [dirty, onDirtyChange]);

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

  const save = useCallback(async () => {
    if (savingRef.current) return;
    if (!form.title.trim()) {
      setSaveState('error');
      setMessage('Give this memory a title before saving it.');
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
      });

      if (result.ok) {
        versionRef.current = result.data.version;
        setSaveState(
          editRevisionRef.current === savingRevision ? 'saved' : 'idle',
        );
        onUpdate({ ...result.data, media: mediaRef.current });
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
  }, [entry.id, form, onUpdate, placeValue]);

  const archive = async () => {
    if (!archiveArmed) {
      setArchiveArmed(true);
      return;
    }

    setSaveState('saving');
    const result = await archiveAtlasEntryAction(entry.id);
    if (result.ok) {
      onArchive(entry.id);
      return;
    }

    setArchiveArmed(false);
    setSaveState('error');
    setMessage(result.message);
  };

  const requestClose = () => {
    if (!dirty) {
      onClose();
      return;
    }

    setDiscardArmed(true);
    setMessage(
      'You have unsaved changes. Save them, or confirm discard below.',
    );
  };

  const discard = () => {
    if (!discardArmed) {
      setDiscardArmed(true);
      setMessage('Select confirm discard to close without saving.');
      return;
    }

    onDirtyChange(false);
    onClose();
  };

  return (
    <aside
      className={styles.memoryDrawer}
      role="dialog"
      aria-labelledby="memory-drawer-heading"
      aria-describedby="memory-drawer-context"
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
            {saveState === 'saving' ? 'Saving…' : null}
            {saveState === 'saved' ? (
              <>
                <CheckIcon aria-hidden="true" /> Saved to your atlas
              </>
            ) : null}
            {saveState === 'idle' && dirty ? 'Unsaved changes' : null}
          </span>
          {entry.recordState === 'saved' && !dirty && saveState !== 'saving' ? (
            <Link
              className={styles.drawerKeepsakeLink}
              href={`/dashboard/card/${entry.id}`}
            >
              View keepsake
              <ArrowUpRightIcon aria-hidden="true" />
            </Link>
          ) : null}
        </div>
        <button
          type="button"
          className={styles.iconButton}
          onClick={requestClose}
          aria-label={dirty ? 'Review unsaved changes' : 'Close memory'}
        >
          <XMarkIcon aria-hidden="true" />
        </button>
      </header>

      <div className={styles.drawerBody}>
        <label className={styles.titleField}>
          <span>Title</span>
          <input
            ref={titleRef}
            id="memory-title"
            name="title"
            value={form.title}
            maxLength={ATLAS_TITLE_MAX_LENGTH}
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

        <label className={styles.inputField}>
          <span className={styles.fieldLabel}>
            <CalendarDaysIcon aria-hidden="true" />
            {form.journeyState === 'visited' ? 'Date visited' : 'Planned date'}
          </span>
          <input
            type="date"
            name="visitedOn"
            value={form.visitedOn ?? ''}
            onChange={(event) =>
              setField('visitedOn', event.target.value || null)
            }
          />
        </label>

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
          onChange={(media) => onUpdate({ ...entry, media })}
        />

        {message ? (
          <p
            id="memory-drawer-message"
            className={styles.drawerMessage}
            role="alert"
          >
            {message}
          </p>
        ) : null}

        <div className={styles.coordinateNote}>
          <span>Exact pin</span>
          <code>
            {entry.latitude.toFixed(5)}, {entry.longitude.toFixed(5)}
          </code>
        </div>
      </div>

      <footer className={styles.drawerFooter}>
        {dirty ? (
          <button
            type="button"
            className={styles.archiveButton}
            data-armed={discardArmed ? 'true' : 'false'}
            onClick={discard}
            disabled={saveState === 'saving'}
          >
            <XMarkIcon aria-hidden="true" />
            {discardArmed ? 'Confirm discard' : 'Discard changes'}
          </button>
        ) : (
          <button
            type="button"
            className={styles.archiveButton}
            data-armed={archiveArmed ? 'true' : 'false'}
            onClick={() => void archive()}
            disabled={saveState === 'saving'}
          >
            <ArchiveBoxIcon aria-hidden="true" />
            {archiveArmed ? 'Remove this memory?' : 'Remove'}
          </button>
        )}
        <button
          type="button"
          className={styles.saveButton}
          onClick={() => void save()}
          disabled={
            saveState === 'saving' || (!dirty && entry.recordState === 'saved')
          }
        >
          {saveState === 'saving'
            ? 'Saving…'
            : entry.recordState === 'draft'
              ? 'Keep memory'
              : 'Save changes'}
        </button>
      </footer>
    </aside>
  );
}
