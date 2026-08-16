'use client';

import {
  ArchiveBoxIcon,
  CalendarDaysIcon,
  CheckIcon,
  MapPinIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
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
import styles from './atlas.module.css';
import { MemoryPhotos } from './memory-photos';

type MemoryDrawerProps = {
  entry: AtlasEntry;
  onClose: () => void;
  onUpdate: (entry: AtlasEntry) => void;
  onArchive: (id: string) => void;
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
  onUpdate,
  onArchive,
}: MemoryDrawerProps) {
  const [form, setForm] = useState<FormState>(() => formFromEntry(entry));
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle');
  const [message, setMessage] = useState('');
  const [archiveArmed, setArchiveArmed] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const versionRef = useRef(entry.version);
  const savingRef = useRef(false);

  useEffect(() => {
    if (entry.recordState === 'draft') {
      requestAnimationFrame(() => titleRef.current?.focus());
    }
  }, [entry.recordState]);

  const setField = <K extends keyof FormState>(
    field: K,
    value: FormState[K],
  ) => {
    setForm((current) => ({ ...current, [field]: value }));
    setDirty(true);
    setSaveState('idle');
    setMessage('');
  };

  const save = useCallback(async () => {
    if (savingRef.current) return;
    if (!form.title.trim()) {
      setSaveState('error');
      setMessage('Give this memory a title before saving it.');
      return;
    }

    savingRef.current = true;
    setDirty(false);
    setSaveState('saving');
    setMessage('');

    const result = await updateAtlasEntryAction({
      id: entry.id,
      version: versionRef.current,
      ...form,
    });

    savingRef.current = false;
    if (result.ok) {
      versionRef.current = result.data.version;
      setSaveState('saved');
      onUpdate({ ...result.data, media: entry.media });
      return;
    }

    setSaveState('error');
    setMessage(result.message);
  }, [entry.id, entry.media, form, onUpdate]);

  useEffect(() => {
    if (!dirty || !form.title.trim()) return;
    const timer = window.setTimeout(() => void save(), 900);
    return () => window.clearTimeout(timer);
  }, [dirty, form, save]);

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

  return (
    <aside
      className={styles.memoryDrawer}
      role="dialog"
      aria-labelledby="memory-drawer-title"
      aria-describedby="memory-drawer-description"
    >
      <header className={styles.drawerHeader}>
        <div>
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
        </div>
        <button
          type="button"
          className={styles.iconButton}
          onClick={onClose}
          aria-label="Close memory"
        >
          <XMarkIcon aria-hidden="true" />
        </button>
      </header>

      <div className={styles.drawerBody}>
        <label className={styles.titleField}>
          <span>Title</span>
          <input
            ref={titleRef}
            id="memory-drawer-title"
            value={form.title}
            maxLength={ATLAS_TITLE_MAX_LENGTH}
            placeholder="What will you call this place?"
            onChange={(event) => setField('title', event.target.value)}
          />
        </label>

        <div className={styles.fieldGroup}>
          <span className={styles.fieldLabel}>Journey</span>
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
                onClick={() => setField('journeyState', value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <label className={styles.inputField}>
          <span className={styles.fieldLabel}>
            <MapPinIcon aria-hidden="true" /> Place
          </span>
          <input
            value={form.placeLabel}
            maxLength={ATLAS_PLACE_MAX_LENGTH}
            placeholder="City, region, or landmark"
            onChange={(event) => setField('placeLabel', event.target.value)}
          />
        </label>

        <label className={styles.inputField}>
          <span className={styles.fieldLabel}>
            <CalendarDaysIcon aria-hidden="true" /> Date
          </span>
          <input
            type="date"
            value={form.visitedOn ?? ''}
            onChange={(event) =>
              setField('visitedOn', event.target.value || null)
            }
          />
        </label>

        <label className={styles.descriptionField}>
          <span className={styles.fieldLabel}>Field note</span>
          <textarea
            id="memory-drawer-description"
            value={form.description}
            maxLength={ATLAS_DESCRIPTION_MAX_LENGTH}
            placeholder="The small detail you do not want to forget…"
            onChange={(event) => setField('description', event.target.value)}
          />
          <small>
            {form.description.length} / {ATLAS_DESCRIPTION_MAX_LENGTH}
          </small>
        </label>

        <MemoryPhotos
          entryId={entry.id}
          title={form.title}
          placeLabel={form.placeLabel}
          media={entry.media}
          onChange={(media) => onUpdate({ ...entry, media })}
        />

        {message ? (
          <p className={styles.drawerMessage} role="alert">
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
