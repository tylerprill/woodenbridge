'use client';

import { useEffect, useRef } from 'react';
import maplibregl, {
  type GeoJSONSource,
  type Map as MapLibreMap,
} from 'maplibre-gl';

import type { AtlasEntry } from '@/app/lib/atlas/definitions';
import {
  createGentleChapterRoute,
  unwrapChapterCoordinates,
} from '@/app/lib/chapters/route-geometry';
import styles from './chapters.module.css';

const DEFAULT_STYLE =
  process.env.NEXT_PUBLIC_ATLAS_STYLE_URL ??
  'https://tiles.openfreemap.org/styles/positron';

function routeData(entries: AtlasEntry[]) {
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

function pointData(entries: AtlasEntry[]) {
  const coordinates = unwrapChapterCoordinates(entries);
  return {
    type: 'FeatureCollection' as const,
    features: entries.map((entry, index) => ({
      type: 'Feature' as const,
      properties: {
        order: String(index + 1),
        title: entry.title || 'Untitled memory',
        place: entry.placeLabel || entry.placeName || 'Pinned place',
      },
      geometry: {
        type: 'Point' as const,
        coordinates: coordinates[index],
      },
    })),
  };
}

function fitChapter(map: MapLibreMap, entries: AtlasEntry[]) {
  if (!entries.length) return;
  if (entries.length === 1) {
    map.easeTo({
      center: [entries[0].longitude, entries[0].latitude],
      zoom: 8,
      duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 0
        : 700,
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
    duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 0
      : 900,
  });
}

export function ChapterMap({ entries }: { entries: AtlasEntry[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current || !entries.length) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: DEFAULT_STYLE,
      center: [entries[0].longitude, entries[0].latitude],
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

    map.on('load', () => {
      map.addSource('chapter-route', {
        type: 'geojson',
        data: routeData(entries),
      });
      map.addSource('chapter-points', {
        type: 'geojson',
        data: pointData(entries),
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
      map.addLayer({
        id: 'chapter-point-halos',
        type: 'circle',
        source: 'chapter-points',
        paint: {
          'circle-radius': 13,
          'circle-color': '#fbfaf5',
          'circle-stroke-color': '#0e2a22',
          'circle-stroke-width': 1,
          'circle-opacity': 0.96,
        },
      });
      map.addLayer({
        id: 'chapter-points',
        type: 'circle',
        source: 'chapter-points',
        paint: {
          'circle-radius': 9.5,
          'circle-color': '#0e2a22',
          'circle-stroke-color': '#fbfaf5',
          'circle-stroke-width': 1.5,
        },
      });
      map.addLayer({
        id: 'chapter-point-labels',
        type: 'symbol',
        source: 'chapter-points',
        layout: {
          'text-field': ['get', 'order'],
          'text-size': 11,
          'text-allow-overlap': true,
        },
        paint: { 'text-color': '#fbfaf5' },
      });
      fitChapter(map, entries);
    });

    map.on('mouseenter', 'chapter-points', (event) => {
      map.getCanvas().style.cursor = 'pointer';
      const feature = event.features?.[0];
      const coordinates =
        feature?.geometry.type === 'Point'
          ? (feature.geometry.coordinates.slice() as [number, number])
          : null;
      if (!feature || !coordinates) return;

      const content = document.createElement('div');
      const number = document.createElement('span');
      number.textContent = `Stop ${String(feature.properties?.order ?? '')}`;
      const title = document.createElement('strong');
      title.textContent = String(feature.properties?.title ?? 'Memory');
      const place = document.createElement('p');
      place.textContent = String(feature.properties?.place ?? '');
      content.append(number, title, place);
      popup.setLngLat(coordinates).setDOMContent(content).addTo(map);
    });
    map.on('mouseleave', 'chapter-points', () => {
      map.getCanvas().style.cursor = '';
      popup.remove();
    });

    return () => {
      popup.remove();
      map.remove();
      mapRef.current = null;
    };
  }, [entries]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    (map.getSource('chapter-route') as GeoJSONSource | undefined)?.setData(
      routeData(entries),
    );
    (map.getSource('chapter-points') as GeoJSONSource | undefined)?.setData(
      pointData(entries),
    );
    fitChapter(map, entries);
  }, [entries]);

  return (
    <div className={styles.chapterMapFrame}>
      <div
        ref={containerRef}
        className={styles.chapterMap}
        aria-label={`Map of ${entries.length} ordered chapter memories`}
      />
      <p className={styles.chapterMapHint}>Scroll + command to explore</p>
    </div>
  );
}
