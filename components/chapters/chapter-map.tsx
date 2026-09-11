'use client';

import { useEffect, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type {
  ErrorEvent as MapLibreErrorEvent,
  GeoJSONSource,
  Map as MapLibreMap,
  Marker,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import {
  createChapterMarkerOffsets,
  createGentleChapterRoute,
  unwrapChapterCoordinates,
} from '@/app/lib/chapters/route-geometry';
import styles from './chapters.module.css';

const DEFAULT_STYLE =
  process.env.NEXT_PUBLIC_ATLAS_STYLE_URL ??
  'https://tiles.openfreemap.org/styles/positron';
const CHAPTER_MARKER_GUTTER = 12;
const MAP_LOAD_TIMEOUT_MS = 15_000;

maplibregl.setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');

export type ChapterMapMemory = {
  id: string;
  title: string;
  placeLabel: string;
  placeName: string | null;
  latitude: number;
  longitude: number;
};

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

function markerPopupContent(entry: ChapterMapMemory, index: number) {
  const content = document.createElement('div');
  const number = document.createElement('span');
  number.textContent = `Stop ${index + 1}`;
  const title = document.createElement('strong');
  title.textContent = entry.title || 'Untitled memory';
  const place = document.createElement('p');
  place.textContent = entry.placeLabel || entry.placeName || 'Pinned place';
  content.append(number, title, place);
  return content;
}

function createChapterMarkers(
  map: MapLibreMap,
  entries: ChapterMapMemory[],
  popup: maplibregl.Popup,
) {
  const coordinates = unwrapChapterCoordinates(entries);
  const offsets = createChapterMarkerOffsets(entries);
  return entries.map((entry, index) => {
    const element = document.createElement('button');
    const markerLabel = document.createElement('span');
    element.type = 'button';
    element.className = styles.chapterMapMarker;
    markerLabel.textContent = String(index + 1);
    element.append(markerLabel);
    element.setAttribute(
      'aria-label',
      `Stop ${index + 1}: ${entry.title || 'Untitled memory'}, ${
        entry.placeLabel || entry.placeName || 'Pinned place'
      }`,
    );
    const showPopup = () =>
      popup
        .setLngLat(coordinates[index])
        .setDOMContent(markerPopupContent(entry, index))
        .addTo(map);
    const hidePopup = () => popup.remove();
    element.addEventListener('mouseenter', showPopup);
    element.addEventListener('mouseleave', hidePopup);
    element.addEventListener('focus', showPopup);
    element.addEventListener('blur', hidePopup);

    return new maplibregl.Marker({
      element,
      anchor: 'center',
      offset: offsets[index],
    })
      .setLngLat(coordinates[index])
      .addTo(map);
  });
}

export function keepMarkersInsideFrame(
  map: MapLibreMap,
  markers: Marker[],
  baseOffsets: ReturnType<typeof createChapterMarkerOffsets>,
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
  map.fitBounds(bounds, {
    // Mobile markers have a visual radius plus an offset from their route
    // coordinate. Give both room so the first and last stops stay in frame.
    padding: window.innerWidth < 680 ? 92 : 96,
    maxZoom: 8.5,
    duration: duration ?? 900,
  });
}

export function ChapterMap({ entries }: { entries: ChapterMapMemory[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const entriesRef = useRef(entries);
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
        style: DEFAULT_STYLE,
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

    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 16,
      className: 'chapter-map-popup',
    });
    popupRef.current = popup;
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
            createChapterMarkerOffsets(entriesRef.current),
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
    map.on('moveend', containMarkers);
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
        markersRef.current = createChapterMarkers(map, currentEntries, popup);
        fitChapter(map, currentEntries);
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

    return () => {
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
      map.off('moveend', containMarkers);
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      popup.remove();
      popupRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [mapAttempt]);

  useEffect(() => {
    entriesRef.current = entries;
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    (map.getSource('chapter-route') as GeoJSONSource | undefined)?.setData(
      routeData(entries),
    );
    markersRef.current.forEach((marker) => marker.remove());
    markersRef.current = popupRef.current
      ? createChapterMarkers(map, entries, popupRef.current)
      : [];
    fitChapter(map, entries);
  }, [entries]);

  return (
    <div className={styles.chapterMapFrame}>
      <div
        ref={containerRef}
        className={styles.chapterMap}
        role="region"
        aria-label={`Map of ${entries.length} ordered chapter memories`}
      />
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
