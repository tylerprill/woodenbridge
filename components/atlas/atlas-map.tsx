'use client';

import { useEffect, useRef, useState } from 'react';
import maplibregl, {
  LngLatBounds,
  type GeoJSONSource,
  type Map as MapLibreMap,
  type MapLayerMouseEvent,
  type MapMouseEvent,
} from 'maplibre-gl';

import type { AtlasEntry, AtlasView } from '@/app/lib/atlas/definitions';
import {
  ATLAS_CLUSTER_LAYER,
  ATLAS_PIN_LAYER,
  ATLAS_SOURCE_ID,
  addAtlasLayers,
  updateAtlasSource,
} from './atlas-layers';
import styles from './atlas.module.css';

type FocusRequest = {
  id: string | null;
  nonce: number;
};

type AtlasMapProps = {
  entries: AtlasEntry[];
  initialView: AtlasView;
  selectedId: string | null;
  placementMode: boolean;
  focusRequest: FocusRequest;
  fitRequest: number;
  onSelect: (id: string) => void;
  onPlace: (coordinates: { latitude: number; longitude: number }) => void;
  onViewChange: (view: AtlasView) => void;
};

const DEFAULT_STYLE = 'https://tiles.openfreemap.org/styles/positron';

function fitEntries(map: MapLibreMap, entries: AtlasEntry[]) {
  if (!entries.length) {
    map.easeTo({
      center: [-18, 22],
      zoom: 1.65,
      bearing: 0,
      pitch: 0,
      duration: 1100,
    });
    return;
  }

  if (entries.length === 1) {
    map.easeTo({
      center: [entries[0].longitude, entries[0].latitude],
      zoom: 6,
      duration: 1100,
      essential: true,
    });
    return;
  }

  const bounds = new LngLatBounds();
  entries.forEach((entry) => bounds.extend([entry.longitude, entry.latitude]));
  map.fitBounds(bounds, {
    padding: { top: 170, right: 120, bottom: 140, left: 120 },
    maxZoom: 8,
    duration: 1200,
    essential: true,
  });
}

export default function AtlasMap({
  entries,
  initialView,
  selectedId,
  placementMode,
  focusRequest,
  fitRequest,
  onSelect,
  onPlace,
  onViewChange,
}: AtlasMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const entriesRef = useRef(entries);
  const placementRef = useRef(placementMode);
  const onSelectRef = useRef(onSelect);
  const onPlaceRef = useRef(onPlace);
  const onViewChangeRef = useRef(onViewChange);
  const selectedRef = useRef<string | null>(null);
  const pointerFrameRef = useRef<number | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState(false);

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  useEffect(() => {
    placementRef.current = placementMode;
  }, [placementMode]);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    onPlaceRef.current = onPlace;
  }, [onPlace]);

  useEffect(() => {
    onViewChangeRef.current = onViewChange;
  }, [onViewChange]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: process.env.NEXT_PUBLIC_ATLAS_STYLE_URL || DEFAULT_STYLE,
      center: [initialView.longitude, initialView.latitude],
      zoom: initialView.zoom,
      bearing: initialView.bearing,
      pitch: initialView.pitch,
      minZoom: 1,
      maxZoom: 18,
      maxPitch: 65,
      attributionControl: false,
      cooperativeGestures: true,
      canvasContextAttributes: { antialias: true },
      fadeDuration: 180,
    });

    mapRef.current = map;
    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      'bottom-right',
    );
    map.addControl(
      new maplibregl.ScaleControl({ unit: 'imperial', maxWidth: 100 }),
      'bottom-left',
    );

    const handleLoad = () => {
      map.setProjection({ type: 'globe' });
      map.setSky({
        'sky-color': '#d8ded6',
        'horizon-color': '#f5f2e9',
        'fog-color': '#dfe5dc',
        'fog-ground-blend': 0.7,
        'horizon-fog-blend': 0.7,
        'sky-horizon-blend': 0.82,
        'atmosphere-blend': 0.82,
      });
      addAtlasLayers(map, entriesRef.current);
      setMapLoaded(true);
      setMapError(false);
    };

    const handleError = (event: ErrorEvent) => {
      if (event?.error) console.error('Atlas map error:', event.error);
      if (!map.isStyleLoaded()) setMapError(true);
    };

    const handleMoveEnd = () => {
      const center = map.getCenter();
      onViewChangeRef.current({
        latitude: center.lat,
        longitude: center.lng,
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
      });
    };

    const handleMapClick = (event: MapMouseEvent) => {
      if (!placementRef.current) return;
      onPlaceRef.current({
        latitude: event.lngLat.lat,
        longitude: event.lngLat.lng,
      });
    };

    const handlePinClick = (event: MapLayerMouseEvent) => {
      if (placementRef.current) return;
      const id = event.features?.[0]?.properties?.id;
      if (typeof id === 'string') onSelectRef.current(id);
    };

    const handleClusterClick = async (event: MapLayerMouseEvent) => {
      if (placementRef.current) return;
      const feature = event.features?.[0];
      const clusterId = feature?.properties?.cluster_id;
      const coordinates =
        feature?.geometry.type === 'Point'
          ? feature.geometry.coordinates
          : null;
      const source = map.getSource(ATLAS_SOURCE_ID) as
        GeoJSONSource | undefined;

      if (!source || typeof clusterId !== 'number' || !coordinates) return;
      const zoom = await source.getClusterExpansionZoom(clusterId);
      map.easeTo({
        center: [coordinates[0], coordinates[1]],
        zoom,
        duration: 700,
        essential: true,
      });
    };

    const setHover = (event: MapLayerMouseEvent, hover: boolean) => {
      if (placementRef.current) return;
      const id = event.features?.[0]?.id;
      map.getCanvas().style.cursor = hover ? 'pointer' : '';
      if (id != null) {
        map.setFeatureState({ source: ATLAS_SOURCE_ID, id }, { hover });
      }
    };

    map.on('load', handleLoad);
    map.on('error', handleError);
    map.on('moveend', handleMoveEnd);
    map.on('click', handleMapClick);
    map.on('click', ATLAS_PIN_LAYER, handlePinClick);
    map.on('click', ATLAS_CLUSTER_LAYER, handleClusterClick);
    map.on('mouseenter', ATLAS_PIN_LAYER, (event) => setHover(event, true));
    map.on('mouseleave', ATLAS_PIN_LAYER, (event) => setHover(event, false));
    map.on('mouseenter', ATLAS_CLUSTER_LAYER, () => {
      if (!placementRef.current) map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', ATLAS_CLUSTER_LAYER, () => {
      map.getCanvas().style.cursor = placementRef.current ? 'crosshair' : '';
    });

    return () => {
      if (pointerFrameRef.current)
        cancelAnimationFrame(pointerFrameRef.current);
      map.remove();
      mapRef.current = null;
    };
  }, [initialView]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;
    updateAtlasSource(map, entries);
  }, [entries, mapLoaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    if (selectedRef.current) {
      map.setFeatureState(
        { source: ATLAS_SOURCE_ID, id: selectedRef.current },
        { selected: false },
      );
    }

    selectedRef.current = selectedId;
    if (selectedId) {
      map.setFeatureState(
        { source: ATLAS_SOURCE_ID, id: selectedId },
        { selected: true },
      );
    }
  }, [selectedId, mapLoaded, entries]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getCanvas().style.cursor = placementMode ? 'crosshair' : '';
  }, [placementMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !focusRequest.id) return;
    const entry = entries.find((candidate) => candidate.id === focusRequest.id);
    if (!entry) return;

    map.easeTo({
      center: [entry.longitude, entry.latitude],
      zoom: Math.max(map.getZoom(), 7),
      padding: { top: 90, right: 360, bottom: 80, left: 80 },
      duration: 950,
      essential: true,
    });
  }, [focusRequest, entries, mapLoaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || fitRequest === 0) return;
    fitEntries(map, entries);
  }, [fitRequest, entries, mapLoaded]);

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch' || pointerFrameRef.current) return;
    const { clientX, clientY, currentTarget } = event;
    pointerFrameRef.current = requestAnimationFrame(() => {
      const bounds = currentTarget.getBoundingClientRect();
      currentTarget.style.setProperty(
        '--atlas-pointer-x',
        `${clientX - bounds.left}px`,
      );
      currentTarget.style.setProperty(
        '--atlas-pointer-y',
        `${clientY - bounds.top}px`,
      );
      pointerFrameRef.current = null;
    });
  };

  return (
    <div
      className={styles.mapFrame}
      data-placement={placementMode ? 'true' : 'false'}
      onPointerMove={handlePointerMove}
      onPointerLeave={(event) => {
        event.currentTarget.style.setProperty('--atlas-light-opacity', '0');
      }}
      onPointerEnter={(event) => {
        event.currentTarget.style.setProperty('--atlas-light-opacity', '1');
      }}
    >
      <div ref={containerRef} className={styles.mapCanvas} />
      <div className={styles.pointerLight} aria-hidden="true" />
      <div className={styles.mapGrain} aria-hidden="true" />
      {!mapLoaded && !mapError ? (
        <div className={styles.mapLoading} role="status">
          <span />
          <p>Opening your atlas…</p>
        </div>
      ) : null}
      {mapError ? (
        <div className={styles.mapError} role="alert">
          <strong>The map is taking the long way around.</strong>
          <span>Check your connection, then refresh the atlas.</span>
        </div>
      ) : null}
    </div>
  );
}
