'use client';

import {
  ArrowsPointingOutIcon,
  Bars3BottomLeftIcon,
  BookOpenIcon,
  MagnifyingGlassIcon,
  MapPinIcon,
  PhotoIcon,
  PlusIcon,
  SparklesIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
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
import type {
  AtlasJourneyDetail,
  AtlasJourneyIndex,
  AtlasJourneySuggestion,
} from '@/app/lib/atlas/journeys/definitions';
import {
  getAtlasPlaceContextLabel,
  withAtlasPlaceContext,
} from '@/app/lib/atlas/place';
import AtlasMap from './atlas-map-loader';
import {
  atlasExperienceReducer,
  type AtlasExperience,
  type AtlasMode,
} from './atlas-experience-state';
import { AtlasJourneyBuilder } from './atlas-journey-builder';
import { AtlasJourneyPlayback } from './atlas-journey-playback';
import { AtlasJourneyTray } from './atlas-journey-tray';
import { MemoryDrawer } from './memory-drawer';
import { MemoryTray } from './memory-tray';
import styles from './atlas.module.css';

type AtlasFilter = 'all' | 'draft' | JourneyState;

type AtlasWorkspaceProps = {
  displayName: string;
  initialData: AtlasData;
  initialSelectedId?: string | null;
  initialMode?: AtlasMode;
  initialJourneyId?: string | null;
  initialJourneyStopId?: string | null;
};

type JourneyLoadState = 'idle' | 'loading' | 'ready' | 'error';

function initialAtlasExperience({
  mode,
  memoryId,
  journeyId,
  journeyStopId,
}: {
  mode: AtlasMode;
  memoryId: string | null;
  journeyId: string | null;
  journeyStopId: string | null;
}): AtlasExperience {
  if (mode === 'journeys') {
    return journeyId
      ? {
          mode: 'journeys',
          surface: 'detail',
          journeyId,
          stopId: journeyStopId,
        }
      : { mode: 'journeys', surface: 'overview' };
  }
  return memoryId
    ? { mode: 'places', surface: 'memory', entryId: memoryId }
    : { mode: 'places', surface: 'overview' };
}

function journeyDashboardHref(journeyId?: string, stopId?: string | null) {
  const query = new URLSearchParams({ view: 'journeys' });
  if (journeyId) query.set('journey', journeyId);
  if (journeyId && stopId) query.set('stop', stopId);
  return `/dashboard?${query.toString()}`;
}

function replaceJourneyDashboardLocation(
  journeyId: string,
  stopId?: string | null,
) {
  window.history.replaceState(
    window.history.state,
    '',
    journeyDashboardHref(journeyId, stopId),
  );
}

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
  initialMode = 'places',
  initialJourneyId = null,
  initialJourneyStopId = null,
}: AtlasWorkspaceProps) {
  const router = useRouter();
  const [experience, dispatchExperience] = useReducer(
    atlasExperienceReducer,
    {
      mode: initialMode,
      memoryId: initialSelectedId,
      journeyId: initialJourneyId,
      journeyStopId: initialJourneyStopId,
    },
    initialAtlasExperience,
  );
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
  const [journeyPanelOpen, setJourneyPanelOpen] = useState(
    initialMode === 'journeys',
  );
  const [journeyIndex, setJourneyIndex] = useState<AtlasJourneyIndex>({
    journeys: [],
    suggestions: [],
  });
  const [journeyLoadState, setJourneyLoadState] =
    useState<JourneyLoadState>('idle');
  const [journeyError, setJourneyError] = useState('');
  const [journeyDetails, setJourneyDetails] = useState<
    Record<string, AtlasJourneyDetail>
  >({});
  const [journeyDetailLoadingId, setJourneyDetailLoadingId] = useState<
    string | null
  >(null);
  const [journeyDetailError, setJourneyDetailError] = useState('');
  const [builderSuggestion, setBuilderSuggestion] =
    useState<AtlasJourneySuggestion | null>(null);
  const [builderListOpen, setBuilderListOpen] = useState(false);
  const [journeyFitRequest, setJourneyFitRequest] = useState(0);
  const [overlapJourneyIds, setOverlapJourneyIds] = useState<string[]>([]);
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
  const memoryListButtonRef = useRef<HTMLButtonElement>(null);
  const journeyListButtonRef = useRef<HTMLButtonElement>(null);
  const overlapChooserRef = useRef<HTMLElement>(null);
  const drawerReturnFocusRef = useRef<HTMLElement | null>(null);
  const resolvingPlaceIdsRef = useRef(new Set<string>());
  const loadedMediaIdsRef = useRef(new Set<string>());
  const loadingMediaIdsRef = useRef(new Set<string>());
  const journeyRequestRef = useRef(0);
  const attemptedJourneyDetailIdsRef = useRef(new Set<string>());
  const locationStateKey = JSON.stringify([
    initialMode,
    initialSelectedId,
    initialJourneyId,
    initialJourneyStopId,
  ]);
  const lastLocationStateKeyRef = useRef(locationStateKey);

  const mode = experience.mode;
  const journeyId =
    experience.mode === 'journeys' &&
    (experience.surface === 'detail' || experience.surface === 'playback')
      ? experience.journeyId
      : null;
  const selectedJourneyStopId =
    experience.mode === 'journeys' && experience.surface === 'detail'
      ? experience.stopId
      : experience.mode === 'journeys' &&
          experience.surface === 'playback' &&
          journeyDetails[experience.journeyId]
        ? (journeyDetails[experience.journeyId].stops[experience.stopIndex]
            ?.entryId ?? null)
        : null;
  const builderSelectedEntryIds =
    experience.mode === 'journeys' && experience.surface === 'builder'
      ? experience.selectedEntryIds
      : [];
  const buildingJourney =
    experience.mode === 'journeys' && experience.surface === 'builder';
  const playingJourney =
    experience.mode === 'journeys' && experience.surface === 'playback';

  useEffect(() => {
    if (lastLocationStateKeyRef.current === locationStateKey) return;
    lastLocationStateKeyRef.current = locationStateKey;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setQuery('');
      setActiveSearchIndex(-1);
      setOverlapJourneyIds([]);
      setBuilderSuggestion(null);
      setBuilderListOpen(false);
      if (initialMode === 'journeys') {
        setSelectedId(null);
        setPlacementMode(false);
        setTrayOpen(false);
        setJourneyPanelOpen(true);
        if (initialJourneyId) {
          dispatchExperience({
            type: 'select-journey',
            journeyId: initialJourneyId,
            stopId: initialJourneyStopId,
          });
          setJourneyLoadState('idle');
        } else {
          dispatchExperience({ type: 'switch-mode', mode: 'journeys' });
        }
        return;
      }

      setJourneyPanelOpen(false);
      setPlacementMode(false);
      setTrayOpen(false);
      setSelectedId(initialSelectedId);
      dispatchExperience(
        initialSelectedId
          ? { type: 'open-memory', entryId: initialSelectedId }
          : { type: 'switch-mode', mode: 'places' },
      );
    });
    return () => {
      active = false;
    };
  }, [
    initialJourneyId,
    initialJourneyStopId,
    initialMode,
    initialSelectedId,
    locationStateKey,
  ]);

  const closeSelectedEntry = useCallback(() => {
    const returnTarget = drawerReturnFocusRef.current;
    setDrawerDirty(false);
    setSelectedId(null);
    dispatchExperience({ type: 'show-overview' });
    if (initialSelectedId) router.replace('/dashboard', { scroll: false });
    requestAnimationFrame(() => {
      const focusTarget =
        returnTarget?.isConnected && !returnTarget.inert
          ? returnTarget
          : memoryListButtonRef.current;
      focusTarget?.focus();
      drawerReturnFocusRef.current = null;
    });
  }, [initialSelectedId, router]);

  const rememberDrawerOpener = useCallback(() => {
    const activeElement = document.activeElement;
    drawerReturnFocusRef.current =
      activeElement instanceof HTMLElement && activeElement !== document.body
        ? activeElement
        : memoryListButtonRef.current;
  }, []);

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
  const eligibleJourneyEntries = useMemo(
    () =>
      entries
        .filter(
          (entry) =>
            entry.recordState === 'saved' && entry.journeyState === 'visited',
        )
        .sort(
          (first, second) =>
            (first.visitedOn ?? '').localeCompare(second.visitedOn ?? '') ||
            first.createdAt.localeCompare(second.createdAt) ||
            first.id.localeCompare(second.id),
        ),
    [entries],
  );
  const visibleJourneys = useMemo(() => {
    const search = query.trim().toLowerCase();
    if (!search) return journeyIndex.journeys;
    return journeyIndex.journeys.filter(
      (journey) =>
        journey.title.toLowerCase().includes(search) ||
        journey.stops.some(
          (stop) =>
            stop.title.toLowerCase().includes(search) ||
            stop.placeLabel.toLowerCase().includes(search) ||
            stop.placeName?.toLowerCase().includes(search),
        ),
    );
  }, [journeyIndex.journeys, query]);
  const journeySearchResults = visibleJourneys.slice(0, 5);
  const selectedJourney =
    journeyIndex.journeys.find((journey) => journey.id === journeyId) ?? null;
  const currentJourneyDetail = journeyId
    ? (journeyDetails[journeyId] ?? null)
    : null;

  const loadJourneys = useCallback(async () => {
    const request = journeyRequestRef.current + 1;
    journeyRequestRef.current = request;
    setJourneyLoadState('loading');
    setJourneyError('');

    try {
      const params = new URLSearchParams({ suggestions: '1', limit: '100' });
      if (initialJourneyId) params.set('selected', initialJourneyId);
      const response = await fetch(`/api/atlas/journeys?${params.toString()}`, {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      const payload = (await response.json().catch(() => null)) as
        AtlasJourneyIndex | { message?: string } | null;

      if (!response.ok || !payload || !('journeys' in payload)) {
        throw new Error(
          payload && 'message' in payload && payload.message
            ? payload.message
            : 'Please try opening your journeys again.',
        );
      }
      if (journeyRequestRef.current !== request) return;
      setJourneyIndex(payload);
      setJourneyLoadState('ready');
    } catch (error) {
      if (journeyRequestRef.current !== request) return;
      console.error('Atlas journeys could not be opened:', error);
      setJourneyLoadState('error');
      setJourneyError(
        error instanceof Error
          ? error.message
          : 'Please try opening your journeys again.',
      );
    }
  }, [initialJourneyId]);

  const loadJourneyDetail = useCallback(async (id: string) => {
    attemptedJourneyDetailIdsRef.current.add(id);
    setJourneyDetailLoadingId(id);
    setJourneyDetailError('');
    try {
      const response = await fetch(`/api/atlas/journeys/${id}`, {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      const payload = (await response.json().catch(() => null)) as {
        journey?: AtlasJourneyDetail;
        message?: string;
      } | null;
      if (!response.ok || !payload?.journey) {
        throw new Error(
          payload?.message || 'Please try opening this journey again.',
        );
      }
      setJourneyDetails((current) => ({
        ...current,
        [id]: payload.journey as AtlasJourneyDetail,
      }));
    } catch (error) {
      console.error('Atlas journey playback could not be opened:', error);
      setJourneyDetailError(
        error instanceof Error
          ? error.message
          : 'Please try opening this journey again.',
      );
    } finally {
      setJourneyDetailLoadingId((current) => (current === id ? null : current));
    }
  }, []);

  useEffect(() => {
    if (mode !== 'journeys' || journeyLoadState !== 'idle') return;
    let active = true;
    queueMicrotask(() => {
      if (active) void loadJourneys();
    });
    return () => {
      active = false;
    };
  }, [journeyLoadState, loadJourneys, mode]);

  useEffect(() => {
    if (
      experience.mode !== 'journeys' ||
      experience.surface !== 'detail' ||
      journeyLoadState !== 'ready'
    ) {
      return;
    }
    const journey = journeyIndex.journeys.find(
      (candidate) => candidate.id === experience.journeyId,
    );
    const invalidJourney = !journey;
    const invalidStop =
      Boolean(experience.stopId) &&
      Boolean(
        journey &&
        !journey.stops.some((stop) => stop.entryId === experience.stopId),
      );
    if (!invalidJourney && !invalidStop) return;

    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      if (invalidJourney) {
        dispatchExperience({ type: 'show-overview' });
        setNotice('That journey is no longer available.');
        window.history.replaceState(
          window.history.state,
          '',
          journeyDashboardHref(),
        );
      } else {
        dispatchExperience({ type: 'select-journey-stop', stopId: null });
        setNotice('That memory is not part of this journey.');
        replaceJourneyDashboardLocation(experience.journeyId);
      }
    });
    return () => {
      active = false;
    };
  }, [experience, journeyIndex.journeys, journeyLoadState]);

  useEffect(() => {
    if (
      experience.mode !== 'journeys' ||
      experience.surface !== 'playback' ||
      journeyDetails[experience.journeyId] ||
      attemptedJourneyDetailIdsRef.current.has(experience.journeyId) ||
      journeyDetailLoadingId === experience.journeyId
    ) {
      return;
    }
    let active = true;
    const journeyToLoad = experience.journeyId;
    queueMicrotask(() => {
      if (active) void loadJourneyDetail(journeyToLoad);
    });
    return () => {
      active = false;
    };
  }, [experience, journeyDetailLoadingId, journeyDetails, loadJourneyDetail]);

  useEffect(() => {
    if (
      experience.mode !== 'journeys' ||
      experience.surface !== 'playback' ||
      !experience.playing
    ) {
      return;
    }
    const journey = journeyDetails[experience.journeyId];
    if (!journey) return;
    const timer = window.setTimeout(() => {
      if (experience.stopIndex >= journey.stops.length - 1) {
        dispatchExperience({ type: 'set-playback-playing', playing: false });
        return;
      }
      dispatchExperience({
        type: 'set-playback-stop',
        stopIndex: experience.stopIndex + 1,
        playing: true,
      });
      replaceJourneyDashboardLocation(
        experience.journeyId,
        journey.stops[experience.stopIndex + 1]?.entryId,
      );
    }, 5_500);
    return () => window.clearTimeout(timer);
  }, [experience, journeyDetails]);

  useEffect(() => {
    if (!playingJourney) return;
    const pauseWhenHidden = () => {
      if (document.hidden) {
        dispatchExperience({
          type: 'set-playback-playing',
          playing: false,
        });
      }
    };
    document.addEventListener('visibilitychange', pauseWhenHidden);
    return () =>
      document.removeEventListener('visibilitychange', pauseWhenHidden);
  }, [playingJourney]);

  useEffect(() => {
    if (experience.mode !== 'journeys' || experience.surface !== 'playback') {
      return;
    }
    const nextStop =
      journeyDetails[experience.journeyId]?.stops[experience.stopIndex + 1];
    if (!nextStop?.thumbnailUrl) return;
    const preview = new window.Image();
    preview.src = nextStop.thumbnailUrl;
  }, [experience, journeyDetails]);

  const switchMode = useCallback(
    (nextMode: AtlasMode) => {
      if (nextMode === mode) {
        if (nextMode === 'journeys') setJourneyPanelOpen(true);
        return;
      }
      if (drawerDirty) {
        setNotice('Save or discard your changes before changing Atlas views.');
        return;
      }

      setSelectedId(null);
      setPlacementMode(false);
      setTrayOpen(false);
      setJourneyPanelOpen(nextMode === 'journeys');
      setOverlapJourneyIds([]);
      setBuilderSuggestion(null);
      setBuilderListOpen(false);
      setQuery('');
      setActiveSearchIndex(-1);
      searchInputRef.current?.blur();
      dispatchExperience({ type: 'switch-mode', mode: nextMode });
      router.push(
        nextMode === 'journeys' ? journeyDashboardHref() : '/dashboard',
        { scroll: false },
      );
    },
    [drawerDirty, mode, router],
  );

  const showJourneyOverview = useCallback(() => {
    // The overview is applied locally now; its delayed route payload must not
    // overwrite a newer interaction such as starting the journey builder.
    lastLocationStateKeyRef.current = JSON.stringify([
      'journeys',
      null,
      null,
      null,
    ]);
    dispatchExperience({ type: 'show-overview' });
    setJourneyPanelOpen(true);
    setOverlapJourneyIds([]);
    setBuilderSuggestion(null);
    setBuilderListOpen(false);
    router.push(journeyDashboardHref(), { scroll: false });
  }, [router]);

  const closeJourneyPanel = useCallback(() => {
    if (playingJourney) {
      dispatchExperience({
        type: 'set-playback-playing',
        playing: false,
      });
    }
    setJourneyPanelOpen(false);
    requestAnimationFrame(() => journeyListButtonRef.current?.focus());
  }, [playingJourney]);

  const closeOverlapChooser = useCallback(() => {
    setOverlapJourneyIds([]);
    requestAnimationFrame(() => journeyListButtonRef.current?.focus());
  }, []);

  const selectJourney = useCallback(
    (id: string, stopId: string | null = null) => {
      dispatchExperience({ type: 'select-journey', journeyId: id, stopId });
      setJourneyPanelOpen(true);
      setOverlapJourneyIds([]);
      setJourneyFitRequest((current) => current + 1);
      router.push(journeyDashboardHref(id, stopId), { scroll: false });
    },
    [router],
  );

  const selectJourneyStop = useCallback(
    (stopId: string) => {
      if (!journeyId) return;
      if (experience.mode === 'journeys' && experience.surface === 'playback') {
        const stopIndex =
          journeyDetails[journeyId]?.stops.findIndex(
            (stop) => stop.entryId === stopId,
          ) ?? -1;
        if (stopIndex >= 0) {
          dispatchExperience({ type: 'set-playback-stop', stopIndex });
        }
      } else {
        dispatchExperience({ type: 'select-journey-stop', stopId });
      }
      replaceJourneyDashboardLocation(journeyId, stopId);
    },
    [experience, journeyDetails, journeyId],
  );

  const startJourneyBuilder = useCallback(
    (
      requestedIds: string[] = [],
      suggestion: AtlasJourneySuggestion | null = null,
    ) => {
      const eligibleIds = new Set(
        eligibleJourneyEntries.map((entry) => entry.id),
      );
      const selectedEntryIds = Array.from(new Set(requestedIds))
        .filter((id) => eligibleIds.has(id))
        .slice(0, 50);
      dispatchExperience({ type: 'start-builder', selectedEntryIds });
      setBuilderSuggestion(suggestion);
      setBuilderListOpen(false);
      setJourneyPanelOpen(true);
      setOverlapJourneyIds([]);
      setQuery('');
      setActiveSearchIndex(-1);
      searchInputRef.current?.blur();
    },
    [eligibleJourneyEntries],
  );

  const startJourneyPlayback = useCallback(
    (id: string) => {
      const currentStopId =
        experience.mode === 'journeys' && experience.surface === 'detail'
          ? experience.stopId
          : null;
      const journey = journeyIndex.journeys.find(
        (candidate) => candidate.id === id,
      );
      const requestedIndex = Math.max(
        0,
        journey?.stops.findIndex((stop) => stop.entryId === currentStopId) ?? 0,
      );
      dispatchExperience({
        type: 'start-playback',
        journeyId: id,
        stopIndex: requestedIndex,
      });
      setJourneyPanelOpen(true);
      setJourneyDetailError('');
      if (!journeyDetails[id]) void loadJourneyDetail(id);
      replaceJourneyDashboardLocation(
        id,
        journey?.stops[requestedIndex]?.entryId,
      );
    },
    [experience, journeyDetails, journeyIndex.journeys, loadJourneyDetail],
  );

  const moveJourneyPlayback = useCallback(
    (direction: -1 | 1) => {
      if (experience.mode !== 'journeys' || experience.surface !== 'playback') {
        return;
      }
      const journey = journeyDetails[experience.journeyId];
      if (!journey) return;
      const nextIndex = Math.min(
        journey.stops.length - 1,
        Math.max(0, experience.stopIndex + direction),
      );
      dispatchExperience({ type: 'set-playback-stop', stopIndex: nextIndex });
      replaceJourneyDashboardLocation(
        experience.journeyId,
        journey.stops[nextIndex]?.entryId,
      );
    },
    [experience, journeyDetails],
  );

  const toggleJourneyPlayback = useCallback(() => {
    if (experience.mode !== 'journeys' || experience.surface !== 'playback') {
      return;
    }
    const journey = journeyDetails[experience.journeyId];
    const atEnd =
      journey && experience.stopIndex >= Math.max(0, journey.stops.length - 1);
    if (!experience.playing && atEnd) {
      dispatchExperience({
        type: 'set-playback-stop',
        stopIndex: 0,
        playing: true,
      });
      replaceJourneyDashboardLocation(
        experience.journeyId,
        journey.stops[0]?.entryId,
      );
      return;
    }
    dispatchExperience({
      type: 'set-playback-playing',
      playing: !experience.playing,
    });
  }, [experience, journeyDetails]);

  const dismissJourneySuggestion = useCallback(
    async (suggestion: AtlasJourneySuggestion) => {
      setJourneyIndex((current) => ({
        ...current,
        suggestions: current.suggestions.filter(
          (candidate) => candidate.key !== suggestion.key,
        ),
      }));
      try {
        const response = await fetch(
          `/api/atlas/journeys/suggestions/${encodeURIComponent(suggestion.key)}/dismiss`,
          {
            method: 'POST',
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
          },
        );
        if (!response.ok) throw new Error('Suggestion dismissal failed.');
        setNotice('Journey suggestion dismissed.');
      } catch (error) {
        console.error(
          'Atlas journey suggestion could not be dismissed:',
          error,
        );
        setNotice('That suggestion could not be dismissed. Please try again.');
        setJourneyLoadState('idle');
      }
    },
    [],
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

      rememberDrawerOpener();
      setSelectedId(id);
      dispatchExperience({ type: 'open-memory', entryId: id });
      setPlacementMode(false);
      setTrayOpen(false);
      setFocusRequest((current) => ({ id, nonce: current.nonce + 1 }));
      enrichPlace(id);
      void loadEntryMedia(id);
    },
    [
      drawerDirty,
      enrichPlace,
      loadEntryMedia,
      rememberDrawerOpener,
      selectedId,
    ],
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
        rememberDrawerOpener();
        setEntries((current) => [
          result.data,
          ...current.filter((entry) => entry.id !== optimisticId),
        ]);
        setSelectedId(result.data.id);
        dispatchExperience({
          type: 'open-memory',
          entryId: result.data.id,
        });
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
    [placementBusy, rememberDrawerOpener],
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
        if (buildingJourney) {
          setBuilderListOpen(true);
          requestAnimationFrame(() =>
            document
              .getElementById('atlas-builder-memories')
              ?.focus({ preventScroll: true }),
          );
          return;
        }
        if (selectedId) {
          setNotice('Close the memory editor before searching your atlas.');
          return;
        }
        if (mode === 'places') setTrayOpen(false);
        searchInputRef.current?.focus();
        return;
      }

      if (event.key === 'Escape' && !event.defaultPrevented) {
        if (buildingJourney && builderListOpen) {
          setBuilderListOpen(false);
          requestAnimationFrame(() =>
            document
              .getElementById('atlas-builder-toggle')
              ?.focus({ preventScroll: true }),
          );
          return;
        }
        if (document.activeElement === searchInputRef.current) {
          searchInputRef.current?.blur();
          setQuery('');
          setActiveSearchIndex(-1);
          if (experience.mode === 'journeys') setJourneyPanelOpen(true);
        } else if (selectedId) return;
        else if (overlapJourneyIds.length) closeOverlapChooser();
        else if (experience.mode === 'journeys') {
          if (experience.surface === 'playback') {
            dispatchExperience({ type: 'exit-playback' });
            router.replace(journeyDashboardHref(experience.journeyId), {
              scroll: false,
            });
          } else if (experience.surface !== 'overview') {
            showJourneyOverview();
          } else {
            closeJourneyPanel();
          }
        } else if (trayOpen) {
          setTrayOpen(false);
          dispatchExperience({ type: 'show-overview' });
        } else {
          setPlacementMode(false);
          dispatchExperience({ type: 'show-overview' });
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    builderListOpen,
    buildingJourney,
    closeJourneyPanel,
    closeOverlapChooser,
    experience,
    mode,
    overlapJourneyIds.length,
    router,
    selectedId,
    showJourneyOverview,
    trayOpen,
  ]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(''), 4200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!overlapJourneyIds.length) return;
    const frame = requestAnimationFrame(() =>
      overlapChooserRef.current?.focus({ preventScroll: true }),
    );
    return () => cancelAnimationFrame(frame);
  }, [overlapJourneyIds.length]);

  const mapEntries = buildingJourney ? eligibleJourneyEntries : visibleEntries;
  const mapMode = buildingJourney ? 'places' : mode;
  const playbackStopIndex = playingJourney ? experience.stopIndex : null;

  return (
    <div
      className={`${styles.workspace} atlas-workspace-root`}
      data-placement={mode === 'places' && placementMode ? 'true' : 'false'}
      data-editor-open={selectedEntry ? 'true' : 'false'}
      data-atlas-mode={mode}
      data-atlas-surface={experience.surface}
      data-builder-list-open={builderListOpen ? 'true' : 'false'}
      data-journey-panel-open={
        mode === 'journeys' && journeyPanelOpen ? 'true' : 'false'
      }
    >
      <AtlasMap
        entries={mapEntries}
        initialView={initialData.view}
        interactionLocked={Boolean(selectedEntry)}
        selectedId={mode === 'places' ? selectedId : null}
        placementMode={mode === 'places' && placementMode}
        focusRequest={focusRequest}
        fitRequest={fitRequest}
        onSelect={(id) => {
          if (!buildingJourney) {
            selectEntry(id);
            return;
          }
          if (
            !builderSelectedEntryIds.includes(id) &&
            builderSelectedEntryIds.length >= 50
          ) {
            setNotice('A journey can include up to 50 memories.');
            return;
          }
          dispatchExperience({ type: 'toggle-builder-entry', entryId: id });
        }}
        onPlace={(coordinates) => void placeEntry(coordinates)}
        onViewChange={rememberView}
        mode={mapMode}
        builderActive={buildingJourney}
        journeys={visibleJourneys}
        selectedJourneyId={journeyId}
        selectedJourneyStopId={selectedJourneyStopId}
        journeyFitRequest={journeyFitRequest}
        journeyPlaybackIndex={playbackStopIndex}
        builderSelectedEntryIds={builderSelectedEntryIds}
        onJourneySelect={selectJourney}
        onJourneyOverlapSelect={setOverlapJourneyIds}
        onJourneyStopSelect={selectJourneyStop}
      />

      <header
        className={styles.atlasHeader}
        hidden={buildingJourney}
        inert={selectedEntry || buildingJourney ? true : undefined}
      >
        <div className={styles.atlasIdentity}>
          <p className={styles.eyebrow}>
            {mode === 'journeys' ? 'Journey lens' : 'Private field atlas'}
          </p>
          <h1>{displayName}&rsquo;s world</h1>
          <div className={styles.atlasSummary} aria-label="Atlas summary">
            {mode === 'journeys' ? (
              <>
                <span>
                  {journeyIndex.journeys.length}{' '}
                  {journeyIndex.journeys.length === 1 ? 'journey' : 'journeys'}
                </span>
                <i className={styles.atlasSummaryOptional} aria-hidden="true" />
                <span className={styles.atlasSummaryOptional}>
                  {journeyIndex.journeys.reduce(
                    (total, journey) => total + journey.memoryCount,
                    0,
                  )}{' '}
                  connected memories
                </span>
              </>
            ) : (
              <>
                <span>{counts.visited} remembered</span>
                {counts.drafts ? (
                  <>
                    <i aria-hidden="true" />
                    <span>
                      {counts.drafts} {counts.drafts === 1 ? 'draft' : 'drafts'}
                    </span>
                  </>
                ) : null}
                <i className={styles.atlasSummaryOptional} aria-hidden="true" />
                <span className={styles.atlasSummaryOptional}>
                  {counts.future} ahead
                </span>
              </>
            )}
          </div>
          <div
            className={styles.atlasModeSwitch}
            role="group"
            aria-label="Atlas view"
          >
            <button
              type="button"
              data-active={mode === 'places' ? 'true' : 'false'}
              aria-pressed={mode === 'places'}
              onClick={() => switchMode('places')}
            >
              <MapPinIcon aria-hidden="true" /> Places
            </button>
            <button
              type="button"
              data-active={mode === 'journeys' ? 'true' : 'false'}
              aria-pressed={mode === 'journeys'}
              onClick={() => switchMode('journeys')}
            >
              <SparklesIcon aria-hidden="true" /> Journeys
            </button>
          </div>
        </div>

        <div
          className={styles.searchWrap}
          data-expanded={query ? 'true' : 'false'}
          onClick={() => searchInputRef.current?.focus()}
        >
          <MagnifyingGlassIcon aria-hidden="true" />
          <label htmlFor="atlas-search" className="sr-only">
            {mode === 'journeys' ? 'Search your journeys' : 'Search your atlas'}
          </label>
          <input
            ref={searchInputRef}
            id="atlas-search"
            type="search"
            role="combobox"
            value={query}
            placeholder={
              mode === 'journeys'
                ? 'Search your journeys'
                : 'Search your memories'
            }
            autoComplete="off"
            enterKeyHint="search"
            spellCheck={false}
            aria-autocomplete="list"
            aria-haspopup="listbox"
            aria-controls="atlas-search-results"
            aria-expanded={Boolean(query)}
            aria-activedescendant={
              activeSearchIndex >= 0 &&
              activeSearchIndex <
                (mode === 'journeys'
                  ? journeySearchResults.length
                  : searchResults.length)
                ? `atlas-search-option-${
                    (mode === 'journeys'
                      ? journeySearchResults[activeSearchIndex]
                      : searchResults[activeSearchIndex]
                    ).id
                  }`
                : undefined
            }
            onFocus={() => {
              if (mode === 'places') setTrayOpen(false);
              else setJourneyPanelOpen(false);
            }}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveSearchIndex(-1);
            }}
            onKeyDown={(event) => {
              const results =
                mode === 'journeys' ? journeySearchResults : searchResults;
              if (!query || !results.length) return;

              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setActiveSearchIndex((current) =>
                  current >= results.length - 1 ? 0 : current + 1,
                );
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setActiveSearchIndex((current) =>
                  current <= 0 ? results.length - 1 : current - 1,
                );
              } else if (event.key === 'Enter') {
                event.preventDefault();
                const result =
                  activeSearchIndex >= 0 && activeSearchIndex < results.length
                    ? results[activeSearchIndex]
                    : results[0];
                if (mode === 'journeys') selectJourney(result.id);
                else selectEntry(result.id);
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
                {mode === 'journeys'
                  ? visibleJourneys.length
                    ? `${visibleJourneys.length} ${visibleJourneys.length === 1 ? 'journey' : 'journeys'} found`
                    : 'No matching journeys'
                  : visibleEntries.length
                    ? `${visibleEntries.length} ${visibleEntries.length === 1 ? 'place' : 'places'} found`
                    : 'No matching places'}
              </p>
              <div
                id="atlas-search-results"
                className={styles.searchOptions}
                role="listbox"
                aria-label={
                  mode === 'journeys'
                    ? 'Matching Atlas journeys'
                    : 'Matching Atlas places'
                }
              >
                {mode === 'journeys'
                  ? journeySearchResults.map((journey, index) => (
                      <button
                        type="button"
                        key={journey.id}
                        id={`atlas-search-option-${journey.id}`}
                        role="option"
                        aria-selected={activeSearchIndex === index}
                        data-active={
                          activeSearchIndex === index ? 'true' : 'false'
                        }
                        onMouseEnter={() => setActiveSearchIndex(index)}
                        onClick={() => {
                          selectJourney(journey.id);
                          setQuery('');
                          setActiveSearchIndex(-1);
                        }}
                      >
                        <BookOpenIcon aria-hidden="true" />
                        <span>
                          <strong>{journey.title}</strong>
                          <small>
                            {journey.memoryCount}{' '}
                            {journey.memoryCount === 1 ? 'memory' : 'memories'}
                          </small>
                        </span>
                      </button>
                    ))
                  : searchResults.map((entry, index) => (
                      <button
                        type="button"
                        key={entry.id}
                        id={`atlas-search-option-${entry.id}`}
                        role="option"
                        aria-selected={activeSearchIndex === index}
                        data-active={
                          activeSearchIndex === index ? 'true' : 'false'
                        }
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
        hidden={buildingJourney}
        role="toolbar"
        aria-label={mode === 'journeys' ? 'Journey tools' : 'Atlas tools'}
        inert={selectedEntry || buildingJourney ? true : undefined}
      >
        {mode === 'journeys' ? (
          <>
            <button
              type="button"
              className={styles.addButton}
              data-active={buildingJourney ? 'true' : 'false'}
              aria-pressed={buildingJourney}
              onClick={() =>
                buildingJourney ? showJourneyOverview() : startJourneyBuilder()
              }
            >
              {buildingJourney ? (
                <XMarkIcon aria-hidden="true" />
              ) : (
                <PlusIcon aria-hidden="true" />
              )}
              <span>{buildingJourney ? 'Cancel' : 'Create journey'}</span>
            </button>
            <span className={styles.toolDivider} aria-hidden="true" />
            <Link href="/dashboard/import" aria-label="Upload photos">
              <PhotoIcon aria-hidden="true" />
              <span>Upload</span>
            </Link>
            <button
              ref={journeyListButtonRef}
              type="button"
              onClick={() => {
                if (journeyPanelOpen && playingJourney) {
                  dispatchExperience({
                    type: 'set-playback-playing',
                    playing: false,
                  });
                }
                setJourneyPanelOpen((current) => !current);
              }}
              aria-label={
                journeyPanelOpen ? 'Close journey list' : 'Open journey list'
              }
              aria-expanded={journeyPanelOpen}
            >
              <Bars3BottomLeftIcon aria-hidden="true" />
              <span>Journeys</span>
            </button>
            <button
              type="button"
              className={styles.optionalTool}
              onClick={() => setJourneyFitRequest((current) => current + 1)}
              aria-label="Fit journeys on map"
            >
              <ArrowsPointingOutIcon aria-hidden="true" />
              <span>Fit paths</span>
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className={styles.addButton}
              data-active={placementMode ? 'true' : 'false'}
              aria-pressed={placementMode}
              aria-label={placementMode ? 'Cancel pin' : 'Add memory'}
              onClick={() => {
                setPlacementMode((current) => !current);
                dispatchExperience(
                  placementMode
                    ? { type: 'show-overview' }
                    : { type: 'start-placement' },
                );
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
            <Link href="/dashboard/import" aria-label="Upload photos">
              <PhotoIcon aria-hidden="true" />
              <span>Upload</span>
            </Link>
            <button
              ref={memoryListButtonRef}
              type="button"
              onClick={() => {
                setTrayOpen((current) => !current);
                dispatchExperience(
                  trayOpen
                    ? { type: 'show-overview' }
                    : { type: 'open-memory-list' },
                );
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
              className={styles.optionalTool}
              onClick={() => setFitRequest((current) => current + 1)}
              aria-label="Fit all memories on map"
            >
              <ArrowsPointingOutIcon aria-hidden="true" />
              <span>Fit pins</span>
            </button>
          </>
        )}
      </div>

      {mode === 'places' ? (
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
              data-filter={value}
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
      ) : null}

      {mode === 'places' && placementMode ? (
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

      {mode === 'places' && !entries.length && !placementMode ? (
        <section
          className={styles.emptyState}
          aria-labelledby="empty-atlas-title"
        >
          <span className={styles.emptyStateMark} aria-hidden="true" />
          <p className={styles.eyebrow}>The first page</p>
          <h2 id="empty-atlas-title">Your world is waiting.</h2>
          <p>
            Begin with the photographs already in your camera roll, or place a
            memory manually on the map.
          </p>
          <div className={styles.emptyStateActions}>
            <Link href="/dashboard/import">
              <PhotoIcon aria-hidden="true" /> Upload photos
            </Link>
            <button
              type="button"
              onClick={() => {
                setPlacementMode(true);
                dispatchExperience({ type: 'start-placement' });
              }}
            >
              <PlusIcon aria-hidden="true" /> Place manually
            </button>
          </div>
        </section>
      ) : null}

      {mode === 'places' && trayOpen ? (
        <MemoryTray
          entries={visibleEntries}
          hasAnyEntries={entries.length > 0}
          onClose={() => {
            setTrayOpen(false);
            dispatchExperience({ type: 'show-overview' });
          }}
          onSelect={selectEntry}
        />
      ) : null}

      {buildingJourney ? (
        <>
          <h1 className="sr-only">Build a journey in your Atlas</h1>
          <div className={styles.journeyBuilderMapTools}>
            <button
              type="button"
              onClick={() => setFitRequest((current) => current + 1)}
              aria-label="Fit memories on map"
            >
              <ArrowsPointingOutIcon aria-hidden="true" />
            </button>
            <p>Select map pins to add memories.</p>
          </div>
        </>
      ) : null}

      {mode === 'journeys' && journeyPanelOpen && buildingJourney ? (
        <AtlasJourneyBuilder
          entries={eligibleJourneyEntries}
          selectedEntryIds={builderSelectedEntryIds}
          suggestion={builderSuggestion}
          listOpen={builderListOpen}
          onListOpenChange={setBuilderListOpen}
          onToggle={(id) => {
            if (
              !builderSelectedEntryIds.includes(id) &&
              builderSelectedEntryIds.length >= 50
            ) {
              setNotice('A journey can include up to 50 memories.');
              return;
            }
            dispatchExperience({ type: 'toggle-builder-entry', entryId: id });
          }}
          onMove={(entryId, direction) =>
            dispatchExperience({
              type: 'move-builder-entry',
              entryId,
              direction,
            })
          }
          onCancel={showJourneyOverview}
        />
      ) : null}

      {mode === 'journeys' && journeyPanelOpen && playingJourney ? (
        <AtlasJourneyPlayback
          journey={currentJourneyDetail}
          stopIndex={experience.stopIndex}
          playing={experience.playing}
          loading={journeyDetailLoadingId === experience.journeyId}
          errorMessage={
            journeyDetailError || 'Please try opening this journey again.'
          }
          onPrevious={() => moveJourneyPlayback(-1)}
          onNext={() => moveJourneyPlayback(1)}
          onTogglePlaying={toggleJourneyPlayback}
          onExit={() => {
            dispatchExperience({ type: 'exit-playback' });
            router.replace(journeyDashboardHref(experience.journeyId), {
              scroll: false,
            });
          }}
          onRetry={() => void loadJourneyDetail(experience.journeyId)}
        />
      ) : null}

      {mode === 'journeys' &&
      journeyPanelOpen &&
      !buildingJourney &&
      !playingJourney ? (
        <AtlasJourneyTray
          journeys={visibleJourneys}
          suggestions={journeyIndex.suggestions}
          selectedJourney={selectedJourney}
          selectedStopId={selectedJourneyStopId}
          loadState={journeyLoadState}
          errorMessage={
            journeyError || 'Please try opening your journeys again.'
          }
          onClose={closeJourneyPanel}
          onRetry={() => void loadJourneys()}
          onSelectJourney={selectJourney}
          onSelectStop={selectJourneyStop}
          onShowOverview={showJourneyOverview}
          onStartBuilder={startJourneyBuilder}
          onStartPlayback={startJourneyPlayback}
          onReviewSuggestion={(suggestion) =>
            startJourneyBuilder(suggestion.entryIds, suggestion)
          }
          onDismissSuggestion={(suggestion) =>
            void dismissJourneySuggestion(suggestion)
          }
        />
      ) : null}

      {mode === 'journeys' && overlapJourneyIds.length ? (
        <section
          ref={overlapChooserRef}
          className={styles.journeyOverlapChooser}
          role="dialog"
          aria-modal="false"
          aria-labelledby="overlapping-journeys-title"
          tabIndex={-1}
        >
          <header>
            <div>
              <p className={styles.eyebrow}>Paths cross here</p>
              <h2 id="overlapping-journeys-title">Choose a journey</h2>
            </div>
            <button
              type="button"
              className={styles.iconButton}
              onClick={closeOverlapChooser}
              aria-label="Close journey chooser"
            >
              <XMarkIcon aria-hidden="true" />
            </button>
          </header>
          <div>
            {overlapJourneyIds.map((id) => {
              const journey = journeyIndex.journeys.find(
                (candidate) => candidate.id === id,
              );
              if (!journey) return null;
              return (
                <button
                  type="button"
                  key={journey.id}
                  onClick={() => selectJourney(journey.id)}
                >
                  <span>{journey.title}</span>
                  <small>{journey.memoryCount} memories</small>
                </button>
              );
            })}
          </div>
        </section>
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
        Only you can see the memories and journeys in this atlas.
      </p>
    </div>
  );
}
