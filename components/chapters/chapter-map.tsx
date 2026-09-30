'use client';

import { useEffect, useId, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type {
  ErrorEvent as MapLibreErrorEvent,
  GeoJSONSource,
  Map as MapLibreMap,
  Marker,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import {
  createGentleChapterRoute,
  unwrapChapterCoordinates,
} from '@/app/lib/chapters/route-geometry';
import {
  groupNearbyMapMarkers,
  type ProjectedMapMarker,
} from '@/app/lib/maps/marker-groups';
import { sanitizeOpenFreeMapStyle } from '@/app/lib/maps/openfreemap-style';
import styles from './chapters.module.css';

const DEFAULT_STYLE =
  process.env.NEXT_PUBLIC_ATLAS_STYLE_URL ??
  'https://tiles.openfreemap.org/styles/positron';
const CHAPTER_MARKER_GUTTER = 12;
const CHAPTER_MARKER_GROUP_DISTANCE_DESKTOP = 52;
const CHAPTER_MARKER_GROUP_DISTANCE_TABLET = 52;
// The marker control is 44px square. Requiring centers to be more than 44px
// apart preserves a visible gap between hit targets while keeping enough
// anchors to tell the story of a long route on a narrow phone map.
const CHAPTER_MARKER_GROUP_DISTANCE_PHONE = 48;
const MAP_LOAD_TIMEOUT_MS = 15_000;

maplibregl.setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');

export type ChapterMapMemory = {
  id: string;
  title: string;
  placeLabel: string;
  placeName: string | null;
  latitude: number;
  longitude: number;
  memoryNumber?: number;
  segmentId?: string | null;
  segmentTitle?: string | null;
};

type ChapterMarkerGroup = {
  representativeIndex: number;
  entryIndexes: number[];
};

type ChapterMarkerOffset = [x: number, y: number];

function routeData(entries: ChapterMapMemory[]) {
  const coordinates = createGentleChapterRoute(entries);
  return {
    type: 'FeatureCollection' as const,
    features:
      entries.length > 1
        ? [
            {
              type: 'Feature' as const,
              properties: {},
              geometry: {
                type: 'LineString' as const,
                coordinates,
              },
            },
          ]
        : [],
  };
}

function chapterMemoryNumber(entry: ChapterMapMemory, index: number) {
  return entry.memoryNumber ?? index + 1;
}

function stopNumberRanges(stopNumbers: number[]) {
  const ranges: string[] = [];
  let rangeStart = stopNumbers[0];
  let rangeEnd = rangeStart;

  stopNumbers.slice(1).forEach((stopNumber) => {
    if (stopNumber === rangeEnd + 1) {
      rangeEnd = stopNumber;
      return;
    }
    ranges.push(
      rangeStart === rangeEnd
        ? String(rangeStart)
        : `${rangeStart}–${rangeEnd}`,
    );
    rangeStart = stopNumber;
    rangeEnd = stopNumber;
  });
  ranges.push(
    rangeStart === rangeEnd ? String(rangeStart) : `${rangeStart}–${rangeEnd}`,
  );
  return ranges.join(', ');
}

function groupStopNumbers(entries: ChapterMapMemory[], entryIndexes: number[]) {
  return entryIndexes.map((index) =>
    chapterMemoryNumber(entries[index], index),
  );
}

export function formatChapterMapSegmentTitle(title: string | null | undefined) {
  const trimmedTitle = title?.trim();
  if (!trimmedTitle) return null;
  return trimmedTitle.endsWith(':') ? trimmedTitle : `${trimmedTitle}:`;
}

function chapterMapSegmentKey(entry: ChapterMapMemory | undefined) {
  const title = formatChapterMapSegmentTitle(entry?.segmentTitle);
  if (!title) return null;
  return entry?.segmentId ?? `title:${title}`;
}

export function startsChapterMapSegment(
  entries: readonly ChapterMapMemory[],
  index: number,
) {
  const segmentKey = chapterMapSegmentKey(entries[index]);
  return Boolean(
    segmentKey && segmentKey !== chapterMapSegmentKey(entries[index - 1]),
  );
}

function chapterMarkerGroupDistance(map: MapLibreMap) {
  const container = map.getContainer();
  const width =
    container.clientWidth || container.getBoundingClientRect().width;
  if (width <= 480) return CHAPTER_MARKER_GROUP_DISTANCE_PHONE;
  if (width <= 760) return CHAPTER_MARKER_GROUP_DISTANCE_TABLET;
  return CHAPTER_MARKER_GROUP_DISTANCE_DESKTOP;
}

function spatialExtremeFirstIndexes(points: readonly ProjectedMapMarker[]) {
  const indexes = points.map((_, index) => index);
  if (points.length < 2) return indexes;

  const xValues = points.map((point) => point.x);
  const yValues = points.map((point) => point.y);
  const xSpan = Math.max(...xValues) - Math.min(...xValues);
  const ySpan = Math.max(...yValues) - Math.min(...yValues);
  const values = xSpan >= ySpan ? xValues : yValues;
  let minimumIndex = 0;
  let maximumIndex = 0;

  values.forEach((value, index) => {
    if (value < values[minimumIndex]) minimumIndex = index;
    if (value > values[maximumIndex]) maximumIndex = index;
  });

  const prioritizedIndexes = [minimumIndex];
  if (maximumIndex !== minimumIndex) prioritizedIndexes.push(maximumIndex);
  indexes.forEach((index) => {
    if (index !== minimumIndex && index !== maximumIndex) {
      prioritizedIndexes.push(index);
    }
  });
  return prioritizedIndexes;
}

export function chapterMarkerGroups(
  map: MapLibreMap,
  entries: ChapterMapMemory[],
): ChapterMarkerGroup[] {
  const fallbackGroups = () =>
    entries.map((_, index) => ({
      representativeIndex: index,
      entryIndexes: [index],
    }));

  try {
    const coordinates = unwrapChapterCoordinates(entries);
    const points = coordinates.map((coordinate) => map.project(coordinate));
    if (
      points.some(
        (point) => !Number.isFinite(point.x) || !Number.isFinite(point.y),
      )
    ) {
      return fallbackGroups();
    }

    // Seed the grouping pass with the projected route's two spatial extremes.
    // That keeps a marker on both visible ends even for there-and-back routes
    // whose chronological first and last stops can occupy the same area.
    const prioritizedIndexes = spatialExtremeFirstIndexes(points);
    return groupNearbyMapMarkers(
      prioritizedIndexes.map((index) => points[index]),
      chapterMarkerGroupDistance(map),
    )
      .map((group) => ({
        representativeIndex: prioritizedIndexes[group[0]],
        entryIndexes: group
          .map((index) => prioritizedIndexes[index])
          .sort((first, second) => first - second),
      }))
      .sort((first, second) => first.entryIndexes[0] - second.entryIndexes[0]);
  } catch {
    // Projection can be briefly unavailable while MapLibre changes styles.
    // Individual markers are a safe fallback until the next camera settle.
    return fallbackGroups();
  }
}

function chapterMarkerGroupKey(groups: ChapterMarkerGroup[]) {
  return groups
    .map(
      ({ representativeIndex, entryIndexes }) =>
        `${representativeIndex}:${entryIndexes.join(',')}`,
    )
    .join('|');
}

function chapterMarkerKey(entryIndexes: number[]) {
  return entryIndexes.join(',');
}

function createChapterMarkers(
  map: MapLibreMap,
  entries: ChapterMapMemory[],
  groups: ChapterMarkerGroup[],
  detailsId: string,
  toggleGroup: (group: ChapterMarkerGroup) => void,
  dismissGroup: () => void,
) {
  const coordinates = unwrapChapterCoordinates(entries);
  return groups.map(({ representativeIndex, entryIndexes }) => {
    const element = document.createElement('button');
    const markerLabel = document.createElement('span');
    element.type = 'button';
    element.className = styles.chapterMapMarker;
    element.dataset.chapterMarker = 'true';
    element.dataset.cluster = entryIndexes.length > 1 ? 'true' : 'false';
    element.dataset.groupKey = chapterMarkerKey(entryIndexes);
    element.dataset.memoryCount = String(entryIndexes.length);
    element.dataset.stopIndexes = entryIndexes.join(',');
    const stopNumbers = groupStopNumbers(entries, entryIndexes);
    markerLabel.textContent =
      entryIndexes.length > 1
        ? `×${entryIndexes.length}`
        : String(stopNumbers[0]);
    element.append(markerLabel);
    element.setAttribute('aria-controls', detailsId);
    element.setAttribute('aria-expanded', 'false');
    if (entryIndexes.length === 1) {
      const index = entryIndexes[0];
      const entry = entries[index];
      element.setAttribute(
        'aria-label',
        `Stop ${chapterMemoryNumber(entry, index)}: ${entry.title || 'Untitled memory'}, ${
          entry.placeLabel || entry.placeName || 'Pinned place'
        }`,
      );
    } else {
      const label = `${entryIndexes.length} nearby memories: stops ${stopNumberRanges(stopNumbers)}. Open list.`;
      element.setAttribute('aria-label', label);
      element.title = `${entryIndexes.length} nearby memories`;
    }
    element.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleGroup({ representativeIndex, entryIndexes });
    });
    element.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      dismissGroup();
    });

    return new maplibregl.Marker({
      element,
      anchor: 'center',
      offset: [0, 0],
      subpixelPositioning: true,
    })
      .setLngLat(coordinates[representativeIndex])
      .addTo(map);
  });
}

export function keepMarkersInsideFrame(
  map: MapLibreMap,
  markers: Marker[],
  baseOffsets: readonly ChapterMarkerOffset[],
) {
  const frame = map.getContainer().getBoundingClientRect();

  markers.forEach((marker, index) => {
    const [baseX, baseY] = baseOffsets[index] ?? [0, 0];
    const currentOffset = marker.getOffset();
    const markerBounds = marker.getElement().getBoundingClientRect();
    // Normalize the measured bounds back to the marker's canonical offset
    // before calculating a new edge correction. setOffset() schedules its DOM
    // transform, so resetting and immediately re-reading the element can see
    // the previous frame and flip the correction to the opposite edge.
    const offsetDeltaX = baseX - currentOffset.x;
    const offsetDeltaY = baseY - currentOffset.y;
    const normalizedLeft = markerBounds.left + offsetDeltaX;
    const normalizedRight = markerBounds.right + offsetDeltaX;
    const normalizedTop = markerBounds.top + offsetDeltaY;
    const normalizedBottom = markerBounds.bottom + offsetDeltaY;
    let x = baseX;
    let y = baseY;

    if (normalizedLeft < frame.left + CHAPTER_MARKER_GUTTER) {
      x += frame.left + CHAPTER_MARKER_GUTTER - normalizedLeft;
    } else if (normalizedRight > frame.right - CHAPTER_MARKER_GUTTER) {
      x -= normalizedRight - (frame.right - CHAPTER_MARKER_GUTTER);
    }

    if (normalizedTop < frame.top + CHAPTER_MARKER_GUTTER) {
      y += frame.top + CHAPTER_MARKER_GUTTER - normalizedTop;
    } else if (normalizedBottom > frame.bottom - CHAPTER_MARKER_GUTTER) {
      y -= normalizedBottom - (frame.bottom - CHAPTER_MARKER_GUTTER);
    }

    if (x !== currentOffset.x || y !== currentOffset.y) {
      marker.setOffset([x, y]);
    }
  });
}

function fitChapter(
  map: MapLibreMap,
  entries: ChapterMapMemory[],
  animated = true,
) {
  if (!entries.length) return;
  const duration =
    !animated || window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 0
      : undefined;
  if (entries.length === 1) {
    map.easeTo({
      center: [entries[0].longitude, entries[0].latitude],
      zoom: 8,
      duration: duration ?? 700,
    });
    return;
  }

  const bounds = new maplibregl.LngLatBounds();
  createGentleChapterRoute(entries).forEach((coordinates) =>
    bounds.extend(coordinates),
  );
  const mapWidth = map.getContainer().clientWidth || window.innerWidth;
  map.fitBounds(bounds, {
    // Let the route use more of a narrow frame so distinct locations remain
    // legible. The containment pass still preserves a marker-sized edge gutter.
    padding: mapWidth <= 340 ? 48 : mapWidth < 680 ? 64 : 96,
    maxZoom: 8.5,
    duration: duration ?? 900,
  });
}

export function ChapterMap({ entries }: { entries: ChapterMapMemory[] }) {
  const detailsId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const markerBaseOffsetsRef = useRef<ChapterMarkerOffset[]>([]);
  const markerGroupKeyRef = useRef<string | null>(null);
  const refreshMarkersRef = useRef<((force?: boolean) => void) | null>(null);
  const activeMarkerGroupRef = useRef<ChapterMarkerGroup | null>(null);
  const entriesRef = useRef(entries);
  const [activeMarkerGroup, setActiveMarkerGroup] =
    useState<ChapterMarkerGroup | null>(null);
  const [mapFailed, setMapFailed] = useState(false);
  const [mapAttempt, setMapAttempt] = useState(0);

  useEffect(() => {
    const initialEntries = entriesRef.current;
    if (!containerRef.current || mapRef.current || !initialEntries.length) {
      return;
    }

    let map: MapLibreMap;
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        center: [initialEntries[0].longitude, initialEntries[0].latitude],
        zoom: 3,
        attributionControl: false,
        interactive: false,
        pitchWithRotate: false,
      });
    } catch (error) {
      console.error('Chapter map initialization failed:', error);
      const errorTimer = window.setTimeout(() => setMapFailed(true), 0);
      return () => window.clearTimeout(errorTimer);
    }
    mapRef.current = map;
    const loadTimer = window.setTimeout(() => {
      if (mapRef.current === map) setMapFailed(true);
    }, MAP_LOAD_TIMEOUT_MS);
    map.addControl(new maplibregl.AttributionControl({ compact: true }));

    const toggleMarkerGroup = (group: ChapterMarkerGroup) => {
      const nextKey = chapterMarkerKey(group.entryIndexes);
      const current = activeMarkerGroupRef.current;
      const nextGroup =
        current && chapterMarkerKey(current.entryIndexes) === nextKey
          ? null
          : group;
      activeMarkerGroupRef.current = nextGroup;
      setActiveMarkerGroup(nextGroup);
      if (nextGroup && window.innerHeight <= 480) {
        requestAnimationFrame(() => {
          containerRef.current?.scrollIntoView({
            behavior: 'auto',
            block: 'start',
          });
        });
      }
    };
    const dismissMarkerGroup = () => {
      activeMarkerGroupRef.current = null;
      setActiveMarkerGroup(null);
    };
    let markersReady = false;
    const refreshMarkers = (force = false) => {
      if (!markersReady) return;
      const currentEntries = entriesRef.current;
      const groups = chapterMarkerGroups(map, currentEntries);
      const groupKey = chapterMarkerGroupKey(groups);
      if (!force && groupKey === markerGroupKeyRef.current) return;

      const currentActiveKey = activeMarkerGroupRef.current
        ? chapterMarkerKey(activeMarkerGroupRef.current.entryIndexes)
        : null;
      const nextActiveGroup = currentActiveKey
        ? (groups.find(
            (group) =>
              chapterMarkerKey(group.entryIndexes) === currentActiveKey,
          ) ?? null)
        : null;
      const focusedMarkerKey = markersRef.current
        .find((marker) => marker.getElement() === document.activeElement)
        ?.getElement().dataset.groupKey;
      activeMarkerGroupRef.current = nextActiveGroup;
      setActiveMarkerGroup(nextActiveGroup);
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = createChapterMarkers(
        map,
        currentEntries,
        groups,
        detailsId,
        toggleMarkerGroup,
        dismissMarkerGroup,
      );
      markerBaseOffsetsRef.current = groups.map(() => [0, 0]);
      markerGroupKeyRef.current = groupKey;
      if (focusedMarkerKey) {
        requestAnimationFrame(() => {
          markersRef.current
            .find(
              (marker) =>
                marker.getElement().dataset.groupKey === focusedMarkerKey,
            )
            ?.getElement()
            .focus();
        });
      }
    };
    refreshMarkersRef.current = refreshMarkers;
    let containmentFrame: number | null = null;
    let containmentLayoutFrame: number | null = null;
    let containmentTimer: number | null = null;
    let resizeContainmentTimer: number | null = null;
    const containMarkers = () => {
      if (containmentFrame !== null) cancelAnimationFrame(containmentFrame);
      if (containmentLayoutFrame !== null) {
        cancelAnimationFrame(containmentLayoutFrame);
      }
      containmentFrame = requestAnimationFrame(() => {
        containmentLayoutFrame = requestAnimationFrame(() => {
          containmentFrame = null;
          containmentLayoutFrame = null;
          keepMarkersInsideFrame(
            map,
            markersRef.current,
            markerBaseOffsetsRef.current,
          );
        });
      });
    };
    let resizeFrame: number | null = null;
    const resizeObserver = new ResizeObserver(() => {
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        map.resize();
        // Camera fitting does not depend on style readiness. Keeping it behind
        // isStyleLoaded() can preserve a desktop transform while mobile tiles
        // reload, which makes the marker containment pass bake in a stale
        // horizontal correction.
        fitChapter(map, entriesRef.current, false);
        refreshMarkers();
        containMarkers();
        if (resizeContainmentTimer !== null) {
          window.clearTimeout(resizeContainmentTimer);
        }
        // MapLibre also observes its container. Its internal resize can settle
        // after this observer's frame, so recalculate once more from canonical
        // offsets after both observers have finished.
        resizeContainmentTimer = window.setTimeout(containMarkers, 160);
      });
    });
    resizeObserver.observe(containerRef.current);
    const handleMoveEnd = () => {
      refreshMarkers();
      containMarkers();
    };
    map.on('moveend', handleMoveEnd);
    map.once('idle', containMarkers);

    const handleLoad = () => {
      window.clearTimeout(loadTimer);
      try {
        const currentEntries = entriesRef.current;
        map.addSource('chapter-route', {
          type: 'geojson',
          data: routeData(currentEntries),
        });
        map.addLayer({
          id: 'chapter-route-shadow',
          type: 'line',
          source: 'chapter-route',
          paint: {
            'line-color': '#f8f5ed',
            'line-width': 8,
            'line-opacity': 0.9,
          },
          layout: { 'line-cap': 'round', 'line-join': 'round' },
        });
        map.addLayer({
          id: 'chapter-route-line',
          type: 'line',
          source: 'chapter-route',
          paint: {
            'line-color': '#b75d34',
            'line-width': 3,
            'line-opacity': 0.92,
            'line-dasharray': [1.2, 1.1],
          },
          layout: { 'line-cap': 'round', 'line-join': 'round' },
        });
        markersReady = true;
        fitChapter(map, currentEntries);
        refreshMarkers(true);
        containmentTimer = window.setTimeout(containMarkers, 1100);
        setMapFailed(false);
      } catch (error) {
        console.error('Chapter map setup failed:', error);
        setMapFailed(true);
      }
    };
    const handleError = (event: MapLibreErrorEvent) => {
      if (event?.error) console.error('Chapter map error:', event.error);
    };
    map.on('load', handleLoad);
    map.on('error', handleError);

    const cleanupMap = () => {
      window.clearTimeout(loadTimer);
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      if (containmentFrame !== null) cancelAnimationFrame(containmentFrame);
      if (containmentLayoutFrame !== null) {
        cancelAnimationFrame(containmentLayoutFrame);
      }
      if (containmentTimer !== null) window.clearTimeout(containmentTimer);
      if (resizeContainmentTimer !== null) {
        window.clearTimeout(resizeContainmentTimer);
      }
      resizeObserver.disconnect();
      map.off('load', handleLoad);
      map.off('error', handleError);
      map.off('moveend', handleMoveEnd);
      markersReady = false;
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      markerBaseOffsetsRef.current = [];
      markerGroupKeyRef.current = null;
      refreshMarkersRef.current = null;
      map.remove();
      mapRef.current = null;
    };

    try {
      map.setStyle(DEFAULT_STYLE, {
        transformStyle: sanitizeOpenFreeMapStyle,
      });
    } catch (error) {
      console.error('Chapter map initialization failed:', error);
      cleanupMap();
      const errorTimer = window.setTimeout(() => setMapFailed(true), 0);
      return () => window.clearTimeout(errorTimer);
    }

    return cleanupMap;
  }, [detailsId, mapAttempt]);

  useEffect(() => {
    entriesRef.current = entries;
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    (map.getSource('chapter-route') as GeoJSONSource | undefined)?.setData(
      routeData(entries),
    );
    fitChapter(map, entries);
    markerGroupKeyRef.current = null;
    refreshMarkersRef.current?.(true);
  }, [entries]);

  useEffect(() => {
    const activeKey = activeMarkerGroup
      ? chapterMarkerKey(activeMarkerGroup.entryIndexes)
      : null;
    markersRef.current.forEach((marker) => {
      marker
        .getElement()
        .setAttribute(
          'aria-expanded',
          marker.getElement().dataset.groupKey === activeKey ? 'true' : 'false',
        );
    });
  }, [activeMarkerGroup]);

  const activeEntries = (activeMarkerGroup?.entryIndexes ?? []).flatMap(
    (index) =>
      entries[index]
        ? [
            {
              entry: entries[index],
              index,
              memoryNumber: chapterMemoryNumber(entries[index], index),
            },
          ]
        : [],
  );
  const activeStopNumbers = activeEntries.map(
    ({ memoryNumber }) => memoryNumber,
  );
  const activeMemoryEntries = activeEntries.map(({ entry }) => entry);
  const closeMarkerDetails = (restoreFocus = false) => {
    const activeKey = activeMarkerGroup
      ? chapterMarkerKey(activeMarkerGroup.entryIndexes)
      : null;
    activeMarkerGroupRef.current = null;
    setActiveMarkerGroup(null);
    if (!restoreFocus || !activeKey) return;
    requestAnimationFrame(() => {
      const trigger = markersRef.current
        .map((marker) => marker.getElement())
        .find((element) => element.dataset.groupKey === activeKey);
      trigger?.focus();
    });
  };

  return (
    <div className={styles.chapterMapFrame}>
      <div
        ref={containerRef}
        className={styles.chapterMap}
        role="region"
        aria-label={`Map of ${entries.length} ordered journey memories`}
      />
      {activeMarkerGroup && activeEntries.length ? (
        <section
          id={detailsId}
          className={styles.chapterMapDetails}
          role="region"
          aria-label={
            activeEntries.length > 1
              ? `${activeEntries.length} memories in this map marker`
              : `Details for stop ${activeEntries[0].memoryNumber}`
          }
          data-chapter-map-details="true"
          onKeyDown={(event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            closeMarkerDetails(true);
          }}
        >
          <div className={styles.chapterMapDetailsHeader}>
            <div>
              <span>
                {activeEntries.length > 1
                  ? `${activeEntries.length} memories here`
                  : `Stop ${activeEntries[0].memoryNumber}`}
              </span>
              <strong>
                {activeEntries.length > 1
                  ? `Stops ${stopNumberRanges(activeStopNumbers)}`
                  : activeEntries[0].entry.title || 'Untitled memory'}
              </strong>
            </div>
            <button
              type="button"
              className={styles.chapterMapDetailsClose}
              aria-label="Close map memory details"
              onClick={() => closeMarkerDetails(true)}
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
          {activeEntries.length > 1 ? (
            <ol
              className={styles.chapterMapDetailsList}
              aria-label="Memories in this map marker"
              tabIndex={0}
            >
              {activeEntries.map(
                ({ entry, memoryNumber }, activeEntryIndex) => {
                  const segmentTitle = formatChapterMapSegmentTitle(
                    entry.segmentTitle,
                  );
                  return (
                    <li key={entry.id}>
                      {segmentTitle &&
                      startsChapterMapSegment(
                        activeMemoryEntries,
                        activeEntryIndex,
                      ) ? (
                        <h3
                          className={styles.chapterMapDetailsSegment}
                          data-chapter-map-segment-title="true"
                        >
                          {segmentTitle}
                        </h3>
                      ) : null}
                      <div
                        className={styles.chapterMapDetailsMemory}
                        data-memory-number={memoryNumber}
                      >
                        <span>{memoryNumber}.</span>
                        <span>{entry.title || 'Untitled memory'}</span>
                      </div>
                    </li>
                  );
                },
              )}
            </ol>
          ) : (
            <div className={styles.chapterMapDetailsSingle}>
              {formatChapterMapSegmentTitle(
                activeEntries[0].entry.segmentTitle,
              ) ? (
                <h3
                  className={styles.chapterMapDetailsSegment}
                  data-chapter-map-segment-title="true"
                >
                  {formatChapterMapSegmentTitle(
                    activeEntries[0].entry.segmentTitle,
                  )}
                </h3>
              ) : null}
              <p className={styles.chapterMapDetailsPlace}>
                {activeEntries[0].entry.placeLabel ||
                  activeEntries[0].entry.placeName ||
                  'Pinned place'}
              </p>
            </div>
          )}
        </section>
      ) : null}
      {mapFailed ? (
        <div
          className={`${styles.chapterMapDeferred} ${styles.chapterMapFailure}`}
          role="alert"
        >
          <div className={styles.chapterMapDeferredStatus}>
            <span aria-hidden="true" />
            <p>Route map unavailable</p>
            <button
              type="button"
              className={styles.chapterMapDeferredAction}
              onClick={() => {
                setMapFailed(false);
                setMapAttempt((attempt) => attempt + 1);
              }}
            >
              Try again
            </button>
          </div>
        </div>
      ) : (
        <p className={styles.chapterMapHint}>Fixed route view</p>
      )}
    </div>
  );
}
