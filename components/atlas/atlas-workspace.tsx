'use client';

import {
  ArrowsPointingOutIcon,
  Bars3BottomLeftIcon,
  MagnifyingGlassIcon,
  MapPinIcon,
  PlusIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  createAtlasDraftAction,
  saveAtlasViewAction,
} from '@/app/lib/actions/atlas';
import type {
  AtlasData,
  AtlasEntry,
  AtlasView,
  JourneyState,
} from '@/app/lib/atlas/definitions';
import AtlasMap from './atlas-map-loader';
import { MemoryDrawer } from './memory-drawer';
import { MemoryTray } from './memory-tray';
import styles from './atlas.module.css';

type AtlasFilter = 'all' | JourneyState;

type AtlasWorkspaceProps = {
  displayName: string;
  initialData: AtlasData;
  initialSelectedId?: string | null;
};

export function AtlasWorkspace({
  displayName,
  initialData,
  initialSelectedId = null,
}: AtlasWorkspaceProps) {
  const [entries, setEntries] = useState(initialData.entries);
  const [selectedId, setSelectedId] = useState<string | null>(
    initialSelectedId,
  );
  const [placementMode, setPlacementMode] = useState(false);
  const [placementBusy, setPlacementBusy] = useState(false);
  const [filter, setFilter] = useState<AtlasFilter>('all');
  const [query, setQuery] = useState('');
  const [trayOpen, setTrayOpen] = useState(false);
  const [fitRequest, setFitRequest] = useState(0);
  const [focusRequest, setFocusRequest] = useState({
    id: initialSelectedId,
    nonce: initialSelectedId ? 1 : 0,
  });
  const [notice, setNotice] = useState('');
  const viewTimerRef = useRef<number | null>(null);
  const latestViewRef = useRef<AtlasView>(initialData.view);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const visibleEntries = useMemo(() => {
    const search = query.trim().toLowerCase();
    return entries.filter((entry) => {
      const matchesFilter = filter === 'all' || entry.journeyState === filter;
      const matchesSearch =
        !search ||
        entry.title.toLowerCase().includes(search) ||
        entry.placeLabel.toLowerCase().includes(search) ||
        entry.description.toLowerCase().includes(search);
      return matchesFilter && matchesSearch;
    });
  }, [entries, filter, query]);

  const selectedEntry =
    entries.find((entry) => entry.id === selectedId) ?? null;
  const visitedCount = entries.filter(
    (entry) =>
      entry.recordState === 'saved' && entry.journeyState === 'visited',
  ).length;
  const futureCount = entries.filter(
    (entry) =>
      entry.recordState === 'saved' && entry.journeyState === 'want_to_visit',
  ).length;

  const selectEntry = useCallback((id: string) => {
    setSelectedId(id);
    setPlacementMode(false);
    setTrayOpen(false);
    setFocusRequest((current) => ({ id, nonce: current.nonce + 1 }));
  }, []);

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

      const result = await createAtlasDraftAction({
        clientRequestId,
        latitude,
        longitude,
      });

      setPlacementBusy(false);
      if (!result.ok) {
        setEntries((current) =>
          current.filter((entry) => entry.id !== optimisticId),
        );
        setNotice(result.message);
        return;
      }

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
    },
    [placementBusy],
  );

  const rememberView = useCallback((view: AtlasView) => {
    latestViewRef.current = view;
    if (viewTimerRef.current) window.clearTimeout(viewTimerRef.current);
    viewTimerRef.current = window.setTimeout(() => {
      void saveAtlasViewAction(latestViewRef.current);
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
        searchInputRef.current?.focus();
        return;
      }

      if (event.key === 'Escape') {
        if (document.activeElement === searchInputRef.current) {
          searchInputRef.current?.blur();
          setQuery('');
        } else if (selectedId) setSelectedId(null);
        else if (trayOpen) setTrayOpen(false);
        else setPlacementMode(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedId, trayOpen]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  return (
    <div className={`${styles.workspace} atlas-workspace-root`}>
      <AtlasMap
        entries={visibleEntries}
        initialView={initialData.view}
        selectedId={selectedId}
        placementMode={placementMode}
        focusRequest={focusRequest}
        fitRequest={fitRequest}
        onSelect={selectEntry}
        onPlace={(coordinates) => void placeEntry(coordinates)}
        onViewChange={rememberView}
      />

      <header className={styles.atlasHeader}>
        <div className={styles.atlasIdentity}>
          <p className={styles.eyebrow}>Private field atlas</p>
          <h1>{displayName}&rsquo;s world</h1>
          <div className={styles.atlasSummary} aria-label="Atlas summary">
            <span>{visitedCount} remembered</span>
            <i aria-hidden="true" />
            <span>{futureCount} ahead</span>
          </div>
        </div>

        <div
          className={styles.searchWrap}
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
            value={query}
            placeholder="Search your memories"
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
            >
              <XMarkIcon aria-hidden="true" />
            </button>
          ) : (
            <kbd>⌘ K</kbd>
          )}
          {query ? (
            <div className={styles.searchResults}>
              <p>
                {visibleEntries.length
                  ? `${visibleEntries.length} ${visibleEntries.length === 1 ? 'place' : 'places'} found`
                  : 'No memories found'}
              </p>
              {visibleEntries.slice(0, 5).map((entry) => (
                <button
                  type="button"
                  key={entry.id}
                  onClick={() => {
                    selectEntry(entry.id);
                    setQuery('');
                  }}
                >
                  <MapPinIcon aria-hidden="true" />
                  <span>
                    <strong>{entry.title || 'Untitled place'}</strong>
                    <small>{entry.placeLabel || 'Pinned place'}</small>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </header>

      <div className={styles.toolDock} aria-label="Atlas tools">
        <button
          type="button"
          className={styles.addButton}
          data-active={placementMode ? 'true' : 'false'}
          onClick={() => {
            setPlacementMode((current) => !current);
            setSelectedId(null);
            setTrayOpen(false);
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
        <button
          type="button"
          onClick={() => {
            setTrayOpen((current) => !current);
            setSelectedId(null);
          }}
          aria-label="Open memory list"
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
          <span>View all</span>
        </button>
      </div>

      <div className={styles.filterDock} aria-label="Filter memories">
        {(
          [
            ['all', 'All places'],
            ['visited', 'Remembered'],
            ['want_to_visit', 'Ahead'],
          ] as [AtlasFilter, string][]
        ).map(([value, label]) => (
          <button
            type="button"
            key={value}
            data-active={filter === value ? 'true' : 'false'}
            onClick={() => setFilter(value)}
          >
            <span aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      {placementMode ? (
        <div className={styles.placementPrompt} role="status">
          <span className={styles.pinPulse} aria-hidden="true" />
          <div>
            <strong>
              {placementBusy ? 'Placing your pin…' : 'Choose a place'}
            </strong>
            <p>
              Move through the atlas, then click exactly where the memory
              belongs.
            </p>
          </div>
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
          onClose={() => setTrayOpen(false)}
          onSelect={selectEntry}
        />
      ) : null}

      {selectedEntry ? (
        <MemoryDrawer
          key={selectedEntry.id}
          entry={selectedEntry}
          onClose={() => setSelectedId(null)}
          onUpdate={(updated) => {
            setEntries((current) =>
              current.map((entry) =>
                entry.id === updated.id ? updated : entry,
              ),
            );
          }}
          onArchive={(id) => {
            setEntries((current) => current.filter((entry) => entry.id !== id));
            setSelectedId(null);
            setNotice('Memory removed from your atlas.');
          }}
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
