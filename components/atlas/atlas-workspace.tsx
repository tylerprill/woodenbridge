'use client';

import {
  ArrowsPointingOutIcon,
  Bars3BottomLeftIcon,
  MagnifyingGlassIcon,
  MapPinIcon,
  PhotoIcon,
  PlusIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

import {
  createAtlasDraftAction,
  resolveAtlasPlaceAction,
  saveAtlasViewAction,
} from '@/app/lib/actions/atlas';
import { getAtlasEntryMediaAction } from '@/app/lib/actions/atlas-media';
import type {
  AtlasData,
  AtlasEntry,
  AtlasView,
  JourneyState,
} from '@/app/lib/atlas/definitions';
import {
  getAtlasPlaceContextLabel,
  withAtlasPlaceContext,
} from '@/app/lib/atlas/place';
import AtlasMap from './atlas-map-loader';
import { MemoryDrawer } from './memory-drawer';
import { MemoryTray } from './memory-tray';
import styles from './atlas.module.css';

type AtlasFilter = 'all' | 'draft' | JourneyState;

type AtlasWorkspaceProps = {
  displayName: string;
  initialData: AtlasData;
  initialSelectedId?: string | null;
};

function viewsAreEquivalent(first: AtlasView, second: AtlasView) {
  return (
    Math.abs(first.latitude - second.latitude) < 0.00001 &&
    Math.abs(first.longitude - second.longitude) < 0.00001 &&
    Math.abs(first.zoom - second.zoom) < 0.01 &&
    Math.abs(first.bearing - second.bearing) < 0.1 &&
    Math.abs(first.pitch - second.pitch) < 0.1
  );
}

export function AtlasWorkspace({
  displayName,
  initialData,
  initialSelectedId = null,
}: AtlasWorkspaceProps) {
  const router = useRouter();
  const [entries, setEntries] = useState(initialData.entries);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialSelectedId,
  );
  const [placementMode, setPlacementMode] = useState(false);
  const [placementBusy, setPlacementBusy] = useState(false);
  const [filter, setFilter] = useState<AtlasFilter>('all');
  const [query, setQuery] = useState('');
  const [activeSearchIndex, setActiveSearchIndex] = useState(-1);
  const [trayOpen, setTrayOpen] = useState(false);
  const [fitRequest, setFitRequest] = useState(0);
  const [focusRequest, setFocusRequest] = useState({
    id: initialSelectedId,
    nonce: initialSelectedId ? 1 : 0,
  });
  const [notice, setNotice] = useState('');
  const [drawerDirty, setDrawerDirty] = useState(false);
  const [mediaLoadingId, setMediaLoadingId] = useState<string | null>(null);
  const [placeResolvingId, setPlaceResolvingId] = useState<string | null>(null);
  const viewTimerRef = useRef<number | null>(null);
  const latestViewRef = useRef<AtlasView>(initialData.view);
  const lastSavedViewRef = useRef<AtlasView>(initialData.view);
  const viewSaveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const entriesRef = useRef(initialData.entries);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const resolvingPlaceIdsRef = useRef(new Set<string>());
  const loadedMediaIdsRef = useRef(new Set<string>());
  const loadingMediaIdsRef = useRef(new Set<string>());

  const closeSelectedEntry = useCallback(() => {
    setDrawerDirty(false);
    setSelectedId(null);
    if (initialSelectedId) router.replace('/dashboard', { scroll: false });
  }, [initialSelectedId, router]);

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  const visibleEntries = useMemo(() => {
    const search = query.trim().toLowerCase();
    return entries.filter((entry) => {
      const matchesFilter =
        filter === 'all' ||
        (filter === 'draft'
          ? entry.recordState === 'draft'
          : entry.recordState === 'saved' && entry.journeyState === filter);
      const matchesSearch =
        !search ||
        entry.title.toLowerCase().includes(search) ||
        entry.placeLabel.toLowerCase().includes(search) ||
        entry.placeName?.toLowerCase().includes(search) ||
        entry.placeLocality?.toLowerCase().includes(search) ||
        entry.placeRegion?.toLowerCase().includes(search) ||
        entry.placeCountry?.toLowerCase().includes(search) ||
        entry.description.toLowerCase().includes(search);
      return matchesFilter && matchesSearch;
    });
  }, [entries, filter, query]);
  const searchResults = visibleEntries.slice(0, 5);

  const selectedEntry =
    entries.find((entry) => entry.id === selectedId) ?? null;
  const counts = useMemo(
    () =>
      entries.reduce(
        (current, entry) => {
          if (entry.recordState === 'draft') current.drafts += 1;
          else if (entry.journeyState === 'visited') current.visited += 1;
          else current.future += 1;
          return current;
        },
        { visited: 0, future: 0, drafts: 0 },
      ),
    [entries],
  );

  const loadEntryMedia = useCallback(async (id: string) => {
    if (
      loadedMediaIdsRef.current.has(id) ||
      loadingMediaIdsRef.current.has(id)
    ) {
      return;
    }

    loadingMediaIdsRef.current.add(id);
    setMediaLoadingId(id);
    try {
      const result = await getAtlasEntryMediaAction(id);
      if (!result.ok) {
        setNotice(result.message);
        return;
      }

      loadedMediaIdsRef.current.add(id);
      setEntries((current) =>
        current.map((entry) =>
          entry.id === id ? { ...entry, media: result.data } : entry,
        ),
      );
    } catch (error) {
      console.error('Atlas photographs could not be opened:', error);
      setNotice('The photographs could not be opened. Please try again.');
    } finally {
      loadingMediaIdsRef.current.delete(id);
      setMediaLoadingId((current) => (current === id ? null : current));
    }
  }, []);

  const enrichPlace = useCallback((id: string) => {
    const entry = entriesRef.current.find((candidate) => candidate.id === id);
    if (
      !entry ||
      entry.placeGeocodedAt ||
      resolvingPlaceIdsRef.current.has(id)
    ) {
      return;
    }

    resolvingPlaceIdsRef.current.add(id);
    setPlaceResolvingId(id);
    void resolveAtlasPlaceAction(id)
      .then((resolution) => {
        if (!resolution.ok) {
          setNotice(resolution.message);
          return;
        }
        setEntries((current) =>
          current.map((currentEntry) =>
            currentEntry.id === resolution.data.entryId
              ? withAtlasPlaceContext(currentEntry, resolution.data.place)
              : currentEntry,
          ),
        );
      })
      .catch((error) => {
        console.warn('Atlas place enrichment could not finish:', error);
        setNotice('We could not identify this place yet. Name it yourself.');
      })
      .finally(() => {
        resolvingPlaceIdsRef.current.delete(id);
        setPlaceResolvingId((current) => (current === id ? null : current));
      });
  }, []);

  const selectEntry = useCallback(
    (id: string) => {
      if (drawerDirty && selectedId && selectedId !== id) {
        setNotice('Save or discard your changes before opening another place.');
        return;
      }

      setSelectedId(id);
      setPlacementMode(false);
      setTrayOpen(false);
      setFocusRequest((current) => ({ id, nonce: current.nonce + 1 }));
      enrichPlace(id);
      void loadEntryMedia(id);
    },
    [drawerDirty, enrichPlace, loadEntryMedia, selectedId],
  );

  useEffect(() => {
    if (!initialSelectedId) return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      enrichPlace(initialSelectedId);
      void loadEntryMedia(initialSelectedId);
    });
    return () => {
      active = false;
    };
  }, [enrichPlace, initialSelectedId, loadEntryMedia]);

  const placeEntry = useCallback(
    async ({
      latitude,
      longitude,
    }: {
      latitude: number;
      longitude: number;
    }) => {
      if (placementBusy) return;
      setPlacementBusy(true);
      const clientRequestId = crypto.randomUUID();
      const now = new Date().toISOString();
      const optimisticId = `pending-${clientRequestId}`;
      const optimisticEntry: AtlasEntry = {
        id: optimisticId,
        title: '',
        description: '',
        placeLabel: '',
        placeName: null,
        placeLocality: null,
        placeRegion: null,
        placeCountry: null,
        placeCountryCode: null,
        placeGeocoder: null,
        placeGeocodedAt: null,
        visitedOn: null,
        recordState: 'draft',
        journeyState: 'visited',
        latitude,
        longitude,
        version: 1,
        createdAt: now,
        updatedAt: now,
        media: [],
      };

      setEntries((current) => [optimisticEntry, ...current]);
      setNotice('Pin placed. Preparing your field note…');

      try {
        const result = await createAtlasDraftAction({
          clientRequestId,
          latitude,
          longitude,
        });

        if (!result.ok) {
          setEntries((current) =>
            current.filter((entry) => entry.id !== optimisticId),
          );
          setNotice(result.message);
          return;
        }

        loadedMediaIdsRef.current.add(result.data.id);
        setEntries((current) => [
          result.data,
          ...current.filter((entry) => entry.id !== optimisticId),
        ]);
        setSelectedId(result.data.id);
        setFocusRequest((current) => ({
          id: result.data.id,
          nonce: current.nonce + 1,
        }));
        setPlacementMode(false);
        setNotice('Pin placed. Add the detail you want to remember.');

        setPlaceResolvingId(result.data.id);
        void resolveAtlasPlaceAction(result.data.id)
          .then((resolution) => {
            if (!resolution.ok) {
              setNotice(resolution.message);
              return;
            }
            setEntries((current) =>
              current.map((entry) =>
                entry.id === resolution.data.entryId
                  ? withAtlasPlaceContext(entry, resolution.data.place)
                  : entry,
              ),
            );
          })
          .catch((error) => {
            console.warn('Atlas place enrichment could not finish:', error);
            setNotice(
              'We could not identify this place yet. Name it yourself.',
            );
          })
          .finally(() =>
            setPlaceResolvingId((current) =>
              current === result.data.id ? null : current,
            ),
          );
      } catch (error) {
        console.error('Atlas pin placement failed:', error);
        setEntries((current) =>
          current.filter((entry) => entry.id !== optimisticId),
        );
        setNotice('The atlas could not place that pin. Please try again.');
      } finally {
        setPlacementBusy(false);
      }
    },
    [placementBusy],
  );

  const rememberView = useCallback((view: AtlasView) => {
    latestViewRef.current = view;
    if (viewTimerRef.current) window.clearTimeout(viewTimerRef.current);
    viewTimerRef.current = window.setTimeout(() => {
      viewSaveQueueRef.current = viewSaveQueueRef.current
        .then(async () => {
          const latestView = latestViewRef.current;
          if (viewsAreEquivalent(lastSavedViewRef.current, latestView)) return;

          const result = await saveAtlasViewAction(latestView);
          if (result.ok) lastSavedViewRef.current = latestView;
        })
        .catch((error) => {
          console.warn('Atlas view could not be remembered:', error);
        });
    }, 1400);
  }, []);

  useEffect(
    () => () => {
      if (viewTimerRef.current) window.clearTimeout(viewTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (selectedId) {
          setNotice('Close the memory editor before searching your atlas.');
          return;
        }
        setTrayOpen(false);
        searchInputRef.current?.focus();
        return;
      }

      if (event.key === 'Escape') {
        if (document.activeElement === searchInputRef.current) {
          searchInputRef.current?.blur();
          setQuery('');
          setActiveSearchIndex(-1);
        } else if (selectedId) {
          if (drawerDirty) {
            setNotice('Save or discard your changes before closing.');
          } else {
            closeSelectedEntry();
          }
        } else if (trayOpen) setTrayOpen(false);
        else setPlacementMode(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [closeSelectedEntry, drawerDirty, selectedId, trayOpen]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  return (
    <div
      className={`${styles.workspace} atlas-workspace-root`}
      data-placement={placementMode ? 'true' : 'false'}
      data-editor-open={selectedEntry ? 'true' : 'false'}
    >
      <AtlasMap
        entries={visibleEntries}
        initialView={initialData.view}
        interactionLocked={Boolean(selectedEntry)}
        selectedId={selectedId}
        placementMode={placementMode}
        focusRequest={focusRequest}
        fitRequest={fitRequest}
        onSelect={selectEntry}
        onPlace={(coordinates) => void placeEntry(coordinates)}
        onViewChange={rememberView}
      />

      <header
        className={styles.atlasHeader}
        inert={selectedEntry ? true : undefined}
      >
        <div className={styles.atlasIdentity}>
          <p className={styles.eyebrow}>Private field atlas</p>
          <h1>{displayName}&rsquo;s world</h1>
          <div className={styles.atlasSummary} aria-label="Atlas summary">
            <span>{counts.visited} remembered</span>
            {counts.drafts ? (
              <>
                <i aria-hidden="true" />
                <span>
                  {counts.drafts} {counts.drafts === 1 ? 'draft' : 'drafts'}
                </span>
              </>
            ) : null}
            <i aria-hidden="true" />
            <span>{counts.future} ahead</span>
          </div>
        </div>

        <div
          className={styles.searchWrap}
          data-expanded={query ? 'true' : 'false'}
          onClick={() => searchInputRef.current?.focus()}
        >
          <MagnifyingGlassIcon aria-hidden="true" />
          <label htmlFor="atlas-search" className="sr-only">
            Search your atlas
          </label>
          <input
            ref={searchInputRef}
            id="atlas-search"
            type="search"
            role="combobox"
            value={query}
            placeholder="Search your memories"
            autoComplete="off"
            enterKeyHint="search"
            spellCheck={false}
            aria-autocomplete="list"
            aria-haspopup="listbox"
            aria-controls="atlas-search-results"
            aria-expanded={Boolean(query)}
            aria-activedescendant={
              activeSearchIndex >= 0 && activeSearchIndex < searchResults.length
                ? `atlas-search-option-${searchResults[activeSearchIndex].id}`
                : undefined
            }
            onFocus={() => setTrayOpen(false)}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveSearchIndex(-1);
            }}
            onKeyDown={(event) => {
              if (!query || !searchResults.length) return;

              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActiveSearchIndex((current) =>
                  current >= searchResults.length - 1 ? 0 : current + 1,
                );
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveSearchIndex((current) =>
                  current <= 0 ? searchResults.length - 1 : current - 1,
                );
              } else if (event.key === 'Enter') {
                event.preventDefault();
                const entry =
                  activeSearchIndex >= 0 &&
                  activeSearchIndex < searchResults.length
                    ? searchResults[activeSearchIndex]
                    : searchResults[0];
                selectEntry(entry.id);
                setQuery('');
                setActiveSearchIndex(-1);
              }
            }}
          />
          {query ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setQuery('');
                setActiveSearchIndex(-1);
                searchInputRef.current?.focus();
              }}
              aria-label="Clear search"
            >
              <XMarkIcon aria-hidden="true" />
            </button>
          ) : (
            <kbd>⌘ K</kbd>
          )}
          {query ? (
            <div className={styles.searchResults}>
              <p role="status">
                {visibleEntries.length
                  ? `${visibleEntries.length} ${visibleEntries.length === 1 ? 'place' : 'places'} found`
                  : 'No matching places'}
              </p>
              <div
                id="atlas-search-results"
                className={styles.searchOptions}
                role="listbox"
                aria-label="Matching atlas places"
              >
                {searchResults.map((entry, index) => (
                  <button
                    type="button"
                    key={entry.id}
                    id={`atlas-search-option-${entry.id}`}
                    role="option"
                    aria-selected={activeSearchIndex === index}
                    data-active={activeSearchIndex === index ? 'true' : 'false'}
                    onMouseEnter={() => setActiveSearchIndex(index)}
                    onClick={() => {
                      selectEntry(entry.id);
                      setQuery('');
                      setActiveSearchIndex(-1);
                    }}
                  >
                    <MapPinIcon aria-hidden="true" />
                    <span>
                      <strong>{entry.title || 'Untitled place'}</strong>
                      <small>
                        {entry.recordState === 'draft' ? 'Draft · ' : null}
                        {getAtlasPlaceContextLabel(entry)}
                      </small>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </header>

      <div
        className={styles.toolDock}
        role="toolbar"
        aria-label="Atlas tools"
        inert={selectedEntry ? true : undefined}
      >
        <button
          type="button"
          className={styles.addButton}
          data-active={placementMode ? 'true' : 'false'}
          aria-pressed={placementMode}
          onClick={() => {
            setPlacementMode((current) => !current);
            setSelectedId(null);
            setTrayOpen(false);
            setQuery('');
            setActiveSearchIndex(-1);
            searchInputRef.current?.blur();
          }}
        >
          {placementMode ? (
            <XMarkIcon aria-hidden="true" />
          ) : (
            <PlusIcon aria-hidden="true" />
          )}
          <span>{placementMode ? 'Cancel pin' : 'Add memory'}</span>
        </button>
        <span className={styles.toolDivider} aria-hidden="true" />
        <Link href="/dashboard/import" aria-label="Import photos as memories">
          <PhotoIcon aria-hidden="true" />
          <span>Import</span>
        </Link>
        <button
          type="button"
          onClick={() => {
            setTrayOpen((current) => !current);
            setSelectedId(null);
            setQuery('');
            setActiveSearchIndex(-1);
            searchInputRef.current?.blur();
          }}
          aria-label={trayOpen ? 'Close memory list' : 'Open memory list'}
          aria-expanded={trayOpen}
        >
          <Bars3BottomLeftIcon aria-hidden="true" />
          <span>Memories</span>
        </button>
        <button
          type="button"
          onClick={() => setFitRequest((current) => current + 1)}
          aria-label="Fit all memories on map"
        >
          <ArrowsPointingOutIcon aria-hidden="true" />
          <span>Fit pins</span>
        </button>
      </div>

      <div
        className={styles.filterDock}
        role="group"
        aria-label="Filter memories"
        inert={selectedEntry ? true : undefined}
      >
        {(
          [
            ['all', 'All places'],
            ['visited', 'Remembered'],
            ['want_to_visit', 'Ahead'],
            ['draft', 'Drafts'],
          ] as [AtlasFilter, string][]
        ).map(([value, label]) => (
          <button
            type="button"
            key={value}
            data-active={filter === value ? 'true' : 'false'}
            aria-pressed={filter === value}
            onClick={() => {
              setFilter(value);
              setActiveSearchIndex(-1);
            }}
          >
            <span aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      {placementMode ? (
        <div
          className={styles.placementPrompt}
          role="region"
          aria-label="Place a memory"
        >
          <span className={styles.pinPulse} aria-hidden="true" />
          <div role="status" aria-live="polite">
            <strong>
              {placementBusy ? 'Placing your pin…' : 'Choose a place'}
            </strong>
            <p>
              Move through the atlas, then tap or click exactly where the memory
              belongs.
            </p>
          </div>
          <button
            type="button"
            disabled={placementBusy}
            onClick={() => void placeEntry(latestViewRef.current)}
          >
            Use map center
          </button>
        </div>
      ) : null}

      {!entries.length && !placementMode ? (
        <section
          className={styles.emptyState}
          aria-labelledby="empty-atlas-title"
        >
          <span className={styles.emptyStateMark} aria-hidden="true" />
          <p className={styles.eyebrow}>The first page</p>
          <h2 id="empty-atlas-title">Your world is waiting.</h2>
          <p>
            Begin with somewhere that changed you, somewhere you miss, or
            somewhere still calling your name.
          </p>
          <button type="button" onClick={() => setPlacementMode(true)}>
            <PlusIcon aria-hidden="true" /> Place your first memory
          </button>
        </section>
      ) : null}

      {trayOpen ? (
        <MemoryTray
          entries={visibleEntries}
          hasAnyEntries={entries.length > 0}
          onClose={() => setTrayOpen(false)}
          onSelect={selectEntry}
        />
      ) : null}

      {selectedEntry ? (
        <MemoryDrawer
          key={selectedEntry.id}
          entry={selectedEntry}
          onClose={closeSelectedEntry}
          onDirtyChange={setDrawerDirty}
          onUpdate={(updated) => {
            loadedMediaIdsRef.current.add(updated.id);
            setEntries((current) =>
              current.map((entry) =>
                entry.id === updated.id ? updated : entry,
              ),
            );
          }}
          onArchive={(id) => {
            setDrawerDirty(false);
            loadedMediaIdsRef.current.delete(id);
            setEntries((current) => current.filter((entry) => entry.id !== id));
            closeSelectedEntry();
            setNotice('Memory removed from your atlas.');
          }}
          mediaLoading={mediaLoadingId === selectedEntry.id}
          placeResolving={placeResolvingId === selectedEntry.id}
        />
      ) : null}

      {notice ? (
        <div className={styles.toast} role="status">
          <span aria-hidden="true" />
          {notice}
        </div>
      ) : null}

      <p className={styles.privacyNote}>
        Only you can see the memories in this atlas.
      </p>
    </div>
  );
}
