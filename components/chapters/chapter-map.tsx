'use client';

import { useEffect, useRef } from 'react';
import maplibregl, {
  type GeoJSONSource,
  type Map as MapLibreMap,
  type Marker,
} from 'maplibre-gl';

import {
  createChapterMarkerOffsets,
  createGentleChapterRoute,
  unwrapChapterCoordinates,
} from '@/app/lib/chapters/route-geometry';
import styles from './chapters.module.css';

const DEFAULT_STYLE =
  process.env.NEXT_PUBLIC_ATLAS_STYLE_URL ??
  'https://tiles.openfreemap.org/styles/positron';

type ChapterMapMemory = {
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
    element.type = 'button';
    element.className = styles.chapterMapMarker;
    element.textContent = String(index + 1);
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
    padding: window.innerWidth < 680 ? 52 : 88,
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

  useEffect(() => {
    const initialEntries = entriesRef.current;
    if (!containerRef.current || mapRef.current || !initialEntries.length) {
      return;
    }

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: DEFAULT_STYLE,
      center: [initialEntries[0].longitude, initialEntries[0].latitude],
      zoom: 3,
      attributionControl: false,
      cooperativeGestures: true,
      pitchWithRotate: false,
    });
    mapRef.current = map;
    map.addControl(
      new maplibregl.NavigationControl({ showCompass: false }),
      'top-right',
    );
    map.addControl(new maplibregl.AttributionControl({ compact: true }));

    const popup = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 16,
      className: 'chapter-map-popup',
    });
    popupRef.current = popup;
    let resizeFrame: number | null = null;
    const resizeObserver = new ResizeObserver(() => {
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        map.resize();
        if (map.isStyleLoaded()) {
          fitChapter(map, entriesRef.current, false);
        }
      });
    });
    resizeObserver.observe(containerRef.current);

    map.on('load', () => {
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
    });

    return () => {
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      resizeObserver.disconnect();
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      popup.remove();
      popupRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

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
      <p className={styles.chapterMapHint}>Hold ⌘ / Ctrl to zoom</p>
    </div>
  );
}
