'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl, {
  LngLatBounds,
  type GeoJSONSource,
  type Map as MapLibreMap,
  type MapLayerMouseEvent,
  type MapMouseEvent,
} from 'maplibre-gl';

import type { AtlasEntry, AtlasView } from '@/app/lib/atlas/definitions';
import {
  formatAtlasDate,
  getAtlasPlaceContextLabel,
} from '@/app/lib/atlas/place';
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

type AtlasTooltip =
  | {
      kind: 'entry';
      entryId: string;
      x: number;
      y: number;
      position: 'above' | 'below';
    }
  | {
      kind: 'cluster';
      count: number;
      x: number;
      y: number;
      position: 'above' | 'below';
    };

type AtlasMapProps = {
  entries: AtlasEntry[];
  initialView: AtlasView;
  interactionLocked: boolean;
  selectedId: string | null;
  placementMode: boolean;
  focusRequest: FocusRequest;
  fitRequest: number;
  onSelect: (id: string) => void;
  onPlace: (coordinates: { latitude: number; longitude: number }) => void;
  onViewChange: (view: AtlasView) => void;
};

const DEFAULT_STYLE = 'https://tiles.openfreemap.org/styles/positron';

// Keep place metadata out of the MapLibre update key. The React tooltip and
// drawer consume that metadata directly, so enrichment does not need to
// rebuild the map source or move the camera.
function mapDataKey(entries: AtlasEntry[]) {
  return JSON.stringify(
    entries.map((entry) => [
      entry.id,
      entry.latitude,
      entry.longitude,
      entry.title,
      entry.recordState,
      entry.journeyState,
    ]),
  );
}

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
  interactionLocked,
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
  const hoveredFeatureRef = useRef<string | number | null>(null);
  const pointerFrameRef = useRef<number | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [tooltip, setTooltip] = useState<AtlasTooltip | null>(null);
  const mapDataKeyValue = useMemo(() => mapDataKey(entries), [entries]);
  const renderedMapDataKeyRef = useRef<string | null>(null);

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
      bearing: 0,
      pitch: 0,
      minZoom: 1,
      maxZoom: 18,
      maxPitch: 0,
      attributionControl: false,
      cooperativeGestures: true,
      boxZoom: false,
      doubleClickZoom: false,
      dragPan: false,
      dragRotate: false,
      keyboard: false,
      pitchWithRotate: false,
      scrollZoom: { around: 'center' },
      touchPitch: false,
      touchZoomRotate: { around: 'center' },
      canvasContextAttributes: { antialias: true },
      fadeDuration: 180,
    });

    mapRef.current = map;
    map.touchZoomRotate.disableRotation();
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
      renderedMapDataKeyRef.current = mapDataKey(entriesRef.current);
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
      if (typeof id === 'string') {
        setTooltip(null);
        onSelectRef.current(id);
      }
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
      setTooltip(null);
      const zoom = await source.getClusterExpansionZoom(clusterId);
      map.easeTo({
        center: [coordinates[0], coordinates[1]],
        zoom,
        duration: 700,
        essential: true,
      });
    };

    const setHoveredFeature = (id: string | number | null) => {
      if (hoveredFeatureRef.current != null) {
        map.setFeatureState(
          { source: ATLAS_SOURCE_ID, id: hoveredFeatureRef.current },
          { hover: false },
        );
      }

      hoveredFeatureRef.current = id;
      if (id != null) {
        map.setFeatureState({ source: ATLAS_SOURCE_ID, id }, { hover: true });
      }
    };

    const tooltipPosition = (event: MapLayerMouseEvent) => {
      const width = containerRef.current?.clientWidth ?? 0;
      return {
        x: Math.min(Math.max(event.point.x, 132), Math.max(width - 132, 132)),
        y: event.point.y,
        position: event.point.y < 225 ? ('below' as const) : ('above' as const),
      };
    };

    const showPinTooltip = (event: MapLayerMouseEvent) => {
      if (placementRef.current) return;
      const feature = event.features?.[0];
      const entryId = feature?.properties?.id;
      if (typeof entryId !== 'string') return;

      setTooltip({ kind: 'entry', entryId, ...tooltipPosition(event) });
    };

    const handlePinEnter = (event: MapLayerMouseEvent) => {
      if (placementRef.current) return;
      map.getCanvas().style.cursor = 'pointer';
      setHoveredFeature(event.features?.[0]?.id ?? null);
      showPinTooltip(event);
    };

    const handlePinLeave = () => {
      setHoveredFeature(null);
      setTooltip(null);
      map.getCanvas().style.cursor = placementRef.current ? 'crosshair' : '';
    };

    const showClusterTooltip = (event: MapLayerMouseEvent) => {
      if (placementRef.current) return;
      const feature = event.features?.[0];
      const count = Number(feature?.properties?.point_count);
      if (!Number.isFinite(count)) return;

      setTooltip({ kind: 'cluster', count, ...tooltipPosition(event) });
    };

    const handleClusterEnter = (event: MapLayerMouseEvent) => {
      if (placementRef.current) return;
      map.getCanvas().style.cursor = 'pointer';
      setHoveredFeature(
        event.features?.[0]?.id ??
          event.features?.[0]?.properties?.cluster_id ??
          null,
      );
      showClusterTooltip(event);
    };

    const handleClusterLeave = () => {
      setHoveredFeature(null);
      setTooltip(null);
      map.getCanvas().style.cursor = placementRef.current ? 'crosshair' : '';
    };

    map.on('load', handleLoad);
    map.on('error', handleError);
    map.on('moveend', handleMoveEnd);
    map.on('click', handleMapClick);
    map.on('click', ATLAS_PIN_LAYER, handlePinClick);
    map.on('click', ATLAS_CLUSTER_LAYER, handleClusterClick);
    map.on('mouseenter', ATLAS_PIN_LAYER, handlePinEnter);
    map.on('mousemove', ATLAS_PIN_LAYER, showPinTooltip);
    map.on('mouseleave', ATLAS_PIN_LAYER, handlePinLeave);
    map.on('mouseenter', ATLAS_CLUSTER_LAYER, handleClusterEnter);
    map.on('mousemove', ATLAS_CLUSTER_LAYER, showClusterTooltip);
    map.on('mouseleave', ATLAS_CLUSTER_LAYER, handleClusterLeave);
    map.on('movestart', () => setTooltip(null));

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
    if (renderedMapDataKeyRef.current === mapDataKeyValue) return;

    updateAtlasSource(map, entries);
    renderedMapDataKeyRef.current = mapDataKeyValue;
  }, [entries, mapDataKeyValue, mapLoaded]);

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
  }, [selectedId, mapDataKeyValue, mapLoaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.getCanvas().style.cursor = placementMode ? 'crosshair' : '';
    if (placementMode) {
      if (hoveredFeatureRef.current != null) {
        map.setFeatureState(
          { source: ATLAS_SOURCE_ID, id: hoveredFeatureRef.current },
          { hover: false },
        );
        hoveredFeatureRef.current = null;
      }
    }
  }, [placementMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || !focusRequest.id) return;
    const entry = entriesRef.current.find(
      (candidate) => candidate.id === focusRequest.id,
    );
    if (!entry) return;

    map.easeTo({
      center: [entry.longitude, entry.latitude],
      zoom: Math.max(map.getZoom(), 7),
      padding: { top: 90, right: 360, bottom: 80, left: 80 },
      duration: 950,
      essential: true,
    });
  }, [focusRequest, mapLoaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || fitRequest === 0) return;
    fitEntries(map, entriesRef.current);
  }, [fitRequest, mapLoaded]);

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

  const visibleTooltip = placementMode ? null : tooltip;
  const tooltipEntry =
    visibleTooltip?.kind === 'entry'
      ? entries.find((entry) => entry.id === visibleTooltip.entryId)
      : null;

  return (
    <div
      className={styles.mapFrame}
      data-placement={placementMode ? 'true' : 'false'}
      inert={interactionLocked ? true : undefined}
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
      {placementMode ? (
        <span className={styles.placementCenter} aria-hidden="true">
          <i />
        </span>
      ) : null}
      {visibleTooltip && (visibleTooltip.kind === 'cluster' || tooltipEntry) ? (
        <div
          className={styles.mapTooltip}
          data-position={visibleTooltip.position}
          role="tooltip"
          style={{ left: visibleTooltip.x, top: visibleTooltip.y }}
        >
          {visibleTooltip.kind === 'cluster' ? (
            <>
              <span className={styles.mapTooltipKicker}>Atlas cluster</span>
              <strong>
                {visibleTooltip.count}{' '}
                {visibleTooltip.count === 1 ? 'place' : 'places'} nearby
              </strong>
              <p>Click to move closer.</p>
            </>
          ) : tooltipEntry ? (
            <>
              <span className={styles.mapTooltipKicker}>
                {tooltipEntry.recordState === 'draft'
                  ? 'Unfinished draft'
                  : tooltipEntry.journeyState === 'visited'
                    ? 'Remembered place'
                    : 'Journey ahead'}
              </span>
              <strong>{tooltipEntry.title || 'Untitled place'}</strong>
              <p>{getAtlasPlaceContextLabel(tooltipEntry)}</p>
              <small>
                {tooltipEntry.recordState === 'draft'
                  ? 'Open and finish memory'
                  : `${formatAtlasDate(tooltipEntry)} · Open memory`}
              </small>
            </>
          ) : null}
        </div>
      ) : null}
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
