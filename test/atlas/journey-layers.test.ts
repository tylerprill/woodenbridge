import type { AtlasJourneySummary } from '@/app/lib/atlas/journeys/definitions';
import {
  ATLAS_JOURNEY_ROUTE_CONTINUITY_LAYER,
  addAtlasJourneyLayers,
  journeyIdsFromRenderedFeatures,
  journeysToEndpointGeoJson,
  journeysToRouteGeoJson,
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
  it('emits one independently addressable feature for each route leg', () => {
    const value = journey();
    const routes = journeysToRouteGeoJson([value], {
      selectedJourneyId: value.id,
      playbackStopIndex: 1,
    });

    expect(routes.features).toHaveLength(2);
    expect(routes.features.map((feature) => feature.id)).toEqual([
      `${value.id}:0`,
      `${value.id}:1`,
    ]);
    expect(routes.features.map((feature) => feature.properties)).toEqual([
      expect.objectContaining({
        journeyId: value.id,
        segmentIndex: 0,
        selected: true,
        playbackState: 'complete',
      }),
      expect.objectContaining({
        journeyId: value.id,
        segmentIndex: 1,
        selected: true,
        playbackState: 'active',
      }),
    ]);
  });

  it('keeps playback styling idle on unselected journeys', () => {
    const value = journey();
    const routes = journeysToRouteGeoJson([value], {
      selectedJourneyId: 'another-journey',
      playbackStopIndex: 2,
    });

    expect(
      routes.features.every(
        (feature) => feature.properties?.playbackState === 'idle',
      ),
    ).toBe(true);
  });

  it('emits only the overview endpoints for every drawable journey', () => {
    const value = journey();
    const endpoints = journeysToEndpointGeoJson([value], {
      selectedJourneyId: value.id,
    });

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
    expect(
      endpoints.features.every(
        (feature) => feature.properties?.selected === true,
      ),
    ).toBe(true);
  });

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
    const state = { selectedJourneyId: value.id };
    const routes = journeysToRouteGeoJson([value], state);
    const endpoints = journeysToEndpointGeoJson([value], state);

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

    addAtlasJourneyLayers(map as never, [journey()], {
      selectedJourneyId: journey().id,
    });

    const continuity = layers.find(
      (layer) => layer.id === ATLAS_JOURNEY_ROUTE_CONTINUITY_LAYER,
    );
    expect(continuity).toMatchObject({
      type: 'line',
      layout: {
        'line-cap': 'round',
        'line-join': 'round',
        'line-sort-key': expect.any(Array),
      },
    });
    expect(continuity?.paint).not.toHaveProperty('line-dasharray');
  });

  it('omits degraded journeys that no longer contain a drawable route', () => {
    const degraded = journey({
      drawable: false,
      memoryCount: 1,
      stops: journey().stops.slice(0, 1),
    });

    expect(
      journeysToRouteGeoJson([degraded], { selectedJourneyId: null }).features,
    ).toEqual([]);
    expect(
      journeysToEndpointGeoJson([degraded], { selectedJourneyId: null })
        .features,
    ).toEqual([]);
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
