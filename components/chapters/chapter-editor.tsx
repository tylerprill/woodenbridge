'use client';

import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowUpIcon,
  CheckIcon,
  MagnifyingGlassIcon,
  MapPinIcon,
  PlusIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useMemo, useState, useTransition } from 'react';

import {
  createAtlasChapterAction,
  deleteAtlasChapterAction,
  updateAtlasChapterAction,
} from '@/app/lib/actions/chapters';
import type { AtlasEntry } from '@/app/lib/atlas/definitions';
import type { AtlasChapter } from '@/app/lib/chapters/definitions';
import {
  CHAPTER_INTRODUCTION_MAX_LENGTH,
  CHAPTER_MIN_MEMORIES,
  CHAPTER_TITLE_MAX_LENGTH,
} from '@/app/lib/chapters/validation';
import styles from './chapters.module.css';

function memoryDate(entry: AtlasEntry) {
  if (!entry.visitedOn) return entry.journeyState === 'want_to_visit' ? 'Ahead' : 'Undated';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(`${entry.visitedOn}T12:00:00`));
}

function memoryName(entry: AtlasEntry) {
  return entry.title.trim() || entry.placeLabel || entry.placeName || 'Untitled memory';
}

export function ChapterEditor({
  chapter,
  availableEntries,
}: {
  chapter: AtlasChapter | null;
  availableEntries: AtlasEntry[];
}) {
  const router = useRouter();
  const [title, setTitle] = useState(chapter?.title ?? '');
  const [introduction, setIntroduction] = useState(chapter?.introduction ?? '');
  const [selectedIds, setSelectedIds] = useState(
    chapter?.entries.map((entry) => entry.id) ?? [],
  );
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isPending, startTransition] = useTransition();

  const entriesById = useMemo(() => {
    const entries = [...availableEntries, ...(chapter?.entries ?? [])];
    return new Map(entries.map((entry) => [entry.id, entry]));
  }, [availableEntries, chapter]);
  const selectedEntries = selectedIds
    .map((id) => entriesById.get(id))
    .filter((entry): entry is AtlasEntry => Boolean(entry));
  const normalizedQuery = query.trim().toLowerCase();
  const filteredEntries = availableEntries.filter((entry) => {
    if (!normalizedQuery) return true;
    return [entry.title, entry.placeLabel, entry.placeName, entry.description]
      .filter(Boolean)
      .some((value) => value?.toLowerCase().includes(normalizedQuery));
  });

  function addEntry(entryId: string) {
    setError('');
    setSelectedIds((current) =>
      current.includes(entryId) ? current : [...current, entryId],
    );
  }

  function removeEntry(entryId: string) {
    setError('');
    setSelectedIds((current) => current.filter((id) => id !== entryId));
  }

  function moveEntry(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= selectedIds.length) return;
    setSelectedIds((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    if (selectedIds.length < CHAPTER_MIN_MEMORIES) {
      setError(`Choose at least ${CHAPTER_MIN_MEMORIES} memories for this chapter.`);
      return;
    }

    startTransition(async () => {
      const input = { title, introduction, entryIds: selectedIds };
      const result = chapter
        ? await updateAtlasChapterAction({
            ...input,
            id: chapter.id,
            version: chapter.version,
          })
        : await createAtlasChapterAction(input);

      if (!result.ok) {
        setError(result.message);
        return;
      }

      router.push(`/dashboard/chapters/${result.data.id}`);
      router.refresh();
    });
  }

  function handleDelete() {
    if (!chapter) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }

    setError('');
    startTransition(async () => {
      const result = await deleteAtlasChapterAction(chapter.id);
      if (!result.ok) {
        setError(result.message);
        setConfirmingDelete(false);
        return;
      }
      router.push('/dashboard/chapters');
      router.refresh();
    });
  }

  return (
    <div className={styles.editorPage}>
      <header className={styles.editorHeader}>
        <div>
          <Link href={chapter ? `/dashboard/chapters/${chapter.id}` : '/dashboard/chapters'}>
            <ArrowLeftIcon aria-hidden="true" />
            {chapter ? 'Back to chapter' : 'My Chapters'}
          </Link>
          <p className="section-kicker">Chapter workshop</p>
          <h1>{chapter ? 'Shape your chapter.' : 'Begin a new chapter.'}</h1>
          <p>
            Choose the memories, set their order, and give the journey a voice.
          </p>
        </div>
        <p className={styles.editorProgress}>
          <strong>{String(selectedIds.length).padStart(2, '0')}</strong>
          memories selected
        </p>
      </header>

      <form className={styles.editorLayout} onSubmit={handleSubmit}>
        <div className={styles.editorMain}>
          <section className={styles.editorSection} aria-labelledby="chapter-story-heading">
            <div className={styles.editorSectionHeading}>
              <span>01</span>
              <div>
                <p className="section-kicker">The story</p>
                <h2 id="chapter-story-heading">Name what connects these places.</h2>
              </div>
            </div>

            <label className={styles.editorField}>
              <span>Chapter title</span>
              <input
                name="title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={CHAPTER_TITLE_MAX_LENGTH}
                placeholder="Autumn through Kyoto"
                autoComplete="off"
                required
              />
              <small>{title.length} / {CHAPTER_TITLE_MAX_LENGTH}</small>
            </label>
            <label className={styles.editorField}>
              <span>Introduction <em>Optional</em></span>
              <textarea
                name="introduction"
                value={introduction}
                onChange={(event) => setIntroduction(event.target.value)}
                maxLength={CHAPTER_INTRODUCTION_MAX_LENGTH}
                placeholder="A few words about what made this journey matter…"
                rows={5}
              />
              <small>{introduction.length} / {CHAPTER_INTRODUCTION_MAX_LENGTH}</small>
            </label>
          </section>

          <section className={styles.editorSection} aria-labelledby="chapter-memories-heading">
            <div className={styles.editorSectionHeading}>
              <span>02</span>
              <div>
                <p className="section-kicker">Your atlas</p>
                <h2 id="chapter-memories-heading">Choose the memories.</h2>
              </div>
            </div>

            {availableEntries.length ? (
              <>
                <label className={styles.memorySearch}>
                  <MagnifyingGlassIcon aria-hidden="true" />
                  <span className="sr-only">Search your memories</span>
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Search by title or place"
                  />
                  {query ? (
                    <button type="button" onClick={() => setQuery('')} aria-label="Clear search">
                      <XMarkIcon aria-hidden="true" />
                    </button>
                  ) : null}
                </label>
                <div className={styles.memoryPicker}>
                  {filteredEntries.map((entry) => {
                    const isSelected = selectedIds.includes(entry.id);
                    return (
                      <article className={styles.memoryOption} key={entry.id} data-selected={isSelected}>
                        <div className={styles.memoryOptionIcon} aria-hidden="true">
                          <MapPinIcon />
                        </div>
                        <div>
                          <h3>{memoryName(entry)}</h3>
                          <p>{entry.placeLabel || entry.placeName || 'Pinned place'}</p>
                          <span>{memoryDate(entry)}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => isSelected ? removeEntry(entry.id) : addEntry(entry.id)}
                          aria-label={`${isSelected ? 'Remove' : 'Add'} ${memoryName(entry)}`}
                        >
                          {isSelected ? <CheckIcon aria-hidden="true" /> : <PlusIcon aria-hidden="true" />}
                          <span>{isSelected ? 'Added' : 'Add'}</span>
                        </button>
                      </article>
                    );
                  })}
                </div>
                {!filteredEntries.length ? (
                  <div className={styles.editorInlineEmpty}>
                    <p>No memories match “{query}”.</p>
                    <button type="button" onClick={() => setQuery('')}>Clear search</button>
                  </div>
                ) : null}
              </>
            ) : (
              <div className={styles.editorEmpty}>
                <MapPinIcon aria-hidden="true" />
                <h3>Your chapter needs memories first.</h3>
                <p>Save at least two places in your atlas, then return here to connect them.</p>
                <Link href="/dashboard">Open your atlas</Link>
              </div>
            )}
          </section>
        </div>

        <aside className={styles.chapterSequence} aria-labelledby="chapter-sequence-heading">
          <div className={styles.sequenceHeader}>
            <div>
              <p className="section-kicker">Reading order</p>
              <h2 id="chapter-sequence-heading">The route.</h2>
            </div>
            <span>{selectedIds.length}</span>
          </div>

          {selectedEntries.length ? (
            <ol className={styles.sequenceList}>
              {selectedEntries.map((entry, index) => (
                <li key={entry.id}>
                  <span className={styles.sequenceNumber}>{String(index + 1).padStart(2, '0')}</span>
                  <div className={styles.sequenceMemory}>
                    <strong>{memoryName(entry)}</strong>
                    <span>{entry.placeLabel || entry.placeName || 'Pinned place'}</span>
                  </div>
                  <div className={styles.sequenceActions}>
                    <button
                      type="button"
                      onClick={() => moveEntry(index, -1)}
                      disabled={index === 0}
                      aria-label={`Move ${memoryName(entry)} earlier`}
                    >
                      <ArrowUpIcon aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveEntry(index, 1)}
                      disabled={index === selectedEntries.length - 1}
                      aria-label={`Move ${memoryName(entry)} later`}
                    >
                      <ArrowDownIcon aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeEntry(entry.id)}
                      aria-label={`Remove ${memoryName(entry)}`}
                    >
                      <XMarkIcon aria-hidden="true" />
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <div className={styles.sequenceEmpty}>
              <span aria-hidden="true" />
              <p>Your route will take shape here.</p>
              <small>Select at least {CHAPTER_MIN_MEMORIES} memories.</small>
            </div>
          )}

          {error ? <p className={styles.editorError} role="alert">{error}</p> : null}

          <button
            type="submit"
            className={styles.chapterSave}
            disabled={isPending || availableEntries.length < CHAPTER_MIN_MEMORIES}
          >
            {isPending ? 'Saving chapter…' : chapter ? 'Save changes' : 'Create chapter'}
          </button>
          <p className={styles.chapterSaveHint}>
            Your original atlas memories remain independent and unchanged.
          </p>

          {chapter ? (
            <div className={styles.chapterDelete}>
              {confirmingDelete ? (
                <p>Delete this chapter? Its memories will stay in your atlas.</p>
              ) : null}
              <button type="button" onClick={handleDelete} disabled={isPending}>
                <TrashIcon aria-hidden="true" />
                {confirmingDelete ? 'Yes, delete chapter' : 'Delete chapter'}
              </button>
              {confirmingDelete ? (
                <button type="button" onClick={() => setConfirmingDelete(false)}>Keep it</button>
              ) : null}
            </div>
          ) : null}
        </aside>
      </form>
    </div>
  );
}
