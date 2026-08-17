'use client';

import {
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowPathIcon,
  ArrowUpIcon,
  CheckIcon,
  ExclamationTriangleIcon,
  EyeIcon,
  EyeSlashIcon,
  GlobeAltIcon,
  LockClosedIcon,
  MagnifyingGlassIcon,
  MapPinIcon,
  PhotoIcon,
  PlusIcon,
  TrashIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Fragment,
  type FormEvent,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from 'react';

import {
  createAtlasChapterAction,
  deleteAtlasChapterAction,
  updateAtlasChapterAction,
} from '@/app/lib/actions/chapters';
import type {
  AtlasChapterEditorChapter,
  AtlasChapterMemoryOption,
  ChapterActionError,
} from '@/app/lib/chapters/definitions';
import {
  CHAPTER_INTRODUCTION_MAX_LENGTH,
  CHAPTER_MAX_MEMORIES,
  CHAPTER_MIN_MEMORIES,
  CHAPTER_TITLE_MAX_LENGTH,
  CHAPTER_TRANSITION_MAX_LENGTH,
} from '@/app/lib/chapters/validation';
import styles from './chapters.module.css';

const MEMORY_PICKER_BATCH_SIZE = 24;
type ChapterEditorStep = 'details' | 'arrange';
const MEMORY_DATE_FORMATTER = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

function memoryDate(entry: AtlasChapterMemoryOption) {
  if (!entry.visitedOn) {
    return entry.journeyState === 'want_to_visit' ? 'Ahead' : 'Undated';
  }
  return MEMORY_DATE_FORMATTER.format(new Date(`${entry.visitedOn}T12:00:00`));
}

function memoryName(entry: AtlasChapterMemoryOption) {
  return (
    entry.title.trim() ||
    entry.placeLabel ||
    entry.placeName ||
    'Untitled memory'
  );
}

function MemoryThumbnail({
  entry,
  compact = false,
  isCover = false,
}: {
  entry: AtlasChapterMemoryOption;
  compact?: boolean;
  isCover?: boolean;
}) {
  return (
    <div
      className={styles.memoryThumbnail}
      data-compact={compact ? 'true' : undefined}
      data-has-image={entry.thumbnailUrl ? 'true' : undefined}
      data-cover={isCover ? 'true' : undefined}
      aria-hidden="true"
    >
      {entry.thumbnailUrl ? (
        <Image
          src={entry.thumbnailUrl}
          alt=""
          fill
          sizes={compact ? '44px' : '(max-width: 680px) 58px, 68px'}
          loading="lazy"
          unoptimized
        />
      ) : (
        <MapPinIcon />
      )}
    </div>
  );
}

export function ChapterEditor({
  chapter,
  availableEntries,
  initialStep = 'details',
}: {
  chapter: AtlasChapterEditorChapter | null;
  availableEntries: AtlasChapterMemoryOption[];
  initialStep?: ChapterEditorStep;
}) {
  const router = useRouter();
  const [editorStep, setEditorStep] = useState<ChapterEditorStep>(initialStep);
  const initialMemories = useMemo(() => chapter?.memories ?? [], [chapter]);
  const [title, setTitle] = useState(chapter?.title ?? '');
  const [introduction, setIntroduction] = useState(chapter?.introduction ?? '');
  const [selectedIds, setSelectedIds] = useState(
    initialMemories.map((memory) => memory.entryId),
  );
  const [transitionNotes, setTransitionNotes] = useState<
    Record<string, string>
  >(
    Object.fromEntries(
      initialMemories.map((memory) => [memory.entryId, memory.transitionNote]),
    ),
  );
  const [openTransitionIds, setOpenTransitionIds] = useState(
    new Set(
      initialMemories
        .filter((memory) => memory.transitionNote)
        .map((memory) => memory.entryId),
    ),
  );
  const [coverMediaId, setCoverMediaId] = useState(
    chapter?.coverMediaId ?? null,
  );
  const [visibility, setVisibility] = useState(
    chapter?.visibility ?? 'private',
  );
  const [shareMap, setShareMap] = useState(chapter?.shareMap ?? true);
  const [shareLocationPrecision, setShareLocationPrecision] = useState(
    chapter?.shareLocationPrecision ?? 'approximate',
  );
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [visibleMemoryCount, setVisibleMemoryCount] = useState(
    MEMORY_PICKER_BATCH_SIZE,
  );
  const [error, setError] = useState('');
  const [errorType, setErrorType] = useState<ChapterActionError | null>(null);
  const [reorderAnnouncement, setReorderAnnouncement] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isPending, startTransition] = useTransition();
  const initialMemoryState = JSON.stringify(initialMemories);
  const currentMemoryState = JSON.stringify(
    selectedIds.map((entryId) => ({
      entryId,
      transitionNote: transitionNotes[entryId] ?? '',
    })),
  );
  const isDirty =
    title !== (chapter?.title ?? '') ||
    introduction !== (chapter?.introduction ?? '') ||
    currentMemoryState !== initialMemoryState ||
    coverMediaId !== (chapter?.coverMediaId ?? null) ||
    visibility !== (chapter?.visibility ?? 'private') ||
    shareMap !== (chapter?.shareMap ?? true) ||
    shareLocationPrecision !==
      (chapter?.shareLocationPrecision ?? 'approximate');

  const entriesById = useMemo(() => {
    return new Map(availableEntries.map((entry) => [entry.id, entry]));
  }, [availableEntries]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectedEntries = useMemo(
    () =>
      selectedIds
        .map((id) => entriesById.get(id))
        .filter((entry): entry is AtlasChapterMemoryOption => Boolean(entry)),
    [entriesById, selectedIds],
  );
  const automaticCoverMediaId =
    selectedEntries.find((entry) => entry.coverMediaId)?.coverMediaId ?? null;
  const effectiveCoverMediaId = coverMediaId ?? automaticCoverMediaId;
  const filteredEntries = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLowerCase();
    if (!normalizedQuery) return availableEntries;
    return availableEntries.filter((entry) =>
      [entry.title, entry.placeLabel, entry.placeName]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(normalizedQuery)),
    );
  }, [availableEntries, deferredQuery]);
  const visibleEntries = filteredEntries.slice(0, visibleMemoryCount);
  const canArrange =
    title.trim().length > 0 && selectedIds.length >= CHAPTER_MIN_MEMORIES;

  useEffect(() => {
    if (!isDirty || isPending) return;

    const confirmExit = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    const confirmLinkNavigation = (event: MouseEvent) => {
      const target = event.target;
      const link =
        target instanceof Element
          ? target.closest<HTMLAnchorElement>('a[href]')
          : null;
      if (
        !link ||
        link.target === '_blank' ||
        link.hasAttribute('download') ||
        link.href === window.location.href
      ) {
        return;
      }
      if (
        !window.confirm(
          'Leave this chapter? Your unsaved changes will be lost.',
        )
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };

    window.addEventListener('beforeunload', confirmExit);
    document.addEventListener('click', confirmLinkNavigation, true);
    return () => {
      window.removeEventListener('beforeunload', confirmExit);
      document.removeEventListener('click', confirmLinkNavigation, true);
    };
  }, [isDirty, isPending]);

  function updateQuery(value: string) {
    setQuery(value);
    setVisibleMemoryCount(MEMORY_PICKER_BATCH_SIZE);
  }

  function goToEditorStep(nextStep: ChapterEditorStep) {
    if (nextStep === 'arrange' && !canArrange) return;
    setEditorStep(nextStep);
    const nextUrl = new URL(window.location.href);
    if (nextStep === 'arrange') nextUrl.searchParams.set('step', 'arrange');
    else nextUrl.searchParams.delete('step');
    nextUrl.hash = '';
    window.history.replaceState(
      window.history.state,
      '',
      `${nextUrl.pathname}${nextUrl.search}`,
    );
    window.requestAnimationFrame(() => {
      const headingId =
        nextStep === 'details'
          ? 'chapter-story-heading'
          : 'chapter-sequence-heading';
      document.getElementById(headingId)?.focus({ preventScroll: true });
      window.scrollTo({
        top: 0,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'auto'
          : 'smooth',
      });
    });
  }

  function addEntry(entryId: string) {
    setError('');
    setErrorType(null);
    if (selectedIds.includes(entryId)) return;
    if (selectedIds.length >= CHAPTER_MAX_MEMORIES) {
      setError(`A chapter can hold up to ${CHAPTER_MAX_MEMORIES} memories.`);
      setErrorType('invalid');
      return;
    }
    setSelectedIds([...selectedIds, entryId]);
  }

  function removeEntry(entryId: string) {
    setError('');
    setErrorType(null);
    setSelectedIds((current) => current.filter((id) => id !== entryId));
    const entry = entriesById.get(entryId);
    if (entry?.coverMediaId === coverMediaId) setCoverMediaId(null);
  }

  function announcePosition(entryId: string, nextIds: string[]) {
    const entry = entriesById.get(entryId);
    const index = nextIds.indexOf(entryId);
    if (!entry || index < 0) return;
    setReorderAnnouncement(
      `${memoryName(entry)} moved to position ${index + 1} of ${nextIds.length}.`,
    );
  }

  function moveEntry(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= selectedIds.length) return;
    const next = [...selectedIds];
    [next[index], next[target]] = [next[target], next[index]];
    setSelectedIds(next);
    announcePosition(next[target], next);
  }

  function updateTransitionNote(entryId: string, value: string) {
    setTransitionNotes((current) => ({ ...current, [entryId]: value }));
  }

  function toggleTransition(entryId: string) {
    const isOpen = openTransitionIds.has(entryId);
    if (isOpen) updateTransitionNote(entryId, '');
    setOpenTransitionIds((current) => {
      const next = new Set(current);
      if (isOpen) next.delete(entryId);
      else next.add(entryId);
      return next;
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setErrorType(null);

    if (selectedIds.length < CHAPTER_MIN_MEMORIES) {
      setError(
        `Choose at least ${CHAPTER_MIN_MEMORIES} memories for this chapter.`,
      );
      setErrorType('invalid');
      return;
    }

    startTransition(async () => {
      const input = {
        title,
        introduction,
        memories: selectedIds.map((entryId) => ({
          entryId,
          transitionNote: transitionNotes[entryId] ?? '',
        })),
        coverMediaId,
        visibility,
        shareMap,
        shareLocationPrecision,
      };
      try {
        const result = chapter
          ? await updateAtlasChapterAction({
              ...input,
              id: chapter.id,
              version: chapter.version,
            })
          : await createAtlasChapterAction(input);

        if (!result.ok) {
          setError(result.message);
          setErrorType(result.error);
          return;
        }

        router.push(
          `/dashboard/chapters/${result.data.id}?saved=${chapter ? 'updated' : 'created'}`,
        );
      } catch {
        setError(
          'We could not reach Field Atlas. Check your connection and try saving again.',
        );
        setErrorType('failed');
      }
    });
  }

  function handleDelete() {
    if (!chapter) return;
    if (!confirmingDelete) {
      setConfirmingDelete(true);
      return;
    }

    setError('');
    setErrorType(null);
    startTransition(async () => {
      try {
        const result = await deleteAtlasChapterAction(chapter.id);
        if (!result.ok) {
          setError(result.message);
          setErrorType(result.error);
          setConfirmingDelete(false);
          return;
        }
        router.push('/dashboard/chapters');
      } catch {
        setError(
          'We could not reach Field Atlas. Your chapter has not been deleted.',
        );
        setErrorType('failed');
        setConfirmingDelete(false);
      }
    });
  }

  const errorTitle =
    errorType === 'conflict'
      ? 'A newer version is already saved.'
      : errorType === 'not-found'
        ? 'This chapter is no longer available.'
        : errorType === 'invalid'
          ? 'One detail needs attention.'
          : 'Your work is still here.';

  return (
    <div className={styles.editorPage}>
      <header className={styles.editorHeader} data-editor-step={editorStep}>
        <div>
          <Link
            href={
              chapter
                ? `/dashboard/chapters/${chapter.id}`
                : '/dashboard/chapters'
            }
          >
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

      <form
        className={styles.editorLayout}
        data-editor-step={editorStep}
        onSubmit={handleSubmit}
      >
        <nav className={styles.editorSteps} aria-label="Chapter maker steps">
          <button
            type="button"
            data-active={editorStep === 'details' ? 'true' : undefined}
            aria-current={editorStep === 'details' ? 'step' : undefined}
            onClick={() => goToEditorStep('details')}
          >
            <span>01</span>
            <span>
              <strong>Story &amp; places</strong>
              <small>Name the chapter and gather its memories.</small>
            </span>
            {editorStep === 'arrange' ? <CheckIcon aria-hidden="true" /> : null}
          </button>
          <button
            type="button"
            data-active={editorStep === 'arrange' ? 'true' : undefined}
            aria-current={editorStep === 'arrange' ? 'step' : undefined}
            onClick={() => goToEditorStep('arrange')}
            disabled={editorStep === 'details' && !canArrange}
          >
            <span>02</span>
            <span>
              <strong>Arrange &amp; share</strong>
              <small>
                {canArrange
                  ? 'Set the route, cover, and privacy.'
                  : `Add a title and ${CHAPTER_MIN_MEMORIES} memories first.`}
              </small>
            </span>
          </button>
        </nav>

        <div className={styles.editorMain}>
          <section
            className={styles.editorSection}
            aria-labelledby="chapter-story-heading"
            hidden={editorStep !== 'details'}
          >
            <div className={styles.editorSectionHeading}>
              <span>01</span>
              <div>
                <p className="section-kicker">The story</p>
                <h2 id="chapter-story-heading" tabIndex={-1}>
                  Name what connects these places.
                </h2>
              </div>
            </div>

            <label className={styles.editorField}>
              <span>Chapter title</span>
              <input
                name="title"
                aria-label="Chapter title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                maxLength={CHAPTER_TITLE_MAX_LENGTH}
                placeholder="Autumn through Kyoto"
                autoComplete="off"
                required
              />
              <small>
                {title.length} / {CHAPTER_TITLE_MAX_LENGTH}
              </small>
            </label>
            <label className={styles.editorField}>
              <span>
                Introduction <em>Optional</em>
              </span>
              <textarea
                name="introduction"
                aria-label="Chapter introduction"
                value={introduction}
                onChange={(event) => setIntroduction(event.target.value)}
                maxLength={CHAPTER_INTRODUCTION_MAX_LENGTH}
                placeholder="A few words about what made this journey matter…"
                rows={5}
              />
              <small>
                {introduction.length} / {CHAPTER_INTRODUCTION_MAX_LENGTH}
              </small>
            </label>
          </section>

          <section
            className={styles.editorSection}
            aria-labelledby="chapter-memories-heading"
            hidden={editorStep !== 'details'}
          >
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
                    onChange={(event) => updateQuery(event.target.value)}
                    placeholder="Search by title or place"
                  />
                  {query ? (
                    <button
                      type="button"
                      onClick={() => updateQuery('')}
                      aria-label="Clear search"
                    >
                      <XMarkIcon aria-hidden="true" />
                    </button>
                  ) : null}
                </label>
                <div className={styles.memoryPicker}>
                  {visibleEntries.map((entry) => {
                    const isSelected = selectedIdSet.has(entry.id);
                    return (
                      <article
                        className={styles.memoryOption}
                        key={entry.id}
                        data-selected={isSelected}
                      >
                        <MemoryThumbnail entry={entry} />
                        <div className={styles.memoryOptionCopy}>
                          <h3>{memoryName(entry)}</h3>
                          <p>
                            {entry.placeLabel ||
                              entry.placeName ||
                              'Pinned place'}
                          </p>
                          <span>{memoryDate(entry)}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            isSelected
                              ? removeEntry(entry.id)
                              : addEntry(entry.id)
                          }
                          aria-label={`${isSelected ? 'Remove' : 'Add'} ${memoryName(entry)}`}
                          disabled={
                            !isSelected &&
                            selectedIds.length >= CHAPTER_MAX_MEMORIES
                          }
                        >
                          {isSelected ? (
                            <CheckIcon aria-hidden="true" />
                          ) : (
                            <PlusIcon aria-hidden="true" />
                          )}
                          <span>{isSelected ? 'Added' : 'Add'}</span>
                        </button>
                      </article>
                    );
                  })}
                </div>
                {filteredEntries.length > MEMORY_PICKER_BATCH_SIZE ? (
                  <div className={styles.memoryPickerFooter}>
                    <span>
                      Showing{' '}
                      {Math.min(visibleMemoryCount, filteredEntries.length)} of{' '}
                      {filteredEntries.length}
                    </span>
                    {visibleMemoryCount < filteredEntries.length ? (
                      <button
                        type="button"
                        onClick={() =>
                          setVisibleMemoryCount((current) =>
                            Math.min(
                              current + MEMORY_PICKER_BATCH_SIZE,
                              filteredEntries.length,
                            ),
                          )
                        }
                      >
                        Show more
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {!filteredEntries.length ? (
                  <div className={styles.editorInlineEmpty}>
                    <p>No memories match “{query}”.</p>
                    <button type="button" onClick={() => updateQuery('')}>
                      Clear search
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              <div className={styles.editorEmpty}>
                <MapPinIcon aria-hidden="true" />
                <h3>Your chapter needs memories first.</h3>
                <p>
                  Save at least two places in your atlas, then return here to
                  connect them.
                </p>
                <Link href="/dashboard">Open your atlas</Link>
              </div>
            )}
          </section>

          <section
            className={styles.editorSection}
            aria-labelledby="chapter-sharing-heading"
            hidden={editorStep !== 'arrange'}
          >
            <div className={styles.editorSectionHeading}>
              <span>03</span>
              <div>
                <p className="section-kicker">Privacy</p>
                <h2 id="chapter-sharing-heading">Choose who can enter.</h2>
              </div>
            </div>

            <div className={styles.chapterVisibilityChoices}>
              <label
                data-selected={visibility === 'private' ? 'true' : undefined}
              >
                <input
                  type="radio"
                  name="visibility"
                  value="private"
                  checked={visibility === 'private'}
                  onChange={() => setVisibility('private')}
                />
                <LockClosedIcon aria-hidden="true" />
                <span>
                  <strong>Private</strong>
                  <small>Only you can open this chapter.</small>
                </span>
                {visibility === 'private' ? (
                  <CheckIcon aria-hidden="true" />
                ) : null}
              </label>
              <label
                data-selected={visibility === 'shared' ? 'true' : undefined}
              >
                <input
                  type="radio"
                  name="visibility"
                  value="shared"
                  checked={visibility === 'shared'}
                  onChange={() => setVisibility('shared')}
                />
                <GlobeAltIcon aria-hidden="true" />
                <span>
                  <strong>Anyone with the link</strong>
                  <small>Unlisted, read-only, and revocable at any time.</small>
                </span>
                {visibility === 'shared' ? (
                  <CheckIcon aria-hidden="true" />
                ) : null}
              </label>
            </div>

            {visibility === 'shared' ? (
              <div className={styles.chapterShareOptions}>
                <label>
                  <input
                    type="checkbox"
                    checked={shareMap}
                    onChange={(event) => setShareMap(event.target.checked)}
                  />
                  <span
                    className={styles.chapterShareToggle}
                    aria-hidden="true"
                  />
                  {shareMap ? (
                    <EyeIcon aria-hidden="true" />
                  ) : (
                    <EyeSlashIcon aria-hidden="true" />
                  )}
                  <span>
                    <strong>Include the route map</strong>
                    <small>
                      Turn this off when the story matters more than the
                      geography.
                    </small>
                  </span>
                </label>
                <label data-disabled={!shareMap ? 'true' : undefined}>
                  <input
                    type="checkbox"
                    checked={shareLocationPrecision === 'exact'}
                    disabled={!shareMap}
                    onChange={(event) =>
                      setShareLocationPrecision(
                        event.target.checked ? 'exact' : 'approximate',
                      )
                    }
                  />
                  <span
                    className={styles.chapterShareToggle}
                    aria-hidden="true"
                  />
                  <MapPinIcon aria-hidden="true" />
                  <span>
                    <strong>Show exact pin positions</strong>
                    <small>
                      Off by default. Approximate pins protect the precise
                      places you saved.
                    </small>
                  </span>
                </label>
                {chapter ? (
                  <p>
                    Saving a newly shared chapter creates a fresh private link.
                    Returning it to private immediately revokes that link.
                  </p>
                ) : null}
              </div>
            ) : (
              <p className={styles.chapterPrivacyNote}>
                Chapters begin private. Sharing never changes the privacy of the
                original memories.
              </p>
            )}
          </section>

          <div
            className={styles.chapterCompletion}
            hidden={editorStep !== 'arrange'}
          >
            {error ? (
              <div className={styles.editorError} role="alert">
                <ExclamationTriangleIcon aria-hidden="true" />
                <div>
                  <strong>{errorTitle}</strong>
                  <p>{error}</p>
                  {errorType === 'failed' ? (
                    <button type="submit" disabled={isPending}>
                      <ArrowPathIcon aria-hidden="true" />
                      Try saving again
                    </button>
                  ) : errorType === 'conflict' && chapter ? (
                    <Link
                      href={`/dashboard/chapters/${chapter.id}/edit`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Review latest in a new tab
                    </Link>
                  ) : errorType === 'not-found' ? (
                    <Link href="/dashboard/chapters">
                      Return to My Chapters
                    </Link>
                  ) : null}
                </div>
              </div>
            ) : null}

            <button
              type="submit"
              className={styles.chapterSave}
              aria-busy={isPending}
              data-saved={chapter && !isDirty ? 'true' : undefined}
              disabled={
                isPending ||
                availableEntries.length < CHAPTER_MIN_MEMORIES ||
                selectedIds.length < CHAPTER_MIN_MEMORIES ||
                Boolean(chapter && !isDirty)
              }
            >
              {isPending ? (
                <>
                  <span
                    className={styles.chapterSaveSpinner}
                    aria-hidden="true"
                  />
                  Saving chapter…
                </>
              ) : chapter && !isDirty ? (
                <>
                  <CheckIcon aria-hidden="true" />
                  All changes saved
                </>
              ) : chapter ? (
                'Save changes'
              ) : (
                'Create chapter'
              )}
            </button>
            <p className={styles.chapterSaveHint} aria-live="polite">
              {isPending
                ? 'Keeping this page open while your chapter is saved.'
                : chapter && !isDirty
                  ? 'Your chapter is up to date.'
                  : 'Your original atlas memories remain independent and unchanged.'}
            </p>

            {chapter ? (
              <div className={styles.chapterDelete}>
                {confirmingDelete ? (
                  <p>
                    Delete this chapter? Its memories will stay in your atlas.
                  </p>
                ) : null}
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={isPending}
                >
                  <TrashIcon aria-hidden="true" />
                  {confirmingDelete ? 'Yes, delete chapter' : 'Delete chapter'}
                </button>
                {confirmingDelete ? (
                  <button
                    type="button"
                    onClick={() => setConfirmingDelete(false)}
                  >
                    Keep it
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>

        <aside
          className={styles.chapterSequence}
          aria-labelledby="chapter-sequence-heading"
          hidden={editorStep !== 'arrange'}
        >
          <div className={styles.sequenceHeader}>
            <div>
              <p className="section-kicker">Reading order</p>
              <h2 id="chapter-sequence-heading" tabIndex={-1}>
                The route.
              </h2>
            </div>
            <span>{selectedIds.length}</span>
          </div>

          {selectedEntries.length ? (
            <ol className={styles.sequenceList}>
              {selectedEntries.map((entry, index) => {
                const transitionNote = transitionNotes[entry.id] ?? '';
                const transitionIsOpen = openTransitionIds.has(entry.id);
                const isCover =
                  Boolean(entry.coverMediaId) &&
                  entry.coverMediaId === effectiveCoverMediaId;
                const isExplicitCover =
                  Boolean(entry.coverMediaId) &&
                  entry.coverMediaId === coverMediaId;

                return (
                  <Fragment key={entry.id}>
                    {index > 0 ? (
                      <li
                        className={styles.transitionEditor}
                        role="presentation"
                      >
                        {transitionIsOpen ? (
                          <label>
                            <span>
                              Words between{' '}
                              {memoryName(selectedEntries[index - 1])} and{' '}
                              {memoryName(entry)}
                            </span>
                            <textarea
                              value={transitionNote}
                              onChange={(event) =>
                                updateTransitionNote(
                                  entry.id,
                                  event.target.value,
                                )
                              }
                              maxLength={CHAPTER_TRANSITION_MAX_LENGTH}
                              rows={3}
                              placeholder="The road changed here…"
                            />
                            <small>
                              {transitionNote.length} /{' '}
                              {CHAPTER_TRANSITION_MAX_LENGTH}
                            </small>
                            <button
                              type="button"
                              onClick={() => toggleTransition(entry.id)}
                            >
                              Remove transition
                            </button>
                          </label>
                        ) : (
                          <button
                            type="button"
                            onClick={() => toggleTransition(entry.id)}
                          >
                            <PlusIcon aria-hidden="true" />
                            Add words between these stops
                          </button>
                        )}
                      </li>
                    ) : null}
                    <li className={styles.sequenceItem}>
                      <MemoryThumbnail
                        entry={entry}
                        compact
                        isCover={isCover}
                      />
                      <div className={styles.sequenceMemory}>
                        <small>
                          {String(index + 1).padStart(2, '0')}
                          {isCover ? ' · Cover' : ''}
                        </small>
                        <strong>{memoryName(entry)}</strong>
                        <span>
                          {entry.placeLabel ||
                            entry.placeName ||
                            'Pinned place'}
                        </span>
                      </div>
                      <button
                        type="button"
                        className={styles.sequenceRemove}
                        onClick={() => removeEntry(entry.id)}
                        aria-label={`Remove ${memoryName(entry)}`}
                      >
                        <XMarkIcon aria-hidden="true" />
                      </button>
                      <div className={styles.sequenceActions}>
                        <button
                          type="button"
                          onClick={() =>
                            setCoverMediaId(
                              isExplicitCover ? null : entry.coverMediaId,
                            )
                          }
                          disabled={
                            !entry.coverMediaId || (isCover && !isExplicitCover)
                          }
                          aria-pressed={isCover}
                          aria-label={
                            !entry.coverMediaId
                              ? `${memoryName(entry)} has no photo to use as a cover`
                              : isCover && !isExplicitCover
                                ? `${memoryName(entry)} is the automatic chapter cover`
                                : `${isExplicitCover ? 'Return to the automatic cover instead of' : 'Use'} ${memoryName(entry)} as the chapter cover`
                          }
                        >
                          <PhotoIcon aria-hidden="true" />
                          <span>
                            {isCover && !isExplicitCover
                              ? 'Auto cover'
                              : isCover
                                ? 'Cover'
                                : 'Set cover'}
                          </span>
                        </button>
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
                      </div>
                    </li>
                  </Fragment>
                );
              })}
            </ol>
          ) : (
            <div className={styles.sequenceEmpty}>
              <span aria-hidden="true" />
              <p>Your route will take shape here.</p>
              <small>Select at least {CHAPTER_MIN_MEMORIES} memories.</small>
            </div>
          )}

          <p className="sr-only" aria-live="polite">
            {reorderAnnouncement}
          </p>
        </aside>
      </form>
    </div>
  );
}
