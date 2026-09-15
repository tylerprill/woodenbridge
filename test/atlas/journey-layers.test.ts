import type { AtlasJourneySummary } from '@/app/lib/atlas/journeys/definitions';
import { createGeodesicChapterStopCoordinates } from '@/app/lib/chapters/route-geometry';
import {
  ATLAS_JOURNEY_ROUTE_CONTINUITY_LAYER,
  addAtlasJourneyLayers,
  clearAtlasJourneyLayerState,
  journeyIdsFromRenderedFeatures,
  journeysToEndpointGeoJson,
  journeysToRouteGeoJson,
  syncAtlasJourneyLayerState,
} from '@/components/atlas/atlas-journey-layers';

function journey(
  overrides: Partial<AtlasJourneySummary> = {},
): AtlasJourneySummary {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    title: 'Around the Great Lakes',
    version: 1,
    updatedAt: '2026-09-14T12:00:00.000Z',
    startDate: '2026-09-10',
    endDate: '2026-09-12',
    memoryCount: 3,
    drawable: true,
    stops: [
      {
        entryId: '00000000-0000-4000-8000-000000000011',
        position: 0,
        title: 'Detroit River',
        placeLabel: 'Detroit, Michigan',
        placeName: 'Detroit',
        visitedOn: '2026-09-10',
        latitude: 42.3314,
        longitude: -83.0458,
      },
      {
        entryId: '00000000-0000-4000-8000-000000000012',
        position: 1,
        title: 'Sleeping Bear',
        placeLabel: 'Empire, Michigan',
        placeName: 'Sleeping Bear Dunes',
        visitedOn: '2026-09-11',
        latitude: 44.896,
        longitude: -86.058,
      },
      {
        entryId: '00000000-0000-4000-8000-000000000013',
        position: 2,
        title: 'Mackinac morning',
        placeLabel: 'Mackinac Island, Michigan',
        placeName: 'Mackinac Island',
        visitedOn: '2026-09-12',
        latitude: 45.8492,
        longitude: -84.6189,
      },
    ],
    ...overrides,
  };
}

describe('Atlas journey map layers', () => {
  it('promotes unique string feature IDs through the renderer for both sources', () => {
    const values = [
      journey({ id: '10000000-0000-4000-8000-000000000001' }),
      journey({ id: '10000000-0000-4000-8000-000000000002' }),
    ];
    const map = {
      addLayer: jest.fn(),
      addSource: jest.fn(),
      getLayer: jest.fn(() => undefined),
      getSource: jest.fn(() => undefined),
    };

    addAtlasJourneyLayers(map as never, values, 'globe');

    expect(map.addSource).toHaveBeenCalledTimes(2);
    ['field-atlas-journey-routes', 'field-atlas-journey-endpoints'].forEach(
      (sourceId) => {
        expect(map.addSource).toHaveBeenCalledWith(
          sourceId,
          expect.objectContaining({
            type: 'geojson',
            promoteId: 'featureId',
          }),
        );
      },
    );
    const features = [
      ...journeysToRouteGeoJson(values).features,
      ...journeysToEndpointGeoJson(values).features,
    ];
    const promotedIds = features.map(
      (feature) => feature.properties?.featureId,
    );

    expect(promotedIds).toEqual(features.map((feature) => feature.id));
    expect(new Set(promotedIds).size).toBe(features.length);
    expect(features).toHaveLength(8);
    expect(promotedIds.every((id) => typeof id === 'string')).toBe(true);
  });

  it('emits one independently addressable feature for each route leg', () => {
    const value = journey();
    const routes = journeysToRouteGeoJson([value]);

    expect(routes.features).toHaveLength(2);
    expect(routes.features.map((feature) => feature.id)).toEqual([
      `${value.id}:0`,
      `${value.id}:1`,
    ]);
    expect(routes.features.map((feature) => feature.properties)).toEqual([
      expect.objectContaining({
        journeyId: value.id,
        segmentIndex: 0,
      }),
      expect.objectContaining({
        journeyId: value.id,
        segmentIndex: 1,
      }),
    ]);
    expect(routes.features[0].properties).not.toHaveProperty('selected');
    expect(routes.features[0].properties).not.toHaveProperty('hovered');
    expect(routes.features[0].properties).not.toHaveProperty('playbackState');
  });

  it('uses Earth-following geometry for long Atlas legs', () => {
    const value = journey({
      memoryCount: 2,
      stops: [
        {
          ...journey().stops[0],
          longitude: -75,
          latitude: 40,
        },
        {
          ...journey().stops[1],
          longitude: 75,
          latitude: 40,
        },
      ],
    });
    const [route] = journeysToRouteGeoJson([value]).features;

    expect(route.geometry.coordinates[0]).toEqual([-75, 40]);
    expect(route.geometry.coordinates.at(-1)).toEqual([75, 40]);
    expect(
      Math.max(
        ...route.geometry.coordinates.map((coordinate) => coordinate[1]),
      ),
    ).toBeGreaterThan(70);
  });

  it('switches polar legs between globe and Mercator-safe geometry', () => {
    const value = journey({
      memoryCount: 2,
      stops: [
        { ...journey().stops[0], longitude: 0, latitude: 80 },
        { ...journey().stops[1], longitude: 180, latitude: 80 },
      ],
    });
    const globeCoordinates = journeysToRouteGeoJson([value], 'globe')
      .features[0].geometry.coordinates;
    const mercatorCoordinates = journeysToRouteGeoJson([value], 'mercator')
      .features[0].geometry.coordinates;

    expect(
      Math.max(...globeCoordinates.map(([, latitude]) => latitude)),
    ).toBeGreaterThan(89);
    expect(
      Math.max(...mercatorCoordinates.map(([, latitude]) => latitude)),
    ).toBeLessThan(81);
    expect(
      Math.max(
        ...mercatorCoordinates
          .slice(1)
          .map(([longitude], index) =>
            Math.abs(longitude - mercatorCoordinates[index][0]),
          ),
      ),
    ).toBeLessThanOrEqual(2.0000001);
  });

  it('keeps canonical pole endpoints identical to their zero-length route', () => {
    const value = journey({
      memoryCount: 2,
      stops: [
        { ...journey().stops[0], longitude: 0, latitude: 90 },
        { ...journey().stops[1], longitude: 180, latitude: 90 },
      ],
    });
    const route = journeysToRouteGeoJson([value], 'mercator').features[0]
      .geometry.coordinates;
    const endpoints = journeysToEndpointGeoJson([value], 'mercator').features;

    expect(route).toHaveLength(2);
    expect(route[0]).toEqual(route[1]);
    expect(endpoints.map((feature) => feature.geometry.coordinates)).toEqual([
      route[0],
      route[1],
    ]);
  });

  it('emits only the overview endpoints for every drawable journey', () => {
    const value = journey();
    const endpoints = journeysToEndpointGeoJson([value]);

    expect(endpoints.features).toHaveLength(2);
    expect(endpoints.features.map((feature) => feature.id)).toEqual([
      `${value.id}:start`,
      `${value.id}:end`,
    ]);
    expect(endpoints.features[0].geometry.coordinates).toEqual([
      value.stops[0].longitude,
      value.stops[0].latitude,
    ]);
    expect(endpoints.features[1].geometry.coordinates).toEqual([
      value.stops[2].longitude,
      value.stops[2].latitude,
    ]);
    expect(endpoints.features[0].properties).not.toHaveProperty('selected');
    expect(endpoints.features[0].properties).not.toHaveProperty('hovered');
  });

  it.each(['globe', 'mercator'] as const)(
    'keeps exact poles and beyond-cap stops aligned across %s lines, dots, and numbered markers',
    (projection) => {
      const value = journey({
        memoryCount: 4,
        stops: [
          { ...journey().stops[0], longitude: 120, latitude: 90 },
          { ...journey().stops[1], longitude: 120, latitude: 88 },
          { ...journey().stops[2], longitude: 120, latitude: -88 },
          { ...journey().stops[2], longitude: 120, latitude: -90 },
        ],
      });
      const markerCoordinates = createGeodesicChapterStopCoordinates(
        value.stops,
        { projection },
      );
      const routes = journeysToRouteGeoJson([value], projection).features;
      const endpoints = journeysToEndpointGeoJson([value], projection).features;

      routes.forEach((route, index) => {
        expect(route.geometry.coordinates[0]).toEqual(markerCoordinates[index]);
        expect(route.geometry.coordinates.at(-1)).toEqual(
          markerCoordinates[index + 1],
        );
      });
      expect(endpoints.map((feature) => feature.geometry.coordinates)).toEqual([
        markerCoordinates[0],
        markerCoordinates.at(-1),
      ]);
      markerCoordinates.forEach(([, latitude]) => {
        expect(Math.abs(latitude)).toBeCloseTo(85.0451287798066, 10);
      });
      expect(value.stops.map((stop) => stop.latitude)).toEqual([
        90, 88, -88, -90,
      ]);
    },
  );

  it('keeps endpoint dots on the same unwrapped world copy as the route', () => {
    const value = journey({
      memoryCount: 2,
      stops: [
        {
          ...journey().stops[0],
          longitude: 179,
          latitude: 10,
        },
        {
          ...journey().stops[1],
          longitude: -179,
          latitude: 11,
        },
      ],
    });
    const routes = journeysToRouteGeoJson([value]);
    const endpoints = journeysToEndpointGeoJson([value]);

    expect(routes.features[0].geometry.coordinates[0]).toEqual([179, 10]);
    expect(routes.features[0].geometry.coordinates.at(-1)).toEqual([181, 11]);
    expect(
      endpoints.features.map((feature) => feature.geometry.coordinates),
    ).toEqual([
      [179, 10],
      [181, 11],
    ]);
  });

  it('renders a continuous route strand beneath the decorative dashes', () => {
    const layers: Array<Record<string, unknown>> = [];
    const map = {
      addLayer: jest.fn((layer: Record<string, unknown>) => layers.push(layer)),
      addSource: jest.fn(),
      getLayer: jest.fn(() => undefined),
      getSource: jest.fn(() => undefined),
    };

    addAtlasJourneyLayers(map as never, [journey()], 'globe');

    const continuity = layers.find(
      (layer) => layer.id === ATLAS_JOURNEY_ROUTE_CONTINUITY_LAYER,
    );
    expect(continuity).toMatchObject({
      type: 'line',
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
      },
    });
    expect(continuity?.paint).not.toHaveProperty('line-dasharray');

    const emphasisContinuity = layers.find(
      (layer) => layer.id === 'field-atlas-journey-route-emphasis-continuity',
    );
    expect(emphasisContinuity?.paint).not.toHaveProperty('line-dasharray');
  });

  it('keeps interaction styling in paint-only feature-state expressions', () => {
    const layers: Array<Record<string, unknown>> = [];
    const map = {
      addLayer: jest.fn((layer: Record<string, unknown>) => layers.push(layer)),
      addSource: jest.fn(),
      getLayer: jest.fn(() => undefined),
      getSource: jest.fn(() => undefined),
    };

    addAtlasJourneyLayers(map as never, [journey()], 'globe');

    const serializedLayers = JSON.stringify(layers);
    expect(serializedLayers).toContain('feature-state');
    expect(serializedLayers).toContain('playbackState');
    expect(serializedLayers).not.toContain('global-state');
    expect(layers.every((layer) => layer.filter === undefined)).toBe(true);
    expect(
      layers.every(
        (layer) =>
          !(layer.layout as Record<string, unknown> | undefined)?.[
            'line-sort-key'
          ] &&
          !(layer.layout as Record<string, unknown> | undefined)?.[
            'circle-sort-key'
          ],
      ),
    ).toBe(true);

    expect(
      layers.find((layer) => layer.id === 'field-atlas-journey-route-hit-area'),
    ).toMatchObject({
      paint: { 'line-width': 24, 'line-opacity': 0.001 },
    });
  });

  it('updates only route legs whose interaction state changed', () => {
    const map = {
      setFeatureState: jest.fn(),
    };
    const value = journey();
    const state = {
      selectedJourneyId: value.id,
      hoveredJourneyId: value.id,
      playbackStopIndex: 1,
    };

    syncAtlasJourneyLayerState(map as never, [value], null, state);
    expect(map.setFeatureState).toHaveBeenCalledTimes(4);
    expect(map.setFeatureState).toHaveBeenCalledWith(
      { source: 'field-atlas-journey-routes', id: `${value.id}:0` },
      { selected: true, hovered: true, playbackState: 'complete' },
    );
    expect(map.setFeatureState).toHaveBeenCalledWith(
      { source: 'field-atlas-journey-routes', id: `${value.id}:1` },
      { selected: true, hovered: true, playbackState: 'active' },
    );
    expect(map.setFeatureState).toHaveBeenCalledWith(
      { source: 'field-atlas-journey-endpoints', id: `${value.id}:start` },
      { selected: true, hovered: true },
    );

    map.setFeatureState.mockClear();
    syncAtlasJourneyLayerState(map as never, [value], state, state);
    expect(map.setFeatureState).not.toHaveBeenCalled();

    const advancedState = { ...state, playbackStopIndex: 2 };
    syncAtlasJourneyLayerState(map as never, [value], state, advancedState);
    expect(map.setFeatureState).toHaveBeenCalledTimes(1);
    expect(map.setFeatureState).toHaveBeenCalledWith(
      { source: 'field-atlas-journey-routes', id: `${value.id}:1` },
      { playbackState: 'complete' },
    );
  });

  it('clears retained feature state when route source data changes', () => {
    const map = { removeFeatureState: jest.fn() };

    clearAtlasJourneyLayerState(map as never);

    expect(map.removeFeatureState.mock.calls).toEqual([
      [{ source: 'field-atlas-journey-routes' }],
      [{ source: 'field-atlas-journey-endpoints' }],
    ]);
  });

  it('omits degraded journeys that no longer contain a drawable route', () => {
    const degraded = journey({
      drawable: false,
      memoryCount: 1,
      stops: journey().stops.slice(0, 1),
    });

    expect(journeysToRouteGeoJson([degraded]).features).toEqual([]);
    expect(journeysToEndpointGeoJson([degraded]).features).toEqual([]);
  });

  it('deduplicates overlapping line legs and keeps the selection first', () => {
    expect(
      journeyIdsFromRenderedFeatures(
        [
          { properties: { journeyId: 'journey-b' } },
          { properties: { journeyId: 'journey-a' } },
          { properties: { journeyId: 'journey-b' } },
          { properties: { journeyId: 42 } },
        ],
        'journey-a',
      ),
    ).toEqual(['journey-a', 'journey-b']);
  });
});
