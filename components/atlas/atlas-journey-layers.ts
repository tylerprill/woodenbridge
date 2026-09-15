import type {
  CircleLayerSpecification,
  GeoJSONSource,
  LineLayerSpecification,
  Map,
} from 'maplibre-gl';

import type { AtlasJourneySummary } from '@/app/lib/atlas/journeys/definitions';
import {
  createGentleChapterRouteSegments,
  unwrapChapterCoordinates,
} from '@/app/lib/chapters/route-geometry';

export const ATLAS_JOURNEY_ROUTE_SOURCE = 'field-atlas-journey-routes';
export const ATLAS_JOURNEY_ENDPOINT_SOURCE = 'field-atlas-journey-endpoints';
export const ATLAS_JOURNEY_ROUTE_CASING_LAYER =
  'field-atlas-journey-route-casing';
export const ATLAS_JOURNEY_ROUTE_CONTINUITY_LAYER =
  'field-atlas-journey-route-continuity';
export const ATLAS_JOURNEY_ROUTE_LAYER = 'field-atlas-journey-route-lines';
export const ATLAS_JOURNEY_ROUTE_PROGRESS_LAYER =
  'field-atlas-journey-route-progress';
export const ATLAS_JOURNEY_ROUTE_HIT_LAYER =
  'field-atlas-journey-route-hit-area';
export const ATLAS_JOURNEY_ENDPOINT_HALO_LAYER =
  'field-atlas-journey-endpoint-halos';
export const ATLAS_JOURNEY_ENDPOINT_LAYER = 'field-atlas-journey-endpoints';

export const ATLAS_JOURNEY_INTERACTIVE_LAYERS = [
  ATLAS_JOURNEY_ROUTE_HIT_LAYER,
  ATLAS_JOURNEY_ENDPOINT_LAYER,
] as const;

const ATLAS_JOURNEY_LAYERS = [
  ATLAS_JOURNEY_ROUTE_CASING_LAYER,
  ATLAS_JOURNEY_ROUTE_CONTINUITY_LAYER,
  ATLAS_JOURNEY_ROUTE_LAYER,
  ATLAS_JOURNEY_ROUTE_PROGRESS_LAYER,
  ATLAS_JOURNEY_ROUTE_HIT_LAYER,
  ATLAS_JOURNEY_ENDPOINT_HALO_LAYER,
  ATLAS_JOURNEY_ENDPOINT_LAYER,
] as const;

const JOURNEY_PALETTE = [
  '#b66d42',
  '#4c6a5b',
  '#9b7148',
  '#6c7e70',
  '#9b5f49',
] as const;

export type AtlasJourneyLayerState = {
  selectedJourneyId: string | null;
  hoveredJourneyId?: string | null;
  playbackStopIndex?: number | null;
};

function journeyColor(id: string) {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  }
  return JOURNEY_PALETTE[hash % JOURNEY_PALETTE.length];
}

function drawableJourneys(journeys: AtlasJourneySummary[]) {
  return journeys.filter(
    (journey) =>
      journey.drawable &&
      journey.stops.length >= 2 &&
      journey.stops.every(
        (stop) =>
          Number.isFinite(stop.latitude) && Number.isFinite(stop.longitude),
      ),
  );
}

function playbackState(
  journeyId: string,
  segmentStartIndex: number,
  segmentEndIndex: number,
  state: AtlasJourneyLayerState,
) {
  if (
    journeyId !== state.selectedJourneyId ||
    state.playbackStopIndex == null
  ) {
    return 'idle';
  }
  if (segmentEndIndex <= state.playbackStopIndex) return 'complete';
  if (segmentStartIndex === state.playbackStopIndex) return 'active';
  return 'ahead';
}

export function journeysToRouteGeoJson(
  journeys: AtlasJourneySummary[],
  state: AtlasJourneyLayerState,
): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  return {
    type: 'FeatureCollection',
    features: drawableJourneys(journeys).flatMap((journey) =>
      createGentleChapterRouteSegments(journey.stops).map((segment) => ({
        type: 'Feature' as const,
        id: `${journey.id}:${segment.startIndex}`,
        geometry: {
          type: 'LineString' as const,
          coordinates: segment.coordinates,
        },
        properties: {
          journeyId: journey.id,
          title: journey.title,
          segmentIndex: segment.startIndex,
          color: journeyColor(journey.id),
          selected: journey.id === state.selectedJourneyId,
          hovered: journey.id === state.hoveredJourneyId,
          playbackState: playbackState(
            journey.id,
            segment.startIndex,
            segment.endIndex,
            state,
          ),
        },
      })),
    ),
  };
}

export function journeysToEndpointGeoJson(
  journeys: AtlasJourneySummary[],
  state: AtlasJourneyLayerState,
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: drawableJourneys(journeys).flatMap((journey) => {
      const first = journey.stops[0];
      const last = journey.stops.at(-1);
      const coordinates = unwrapChapterCoordinates(journey.stops);
      const firstCoordinate = coordinates[0];
      const lastCoordinate = coordinates.at(-1);
      if (!first || !last || !firstCoordinate || !lastCoordinate) return [];

      return [
        { coordinate: firstCoordinate, endpoint: 'start' },
        { coordinate: lastCoordinate, endpoint: 'end' },
      ].map(({ coordinate, endpoint }) => ({
        type: 'Feature' as const,
        id: `${journey.id}:${endpoint}`,
        geometry: {
          type: 'Point' as const,
          coordinates: coordinate,
        },
        properties: {
          journeyId: journey.id,
          title: journey.title,
          endpoint,
          color: journeyColor(journey.id),
          selected: journey.id === state.selectedJourneyId,
          hovered: journey.id === state.hoveredJourneyId,
        },
      }));
    }),
  };
}

export function addAtlasJourneyLayers(
  map: Map,
  journeys: AtlasJourneySummary[],
  state: AtlasJourneyLayerState,
) {
  if (!map.getSource(ATLAS_JOURNEY_ROUTE_SOURCE)) {
    map.addSource(ATLAS_JOURNEY_ROUTE_SOURCE, {
      type: 'geojson',
      data: journeysToRouteGeoJson(journeys, state),
    });
  }
  if (!map.getSource(ATLAS_JOURNEY_ENDPOINT_SOURCE)) {
    map.addSource(ATLAS_JOURNEY_ENDPOINT_SOURCE, {
      type: 'geojson',
      data: journeysToEndpointGeoJson(journeys, state),
    });
  }

  const routeCasing: LineLayerSpecification = {
    id: ATLAS_JOURNEY_ROUTE_CASING_LAYER,
    type: 'line',
    source: ATLAS_JOURNEY_ROUTE_SOURCE,
    filter: ['==', ['get', 'selected'], true],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#fbfaf5',
      'line-width': 8,
      'line-opacity': 0.88,
    },
  };
  const routeLine: LineLayerSpecification = {
    id: ATLAS_JOURNEY_ROUTE_LAYER,
    type: 'line',
    source: ATLAS_JOURNEY_ROUTE_SOURCE,
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
      'line-sort-key': [
        'case',
        ['==', ['get', 'selected'], true],
        2,
        ['==', ['get', 'hovered'], true],
        1,
        0,
      ],
    },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': [
        'case',
        ['==', ['get', 'selected'], true],
        3.5,
        ['==', ['get', 'hovered'], true],
        3,
        2,
      ],
      'line-opacity': [
        'case',
        ['==', ['get', 'selected'], true],
        ['case', ['==', ['get', 'playbackState'], 'ahead'], 0.42, 0.96],
        ['==', ['get', 'hovered'], true],
        0.75,
        0.28,
      ],
      'line-dasharray': [1.4, 1.05],
    },
  };
  const routeContinuity: LineLayerSpecification = {
    id: ATLAS_JOURNEY_ROUTE_CONTINUITY_LAYER,
    type: 'line',
    source: ATLAS_JOURNEY_ROUTE_SOURCE,
    layout: {
      'line-cap': 'round',
      'line-join': 'round',
      'line-sort-key': [
        'case',
        ['==', ['get', 'selected'], true],
        2,
        ['==', ['get', 'hovered'], true],
        1,
        0,
      ],
    },
    paint: {
      // Keep an unbroken strand beneath the decorative dash pattern so a
      // route always visibly reaches the center of every anchored stop.
      'line-color': ['get', 'color'],
      'line-width': [
        'case',
        ['==', ['get', 'selected'], true],
        2,
        ['==', ['get', 'hovered'], true],
        1.5,
        1,
      ],
      'line-opacity': [
        'case',
        ['==', ['get', 'selected'], true],
        ['case', ['==', ['get', 'playbackState'], 'ahead'], 0.24, 0.68],
        ['==', ['get', 'hovered'], true],
        0.34,
        0.12,
      ],
    },
  };
  const routeProgress: LineLayerSpecification = {
    id: ATLAS_JOURNEY_ROUTE_PROGRESS_LAYER,
    type: 'line',
    source: ATLAS_JOURNEY_ROUTE_SOURCE,
    filter: [
      'match',
      ['get', 'playbackState'],
      ['complete', 'active'],
      true,
      false,
    ],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#10231d',
      'line-width': [
        'case',
        ['==', ['get', 'playbackState'], 'active'],
        4.5,
        4,
      ],
      'line-opacity': [
        'case',
        ['==', ['get', 'playbackState'], 'active'],
        0.72,
        0.98,
      ],
    },
  };
  const routeHitArea: LineLayerSpecification = {
    id: ATLAS_JOURNEY_ROUTE_HIT_LAYER,
    type: 'line',
    source: ATLAS_JOURNEY_ROUTE_SOURCE,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#10231d',
      'line-width': 24,
      'line-opacity': 0.001,
    },
  };
  const endpointHalo: CircleLayerSpecification = {
    id: ATLAS_JOURNEY_ENDPOINT_HALO_LAYER,
    type: 'circle',
    source: ATLAS_JOURNEY_ENDPOINT_SOURCE,
    paint: {
      'circle-radius': ['case', ['==', ['get', 'selected'], true], 12, 9],
      'circle-color': ['get', 'color'],
      'circle-opacity': [
        'case',
        ['==', ['get', 'selected'], true],
        0.22,
        ['==', ['get', 'hovered'], true],
        0.18,
        0.1,
      ],
      'circle-blur': 0.35,
    },
  };
  const endpoints: CircleLayerSpecification = {
    id: ATLAS_JOURNEY_ENDPOINT_LAYER,
    type: 'circle',
    source: ATLAS_JOURNEY_ENDPOINT_SOURCE,
    layout: {
      'circle-sort-key': [
        'case',
        ['==', ['get', 'selected'], true],
        2,
        ['==', ['get', 'hovered'], true],
        1,
        0,
      ],
    },
    paint: {
      'circle-radius': [
        'case',
        ['==', ['get', 'selected'], true],
        5.5,
        ['==', ['get', 'hovered'], true],
        5,
        4,
      ],
      'circle-color': ['get', 'color'],
      'circle-stroke-width': 2,
      'circle-stroke-color': '#fbfaf5',
      'circle-opacity': ['case', ['==', ['get', 'selected'], true], 1, 0.78],
    },
  };

  [
    routeCasing,
    routeContinuity,
    routeLine,
    routeProgress,
    routeHitArea,
    endpointHalo,
    endpoints,
  ].forEach((layer) => {
    if (!map.getLayer(layer.id)) map.addLayer(layer);
  });
}

export function updateAtlasJourneySources(
  map: Map,
  journeys: AtlasJourneySummary[],
  state: AtlasJourneyLayerState,
) {
  const routeSource = map.getSource(
    ATLAS_JOURNEY_ROUTE_SOURCE,
  ) as GeoJSONSource | null;
  const endpointSource = map.getSource(
    ATLAS_JOURNEY_ENDPOINT_SOURCE,
  ) as GeoJSONSource | null;
  routeSource?.setData(journeysToRouteGeoJson(journeys, state));
  endpointSource?.setData(journeysToEndpointGeoJson(journeys, state));
}

export function setAtlasJourneyLayerVisibility(map: Map, visible: boolean) {
  const visibility = visible ? 'visible' : 'none';
  ATLAS_JOURNEY_LAYERS.forEach((layerId) => {
    if (map.getLayer(layerId)) {
      map.setLayoutProperty(layerId, 'visibility', visibility);
    }
  });
}

export function journeyIdsFromRenderedFeatures(
  features: Array<{ properties?: Record<string, unknown> | null }>,
  selectedJourneyId: string | null = null,
) {
  const ids = Array.from(
    new Set(
      features.flatMap((feature) => {
        const id = feature.properties?.journeyId;
        return typeof id === 'string' ? [id] : [];
      }),
    ),
  );
  if (!selectedJourneyId || !ids.includes(selectedJourneyId)) return ids;
  return [selectedJourneyId, ...ids.filter((id) => id !== selectedJourneyId)];
}
