'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import * as maplibregl from 'maplibre-gl';
import type {
  ErrorEvent as MapLibreErrorEvent,
  GeoJSONSource,
  Map as MapLibreMap,
  MapLayerMouseEvent,
  MapMouseEvent,
  Marker,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

import type { AtlasEntry, AtlasView } from '@/app/lib/atlas/definitions';
import type { AtlasJourneySummary } from '@/app/lib/atlas/journeys/definitions';
import {
  formatAtlasDate,
  getAtlasPlaceContextLabel,
} from '@/app/lib/atlas/place';
import {
  createChapterMarkerOffsets,
  createGentleChapterRoute,
  unwrapChapterCoordinates,
} from '@/app/lib/chapters/route-geometry';
import { sanitizeOpenFreeMapStyle } from '@/app/lib/maps/openfreemap-style';
import {
  ATLAS_JOURNEY_INTERACTIVE_LAYERS,
  ATLAS_JOURNEY_ROUTE_HIT_LAYER,
  addAtlasJourneyLayers,
  journeyIdsFromRenderedFeatures,
  setAtlasJourneyLayerVisibility,
  updateAtlasJourneySources,
} from './atlas-journey-layers';
import {
  ATLAS_CLUSTER_LAYER,
  ATLAS_PIN_LAYER,
  ATLAS_SOURCE_ID,
  addAtlasLayers,
  setAtlasLayerVisibility,
  updateAtlasSource,
} from './atlas-layers';
import {
  getAtlasFitPadding,
  getAtlasFocusPadding,
  getAtlasJourneyFocusPadding,
} from './atlas-map-camera';
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
    }
  | {
      kind: 'journey';
      journeyId: string;
      overlapCount: number;
      x: number;
      y: number;
      position: 'above' | 'below';
    };

export type AtlasMapMode = 'places' | 'journeys';

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
  mode?: AtlasMapMode;
  journeys?: AtlasJourneySummary[];
  selectedJourneyId?: string | null;
  selectedJourneyStopId?: string | null;
  journeyFitRequest?: number;
  journeyPlaybackIndex?: number | null;
  builderSelectedEntryIds?: string[];
  onJourneySelect?: (id: string) => void;
  onJourneyOverlapSelect?: (ids: string[]) => void;
  onJourneyStopSelect?: (entryId: string) => void;
};

const DEFAULT_STYLE = 'https://tiles.openfreemap.org/styles/positron';
const MAP_LOAD_TIMEOUT_MS = 15_000;
const EMPTY_MAP_PADDING = { top: 0, right: 0, bottom: 0, left: 0 } as const;

maplibregl.setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');

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

function journeyMapDataKey(
  journeys: AtlasJourneySummary[],
  selectedJourneyId: string | null,
  hoveredJourneyId: string | null,
  journeyPlaybackIndex: number | null,
) {
  return JSON.stringify([
    selectedJourneyId,
    hoveredJourneyId,
    journeyPlaybackIndex,
    journeys.map((journey) => [
      journey.id,
      journey.title,
      journey.drawable,
      journey.stops.map((stop) => [
        stop.entryId,
        stop.position,
        stop.latitude,
        stop.longitude,
        stop.title,
      ]),
    ]),
  ]);
}

function syncJourneyMarkerState(
  markers: Marker[],
  journey: AtlasJourneySummary,
  selectedStopId: string | null,
  playbackIndex: number | null,
) {
  const selectedStopIndex = selectedStopId
    ? journey.stops.findIndex((stop) => stop.entryId === selectedStopId)
    : -1;
  const currentIndex =
    selectedStopIndex >= 0 ? selectedStopIndex : playbackIndex;

  markers.forEach((marker, index) => {
    const element = marker.getElement();
    element.dataset.current = currentIndex === index ? 'true' : 'false';
    element.dataset.complete =
      playbackIndex != null && index < playbackIndex ? 'true' : 'false';
    if (currentIndex === index) {
      element.setAttribute('aria-current', 'step');
    } else {
      element.removeAttribute('aria-current');
    }
  });
}

function mapAnimationDuration(duration: number) {
  return typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ? 0
    : duration;
}

function prepareMapForBoundsFit(map: MapLibreMap) {
  map.stop();
  map.resize();

  const container = map.getContainer();
  const width = container.clientWidth;
  const height = container.clientHeight;
  if (width <= 2 || height <= 2) return null;

  // Point-focus transitions retain their padding in MapLibre's transform.
  // Bounds fitting adds its own one-shot padding to that retained value, so
  // clear the global inset first to avoid double-counting overlay space.
  map.setPadding(EMPTY_MAP_PADDING);
  return { width, height };
}

function fitJourneyStops(
  map: MapLibreMap,
  journeys: AtlasJourneySummary[],
  selectedJourneyId: string | null,
) {
  const selectedJourney = selectedJourneyId
    ? journeys.find((journey) => journey.id === selectedJourneyId)
    : null;
  const stops = selectedJourney
    ? selectedJourney.stops
    : journeys
        .filter((journey) => journey.drawable)
        .flatMap((journey) => journey.stops);
  if (!stops.length) return;

  const duration = mapAnimationDuration(950);
  if (stops.length === 1) {
    map.easeTo({
      center: [stops[0].longitude, stops[0].latitude],
      zoom: Math.max(map.getZoom(), 7),
      duration,
      essential: true,
    });
    return;
  }

  const bounds = new maplibregl.LngLatBounds();
  const coordinates = selectedJourney
    ? createGentleChapterRoute(selectedJourney.stops)
    : stops.map((stop) => [stop.longitude, stop.latitude] as [number, number]);
  coordinates.forEach((coordinate) => bounds.extend(coordinate));
  try {
    const canvas = prepareMapForBoundsFit(map);
    if (!canvas) return;
    map.fitBounds(bounds, {
      padding: getAtlasJourneyFocusPadding(canvas.width, canvas.height),
      maxZoom: 8.5,
      duration,
      essential: true,
    });
  } catch (error) {
    console.error('Atlas journey camera fit failed:', error);
  }
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

  const bounds = new maplibregl.LngLatBounds();
  entries.forEach((entry) => bounds.extend([entry.longitude, entry.latitude]));
  try {
    const canvas = prepareMapForBoundsFit(map);
    if (!canvas) return;
    map.fitBounds(bounds, {
      padding: getAtlasFitPadding(canvas.width, canvas.height),
      maxZoom: 8,
      duration: 1200,
      essential: true,
    });
  } catch (error) {
    // Camera fitting is presentation-only. A transient zero-size canvas or
    // browser-specific MapLibre error must never take down the import route.
    console.error('Atlas map camera fit failed:', error);
  }
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
  mode = 'places',
  journeys = [],
  selectedJourneyId = null,
  selectedJourneyStopId = null,
  journeyFitRequest = 0,
  journeyPlaybackIndex = null,
  builderSelectedEntryIds = [],
  onJourneySelect,
  onJourneyOverlapSelect,
  onJourneyStopSelect,
}: AtlasMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const initialViewRef = useRef(initialView);
  const entriesRef = useRef(entries);
  const journeysRef = useRef(journeys);
  const modeRef = useRef(mode);
  const placementRef = useRef(placementMode);
  const onSelectRef = useRef(onSelect);
  const onPlaceRef = useRef(onPlace);
  const onViewChangeRef = useRef(onViewChange);
  const onJourneySelectRef = useRef(onJourneySelect);
  const onJourneyOverlapSelectRef = useRef(onJourneyOverlapSelect);
  const onJourneyStopSelectRef = useRef(onJourneyStopSelect);
  const selectedRef = useRef<string | null>(null);
  const selectedJourneyRef = useRef<string | null>(selectedJourneyId);
  const selectedJourneyStopRef = useRef<string | null>(selectedJourneyStopId);
  const journeyPlaybackIndexRef = useRef<number | null>(journeyPlaybackIndex);
  const builderSelectedRef = useRef(new Set<string>());
  const journeyMarkersRef = useRef<Marker[]>([]);
  const hoveredFeatureRef = useRef<string | number | null>(null);
  const pointerFrameRef = useRef<number | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapError, setMapError] = useState(false);
  const [mapAttempt, setMapAttempt] = useState(0);
  const [tooltip, setTooltip] = useState<AtlasTooltip | null>(null);
  const [hoveredJourneyId, setHoveredJourneyId] = useState<string | null>(null);
  const mapDataKeyValue = useMemo(() => mapDataKey(entries), [entries]);
  const journeyMapDataKeyValue = useMemo(
    () =>
      journeyMapDataKey(
        journeys,
        selectedJourneyId,
        hoveredJourneyId,
        journeyPlaybackIndex,
      ),
    [hoveredJourneyId, journeyPlaybackIndex, journeys, selectedJourneyId],
  );
  const renderedMapDataKeyRef = useRef<string | null>(null);
  const renderedJourneyDataKeyRef = useRef<string | null>(null);

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  useEffect(() => {
    journeysRef.current = journeys;
  }, [journeys]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    selectedJourneyRef.current = selectedJourneyId;
  }, [selectedJourneyId]);

  useEffect(() => {
    selectedJourneyStopRef.current = selectedJourneyStopId;
  }, [selectedJourneyStopId]);

  useEffect(() => {
    journeyPlaybackIndexRef.current = journeyPlaybackIndex;
  }, [journeyPlaybackIndex]);

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
    onJourneySelectRef.current = onJourneySelect;
  }, [onJourneySelect]);

  useEffect(() => {
    onJourneyOverlapSelectRef.current = onJourneyOverlapSelect;
  }, [onJourneyOverlapSelect]);

  useEffect(() => {
    onJourneyStopSelectRef.current = onJourneyStopSelect;
  }, [onJourneyStopSelect]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const container = containerRef.current;
    const startingView = initialViewRef.current;
    const compactRenderer =
      container.clientWidth <= 760 ||
      (typeof window.matchMedia === 'function' &&
        window.matchMedia('(pointer: coarse)').matches);
    let map: MapLibreMap;
    try {
      map = new maplibregl.Map({
        container,
        center: [startingView.longitude, startingView.latitude],
        zoom: startingView.zoom,
        bearing: 0,
        pitch: 0,
        minZoom: 1,
        maxZoom: 18,
        maxPitch: 0,
        attributionControl: false,
        cooperativeGestures: true,
        boxZoom: true,
        doubleClickZoom: true,
        dragPan: true,
        dragRotate: false,
        keyboard: true,
        pitchWithRotate: false,
        scrollZoom: true,
        touchPitch: false,
        touchZoomRotate: true,
        canvasContextAttributes: { antialias: false },
        pixelRatio: Math.min(Math.max(window.devicePixelRatio || 1, 1), 2),
        fadeDuration: 180,
      });
    } catch (error) {
      console.error('Atlas map initialization failed:', error);
      const errorTimer = window.setTimeout(() => setMapError(true), 0);
      return () => window.clearTimeout(errorTimer);
    }

    mapRef.current = map;
    map.keyboard.disableRotation();
    map.touchZoomRotate.disableRotation();
    map.addControl(
      new maplibregl.AttributionControl({ compact: true }),
      'bottom-right',
    );
    map.addControl(
      new maplibregl.ScaleControl({ unit: 'imperial', maxWidth: 100 }),
      'bottom-left',
    );

    let resizeFrame: number | null = null;
    const scheduleResize = () => {
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = null;
        if (mapRef.current === map) map.resize();
      });
    };
    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(scheduleResize);
    resizeObserver?.observe(container);
    const visualViewport = window.visualViewport;
    window.addEventListener('resize', scheduleResize);
    window.addEventListener('orientationchange', scheduleResize);
    visualViewport?.addEventListener('resize', scheduleResize);
    scheduleResize();

    const loadTimer = window.setTimeout(() => {
      if (mapRef.current === map) setMapError(true);
    }, MAP_LOAD_TIMEOUT_MS);

    const handleLoad = () => {
      window.clearTimeout(loadTimer);
      scheduleResize();
      try {
        addAtlasLayers(map, entriesRef.current);
        addAtlasJourneyLayers(map, journeysRef.current, {
          selectedJourneyId: selectedJourneyRef.current,
        });
        const showingJourneys = modeRef.current === 'journeys';
        setAtlasLayerVisibility(map, !showingJourneys);
        setAtlasJourneyLayerVisibility(map, showingJourneys);
        renderedMapDataKeyRef.current = mapDataKey(entriesRef.current);
        renderedJourneyDataKeyRef.current = journeyMapDataKey(
          journeysRef.current,
          selectedJourneyRef.current,
          null,
          null,
        );
        setMapLoaded(true);
        setMapError(false);
      } catch (error) {
        console.error('Atlas map setup failed:', error);
        setMapError(true);
        return;
      }

      if (!compactRenderer) {
        try {
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
        } catch (error) {
          console.error('Atlas map visual enhancement failed:', error);
        }
      }
    };

    const handleError = (event: MapLibreErrorEvent) => {
      if (event?.error) console.error('Atlas map error:', event.error);
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
      if (modeRef.current !== 'places' || !placementRef.current) return;
      onPlaceRef.current({
        latitude: event.lngLat.lat,
        longitude: event.lngLat.lng,
      });
    };

    const handlePinClick = (event: MapLayerMouseEvent) => {
      if (modeRef.current !== 'places' || placementRef.current) return;
      const id = event.features?.[0]?.properties?.id;
      if (typeof id === 'string') {
        setTooltip(null);
        onSelectRef.current(id);
      }
    };

    const handleClusterClick = async (event: MapLayerMouseEvent) => {
      if (modeRef.current !== 'places' || placementRef.current) return;
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

    const journeyIdsAtPoint = (event: MapLayerMouseEvent) => {
      const radius = 12;
      const features = map.queryRenderedFeatures(
        [
          [event.point.x - radius, event.point.y - radius],
          [event.point.x + radius, event.point.y + radius],
        ],
        { layers: [...ATLAS_JOURNEY_INTERACTIVE_LAYERS] },
      );
      return journeyIdsFromRenderedFeatures(
        features,
        selectedJourneyRef.current,
      );
    };

    const handleJourneyClick = (event: MapLayerMouseEvent) => {
      if (modeRef.current !== 'journeys') return;
      const ids = journeyIdsAtPoint(event);
      if (!ids.length) return;
      setTooltip(null);
      if (ids.length > 1 && onJourneyOverlapSelectRef.current) {
        onJourneyOverlapSelectRef.current(ids);
        return;
      }
      onJourneySelectRef.current?.(ids[0]);
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
      if (modeRef.current !== 'places' || placementRef.current) return;
      const feature = event.features?.[0];
      const entryId = feature?.properties?.id;
      if (typeof entryId !== 'string') return;

      setTooltip({ kind: 'entry', entryId, ...tooltipPosition(event) });
    };

    const handlePinEnter = (event: MapLayerMouseEvent) => {
      if (modeRef.current !== 'places' || placementRef.current) return;
      map.getCanvas().style.cursor = 'pointer';
      setHoveredFeature(event.features?.[0]?.id ?? null);
      showPinTooltip(event);
    };

    const handlePinLeave = () => {
      setHoveredFeature(null);
      setTooltip(null);
      map.getCanvas().style.cursor =
        placementRef.current && modeRef.current === 'places' ? 'crosshair' : '';
    };

    const showClusterTooltip = (event: MapLayerMouseEvent) => {
      if (modeRef.current !== 'places' || placementRef.current) return;
      const feature = event.features?.[0];
      const count = Number(feature?.properties?.point_count);
      if (!Number.isFinite(count)) return;

      setTooltip({ kind: 'cluster', count, ...tooltipPosition(event) });
    };

    const handleClusterEnter = (event: MapLayerMouseEvent) => {
      if (modeRef.current !== 'places' || placementRef.current) return;
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
      map.getCanvas().style.cursor =
        placementRef.current && modeRef.current === 'places' ? 'crosshair' : '';
    };

    const showJourneyTooltip = (event: MapLayerMouseEvent) => {
      if (modeRef.current !== 'journeys') return;
      const ids = journeyIdsAtPoint(event);
      const journeyId = ids[0];
      if (!journeyId) return;
      setHoveredJourneyId(journeyId);
      setTooltip({
        kind: 'journey',
        journeyId,
        overlapCount: ids.length,
        ...tooltipPosition(event),
      });
    };

    const handleJourneyEnter = (event: MapLayerMouseEvent) => {
      if (modeRef.current !== 'journeys') return;
      map.getCanvas().style.cursor = 'pointer';
      showJourneyTooltip(event);
    };

    const handleJourneyLeave = () => {
      setHoveredJourneyId(null);
      setTooltip(null);
      map.getCanvas().style.cursor =
        placementRef.current && modeRef.current === 'places' ? 'crosshair' : '';
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
    map.on('click', ATLAS_JOURNEY_ROUTE_HIT_LAYER, handleJourneyClick);
    map.on('mouseenter', ATLAS_JOURNEY_ROUTE_HIT_LAYER, handleJourneyEnter);
    map.on('mousemove', ATLAS_JOURNEY_ROUTE_HIT_LAYER, showJourneyTooltip);
    map.on('mouseleave', ATLAS_JOURNEY_ROUTE_HIT_LAYER, handleJourneyLeave);
    map.on('movestart', () => setTooltip(null));

    const cleanupMap = () => {
      window.clearTimeout(loadTimer);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', scheduleResize);
      window.removeEventListener('orientationchange', scheduleResize);
      visualViewport?.removeEventListener('resize', scheduleResize);
      if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
      if (pointerFrameRef.current !== null)
        cancelAnimationFrame(pointerFrameRef.current);
      journeyMarkersRef.current.forEach((marker) => marker.remove());
      journeyMarkersRef.current = [];
      map.remove();
      mapRef.current = null;
    };

    try {
      map.setStyle(process.env.NEXT_PUBLIC_ATLAS_STYLE_URL || DEFAULT_STYLE, {
        transformStyle: sanitizeOpenFreeMapStyle,
      });
    } catch (error) {
      console.error('Atlas map initialization failed:', error);
      cleanupMap();
      const errorTimer = window.setTimeout(() => setMapError(true), 0);
      return () => window.clearTimeout(errorTimer);
    }

    return cleanupMap;
  }, [mapAttempt]);

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
    if (renderedJourneyDataKeyRef.current === journeyMapDataKeyValue) return;

    updateAtlasJourneySources(map, journeys, {
      selectedJourneyId,
      hoveredJourneyId,
      playbackStopIndex: journeyPlaybackIndex,
    });
    renderedJourneyDataKeyRef.current = journeyMapDataKeyValue;
  }, [
    hoveredJourneyId,
    journeyMapDataKeyValue,
    journeyPlaybackIndex,
    journeys,
    mapLoaded,
    selectedJourneyId,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded) return;

    const showingJourneys = mode === 'journeys';
    setAtlasLayerVisibility(map, !showingJourneys);
    setAtlasJourneyLayerVisibility(map, showingJourneys);
    setTooltip(null);
    setHoveredJourneyId(null);
    map.getCanvas().style.cursor =
      placementMode && !showingJourneys ? 'crosshair' : '';

    if (showingJourneys && hoveredFeatureRef.current != null) {
      map.setFeatureState(
        { source: ATLAS_SOURCE_ID, id: hoveredFeatureRef.current },
        { hover: false },
      );
      hoveredFeatureRef.current = null;
    }
  }, [mapLoaded, mode, placementMode]);

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
    if (!map || !mapLoaded) return;

    const nextSelected = new Set(builderSelectedEntryIds);
    builderSelectedRef.current.forEach((id) => {
      if (!nextSelected.has(id)) {
        map.setFeatureState(
          { source: ATLAS_SOURCE_ID, id },
          { builderSelected: false },
        );
      }
    });
    nextSelected.forEach((id) => {
      map.setFeatureState(
        { source: ATLAS_SOURCE_ID, id },
        { builderSelected: true },
      );
    });
    builderSelectedRef.current = nextSelected;
  }, [builderSelectedEntryIds, mapDataKeyValue, mapLoaded]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const placing = placementMode && mode === 'places';
    map.getCanvas().style.cursor = placing ? 'crosshair' : '';
    if (placing) {
      if (hoveredFeatureRef.current != null) {
        map.setFeatureState(
          { source: ATLAS_SOURCE_ID, id: hoveredFeatureRef.current },
          { hover: false },
        );
        hoveredFeatureRef.current = null;
      }
    }
  }, [mode, placementMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || mode !== 'places' || !focusRequest.id) {
      return;
    }
    const entry = entriesRef.current.find(
      (candidate) => candidate.id === focusRequest.id,
    );
    if (!entry) return;

    const container = map.getContainer();
    try {
      map.easeTo({
        center: [entry.longitude, entry.latitude],
        zoom: Math.max(map.getZoom(), 7),
        padding: getAtlasFocusPadding(
          container.clientWidth,
          container.clientHeight,
        ),
        duration: mapAnimationDuration(950),
        essential: true,
      });
    } catch (error) {
      console.error('Atlas map camera focus failed:', error);
    }
  }, [focusRequest, mapLoaded, mode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || mode !== 'places' || fitRequest === 0) return;
    fitEntries(map, entriesRef.current);
  }, [fitRequest, mapLoaded, mode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || mode !== 'journeys') return;
    fitJourneyStops(map, journeysRef.current, selectedJourneyId);
  }, [journeyFitRequest, journeys, mapLoaded, mode, selectedJourneyId]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapLoaded || mode !== 'journeys' || !selectedJourneyId) {
      return;
    }

    const journey = journeysRef.current.find(
      (candidate) => candidate.id === selectedJourneyId,
    );
    if (!journey) return;
    const selectedStopIndex = selectedJourneyStopId
      ? journey.stops.findIndex(
          (stop) => stop.entryId === selectedJourneyStopId,
        )
      : -1;
    const targetIndex =
      selectedStopIndex >= 0
        ? selectedStopIndex
        : journeyPlaybackIndex == null
          ? -1
          : Math.min(
              Math.max(Math.trunc(journeyPlaybackIndex), 0),
              journey.stops.length - 1,
            );
    const stopCoordinate = unwrapChapterCoordinates(journey.stops)[targetIndex];
    if (!stopCoordinate) return;

    const container = map.getContainer();
    try {
      map.easeTo({
        center: stopCoordinate,
        zoom: Math.max(map.getZoom(), 7),
        padding: getAtlasJourneyFocusPadding(
          container.clientWidth,
          container.clientHeight,
        ),
        duration: mapAnimationDuration(720),
        essential: true,
      });
    } catch (error) {
      console.error('Atlas journey stop focus failed:', error);
    }
  }, [
    journeyPlaybackIndex,
    journeys,
    mapLoaded,
    mode,
    selectedJourneyId,
    selectedJourneyStopId,
  ]);

  useEffect(() => {
    journeyMarkersRef.current.forEach((marker) => marker.remove());
    journeyMarkersRef.current = [];

    const map = mapRef.current;
    if (!map || !mapLoaded || mode !== 'journeys' || !selectedJourneyId) {
      return;
    }

    const journey = journeys.find(
      (candidate) => candidate.id === selectedJourneyId,
    );
    if (!journey?.stops.length) return;

    const coordinates = unwrapChapterCoordinates(journey.stops);
    const offsets = createChapterMarkerOffsets(journey.stops);

    journeyMarkersRef.current = journey.stops.map((stop, index) => {
      const element = document.createElement('button');
      const markerLabel = document.createElement('span');
      element.type = 'button';
      element.className = styles.journeyMapMarker;
      element.dataset.current = 'false';
      element.dataset.complete = 'false';
      markerLabel.textContent = String(index + 1);
      element.append(markerLabel);
      element.setAttribute(
        'aria-label',
        `Stop ${index + 1} of ${journey.stops.length}: ${
          stop.title || 'Untitled memory'
        }, ${stop.placeLabel || stop.placeName || 'Pinned place'}`,
      );
      element.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (onJourneyStopSelectRef.current) {
          onJourneyStopSelectRef.current(stop.entryId);
        } else {
          onSelectRef.current(stop.entryId);
        }
      });

      return new maplibregl.Marker({
        element,
        anchor: 'center',
        offset: offsets[index],
      })
        .setLngLat(coordinates[index])
        .addTo(map);
    });
    syncJourneyMarkerState(
      journeyMarkersRef.current,
      journey,
      selectedJourneyStopRef.current,
      journeyPlaybackIndexRef.current,
    );

    return () => {
      journeyMarkersRef.current.forEach((marker) => marker.remove());
      journeyMarkersRef.current = [];
    };
  }, [journeys, mapLoaded, mode, selectedJourneyId]);

  useEffect(() => {
    if (!mapLoaded || mode !== 'journeys' || !selectedJourneyId) return;
    const journey = journeys.find(
      (candidate) => candidate.id === selectedJourneyId,
    );
    if (!journey) return;

    syncJourneyMarkerState(
      journeyMarkersRef.current,
      journey,
      selectedJourneyStopId,
      journeyPlaybackIndex,
    );
  }, [
    journeyPlaybackIndex,
    journeys,
    mapLoaded,
    mode,
    selectedJourneyId,
    selectedJourneyStopId,
  ]);

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

  const visibleTooltip =
    (placementMode && mode === 'places') ||
    (mode === 'places' && tooltip?.kind === 'journey') ||
    (mode === 'journeys' && tooltip?.kind !== 'journey')
      ? null
      : tooltip;
  const tooltipEntry =
    visibleTooltip?.kind === 'entry'
      ? entries.find((entry) => entry.id === visibleTooltip.entryId)
      : null;
  const tooltipJourney =
    visibleTooltip?.kind === 'journey'
      ? journeys.find((journey) => journey.id === visibleTooltip.journeyId)
      : null;

  const retryMap = () => {
    setMapLoaded(false);
    setMapError(false);
    setTooltip(null);
    renderedMapDataKeyRef.current = null;
    renderedJourneyDataKeyRef.current = null;
    setMapAttempt((attempt) => attempt + 1);
  };

  return (
    <div
      className={styles.mapFrame}
      data-map-state={mapError ? 'error' : mapLoaded ? 'ready' : 'loading'}
      data-atlas-mode={mode}
      data-placement={placementMode && mode === 'places' ? 'true' : 'false'}
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
      {placementMode && mode === 'places' ? (
        <span className={styles.placementCenter} aria-hidden="true">
          <i />
        </span>
      ) : null}
      {visibleTooltip &&
      (visibleTooltip.kind === 'cluster' || tooltipEntry || tooltipJourney) ? (
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
          ) : visibleTooltip.kind === 'journey' && tooltipJourney ? (
            <>
              <span className={styles.mapTooltipKicker}>
                {visibleTooltip.overlapCount > 1
                  ? `${visibleTooltip.overlapCount} remembered paths meet here`
                  : 'Remembered path'}
              </span>
              <strong>{tooltipJourney.title}</strong>
              <p>
                {tooltipJourney.memoryCount}{' '}
                {tooltipJourney.memoryCount === 1 ? 'memory' : 'memories'}
              </p>
              <small>
                {visibleTooltip.overlapCount > 1
                  ? 'Click to choose a journey'
                  : 'Open journey'}
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
          <span>Check your connection, then try loading it again.</span>
          <button type="button" onClick={retryMap}>
            Try again
          </button>
        </div>
      ) : null}
    </div>
  );
}
