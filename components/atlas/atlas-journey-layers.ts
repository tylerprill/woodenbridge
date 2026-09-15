import type {
  CircleLayerSpecification,
  ExpressionSpecification,
  GeoJSONSource,
  LineLayerSpecification,
  Map,
} from 'maplibre-gl';

import type { AtlasJourneySummary } from '@/app/lib/atlas/journeys/definitions';
import {
  createGeodesicChapterRouteSegments,
  createGeodesicChapterStopCoordinates,
  type ChapterRouteProjection,
} from '@/app/lib/chapters/route-geometry';

export const ATLAS_JOURNEY_ROUTE_SOURCE = 'field-atlas-journey-routes';
export const ATLAS_JOURNEY_ENDPOINT_SOURCE = 'field-atlas-journey-endpoints';
export const ATLAS_JOURNEY_ROUTE_CASING_LAYER =
  'field-atlas-journey-route-casing';
export const ATLAS_JOURNEY_ROUTE_CONTINUITY_LAYER =
  'field-atlas-journey-route-continuity';
export const ATLAS_JOURNEY_ROUTE_LAYER = 'field-atlas-journey-route-lines';
const ATLAS_JOURNEY_ROUTE_EMPHASIS_CONTINUITY_LAYER =
  'field-atlas-journey-route-emphasis-continuity';
const ATLAS_JOURNEY_ROUTE_EMPHASIS_LAYER = 'field-atlas-journey-route-emphasis';
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
  ATLAS_JOURNEY_ROUTE_CONTINUITY_LAYER,
  ATLAS_JOURNEY_ROUTE_LAYER,
  ATLAS_JOURNEY_ROUTE_CASING_LAYER,
  ATLAS_JOURNEY_ROUTE_EMPHASIS_CONTINUITY_LAYER,
  ATLAS_JOURNEY_ROUTE_EMPHASIS_LAYER,
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

function isDrawableJourney(journey: AtlasJourneySummary) {
  return (
    journey.drawable &&
    journey.stops.length >= 2 &&
    journey.stops.every(
      (stop) =>
        Number.isFinite(stop.latitude) && Number.isFinite(stop.longitude),
    )
  );
}

function drawableJourneys(journeys: AtlasJourneySummary[]) {
  return journeys.filter(isDrawableJourney);
}

function selectedJourneyExpression(): ExpressionSpecification {
  return ['boolean', ['feature-state', 'selected'], false];
}

function hoveredJourneyExpression(): ExpressionSpecification {
  return ['boolean', ['feature-state', 'hovered'], false];
}

function playbackStateExpression(): ExpressionSpecification {
  return ['string', ['feature-state', 'playbackState'], 'idle'];
}

function activePlaybackExpression(): ExpressionSpecification {
  return ['==', playbackStateExpression(), 'active'];
}

function completePlaybackExpression(): ExpressionSpecification {
  return ['==', playbackStateExpression(), 'complete'];
}

function aheadPlaybackExpression(): ExpressionSpecification {
  return ['==', playbackStateExpression(), 'ahead'];
}

function playbackState(
  journeyId: string,
  segmentStartIndex: number,
  segmentEndIndex: number,
  state: AtlasJourneyLayerState | null,
) {
  if (
    !state ||
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
  projection: ChapterRouteProjection = 'globe',
): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  return {
    type: 'FeatureCollection',
    features: drawableJourneys(journeys).flatMap((journey) =>
      createGeodesicChapterRouteSegments(journey.stops, { projection }).map(
        (segment) => ({
          type: 'Feature' as const,
          id: `${journey.id}:${segment.startIndex}`,
          geometry: {
            type: 'LineString' as const,
            coordinates: segment.coordinates,
          },
          properties: {
            featureId: `${journey.id}:${segment.startIndex}`,
            journeyId: journey.id,
            title: journey.title,
            segmentIndex: segment.startIndex,
            color: journeyColor(journey.id),
          },
        }),
      ),
    ),
  };
}

export function journeysToEndpointGeoJson(
  journeys: AtlasJourneySummary[],
  projection: ChapterRouteProjection = 'globe',
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: drawableJourneys(journeys).flatMap((journey) => {
      const first = journey.stops[0];
      const last = journey.stops.at(-1);
      const coordinates = createGeodesicChapterStopCoordinates(journey.stops, {
        projection,
      });
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
          featureId: `${journey.id}:${endpoint}`,
          journeyId: journey.id,
          title: journey.title,
          endpoint,
          color: journeyColor(journey.id),
        },
      }));
    }),
  };
}

export function addAtlasJourneyLayers(
  map: Map,
  journeys: AtlasJourneySummary[],
  projection: ChapterRouteProjection,
) {
  if (!map.getSource(ATLAS_JOURNEY_ROUTE_SOURCE)) {
    map.addSource(ATLAS_JOURNEY_ROUTE_SOURCE, {
      type: 'geojson',
      // Vector-tile transport coerces feature.id; preserve full string keys
      // from properties so rendered feature-state matches selection/playback.
      promoteId: 'featureId',
      data: journeysToRouteGeoJson(journeys, projection),
    });
  }
  if (!map.getSource(ATLAS_JOURNEY_ENDPOINT_SOURCE)) {
    map.addSource(ATLAS_JOURNEY_ENDPOINT_SOURCE, {
      type: 'geojson',
      promoteId: 'featureId',
      data: journeysToEndpointGeoJson(journeys, projection),
    });
  }

  const routeCasing: LineLayerSpecification = {
    id: ATLAS_JOURNEY_ROUTE_CASING_LAYER,
    type: 'line',
    source: ATLAS_JOURNEY_ROUTE_SOURCE,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#fbfaf5',
      'line-width': 8,
      'line-opacity': ['case', selectedJourneyExpression(), 0.88, 0],
    },
  };
  const routeLine: LineLayerSpecification = {
    id: ATLAS_JOURNEY_ROUTE_LAYER,
    type: 'line',
    source: ATLAS_JOURNEY_ROUTE_SOURCE,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': 2,
      'line-opacity': [
        'case',
        ['any', selectedJourneyExpression(), hoveredJourneyExpression()],
        0,
        0.28,
      ],
      'line-dasharray': [1.4, 1.05],
    },
  };
  const routeContinuity: LineLayerSpecification = {
    id: ATLAS_JOURNEY_ROUTE_CONTINUITY_LAYER,
    type: 'line',
    source: ATLAS_JOURNEY_ROUTE_SOURCE,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      // Keep an unbroken strand beneath the decorative dash pattern so a
      // route always visibly reaches the center of every anchored stop.
      'line-color': ['get', 'color'],
      'line-width': 1,
      'line-opacity': [
        'case',
        ['any', selectedJourneyExpression(), hoveredJourneyExpression()],
        0,
        0.12,
      ],
    },
  };
  const routeEmphasisContinuity: LineLayerSpecification = {
    id: ATLAS_JOURNEY_ROUTE_EMPHASIS_CONTINUITY_LAYER,
    type: 'line',
    source: ATLAS_JOURNEY_ROUTE_SOURCE,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': [
        'case',
        selectedJourneyExpression(),
        2,
        hoveredJourneyExpression(),
        1.5,
        1,
      ],
      'line-opacity': [
        'case',
        selectedJourneyExpression(),
        ['case', aheadPlaybackExpression(), 0.24, 0.68],
        hoveredJourneyExpression(),
        0.34,
        0,
      ],
    },
  };
  const routeEmphasis: LineLayerSpecification = {
    id: ATLAS_JOURNEY_ROUTE_EMPHASIS_LAYER,
    type: 'line',
    source: ATLAS_JOURNEY_ROUTE_SOURCE,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['get', 'color'],
      'line-width': [
        'case',
        selectedJourneyExpression(),
        3.5,
        hoveredJourneyExpression(),
        3,
        2,
      ],
      'line-opacity': [
        'case',
        selectedJourneyExpression(),
        ['case', aheadPlaybackExpression(), 0.42, 0.96],
        hoveredJourneyExpression(),
        0.75,
        0,
      ],
      'line-dasharray': [1.4, 1.05],
    },
  };
  const routeProgress: LineLayerSpecification = {
    id: ATLAS_JOURNEY_ROUTE_PROGRESS_LAYER,
    type: 'line',
    source: ATLAS_JOURNEY_ROUTE_SOURCE,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': '#10231d',
      'line-width': ['case', activePlaybackExpression(), 4.5, 4],
      'line-opacity': [
        'case',
        activePlaybackExpression(),
        0.72,
        completePlaybackExpression(),
        0.98,
        0,
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
      'circle-radius': ['case', selectedJourneyExpression(), 12, 9],
      'circle-color': ['get', 'color'],
      'circle-opacity': [
        'case',
        selectedJourneyExpression(),
        0.22,
        hoveredJourneyExpression(),
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
    paint: {
      'circle-radius': [
        'case',
        selectedJourneyExpression(),
        5.5,
        hoveredJourneyExpression(),
        5,
        4,
      ],
      'circle-color': ['get', 'color'],
      'circle-stroke-width': 2,
      'circle-stroke-color': '#fbfaf5',
      'circle-opacity': ['case', selectedJourneyExpression(), 1, 0.78],
    },
  };

  [
    routeContinuity,
    routeLine,
    routeCasing,
    routeEmphasisContinuity,
    routeEmphasis,
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
  projection: ChapterRouteProjection,
) {
  const routeSource = map.getSource(
    ATLAS_JOURNEY_ROUTE_SOURCE,
  ) as GeoJSONSource | null;
  const endpointSource = map.getSource(
    ATLAS_JOURNEY_ENDPOINT_SOURCE,
  ) as GeoJSONSource | null;
  routeSource?.setData(journeysToRouteGeoJson(journeys, projection));
  endpointSource?.setData(journeysToEndpointGeoJson(journeys, projection));
}

export function clearAtlasJourneyLayerState(map: Map) {
  map.removeFeatureState({ source: ATLAS_JOURNEY_ROUTE_SOURCE });
  map.removeFeatureState({ source: ATLAS_JOURNEY_ENDPOINT_SOURCE });
}

export function syncAtlasJourneyLayerState(
  map: Map,
  journeys: AtlasJourneySummary[],
  previousState: AtlasJourneyLayerState | null,
  state: AtlasJourneyLayerState,
) {
  const affectedJourneyIds = new Set(
    [
      previousState?.selectedJourneyId,
      previousState?.hoveredJourneyId,
      state.selectedJourneyId,
      state.hoveredJourneyId,
    ].filter((id): id is string => typeof id === 'string'),
  );

  journeys.forEach((journey) => {
    if (!affectedJourneyIds.has(journey.id) || !isDrawableJourney(journey)) {
      return;
    }

    journey.stops.slice(0, -1).forEach((_, segmentIndex) => {
      const previousFeatureState = {
        selected: journey.id === previousState?.selectedJourneyId,
        hovered: journey.id === previousState?.hoveredJourneyId,
        playbackState: playbackState(
          journey.id,
          segmentIndex,
          segmentIndex + 1,
          previousState,
        ),
      };
      const nextFeatureState = {
        selected: journey.id === state.selectedJourneyId,
        hovered: journey.id === state.hoveredJourneyId,
        playbackState: playbackState(
          journey.id,
          segmentIndex,
          segmentIndex + 1,
          state,
        ),
      };
      const changedState = Object.fromEntries(
        Object.entries(nextFeatureState).filter(
          ([key, value]) =>
            previousFeatureState[key as keyof typeof previousFeatureState] !==
            value,
        ),
      );

      if (Object.keys(changedState).length) {
        map.setFeatureState(
          {
            source: ATLAS_JOURNEY_ROUTE_SOURCE,
            id: `${journey.id}:${segmentIndex}`,
          },
          changedState,
        );
      }
    });

    const previousEndpointState = {
      selected: journey.id === previousState?.selectedJourneyId,
      hovered: journey.id === previousState?.hoveredJourneyId,
    };
    const nextEndpointState = {
      selected: journey.id === state.selectedJourneyId,
      hovered: journey.id === state.hoveredJourneyId,
    };
    const changedEndpointState = Object.fromEntries(
      Object.entries(nextEndpointState).filter(
        ([key, value]) =>
          previousEndpointState[key as keyof typeof previousEndpointState] !==
          value,
      ),
    );
    if (!Object.keys(changedEndpointState).length) return;

    (['start', 'end'] as const).forEach((endpoint) => {
      map.setFeatureState(
        {
          source: ATLAS_JOURNEY_ENDPOINT_SOURCE,
          id: `${journey.id}:${endpoint}`,
        },
        changedEndpointState,
      );
    });
  });
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
