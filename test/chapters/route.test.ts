import {
  createChapterMarkerOffsets,
  createGeodesicChapterRoute,
  createGeodesicChapterRouteSegments,
  createGeodesicChapterStopCoordinates,
  createGentleChapterRoute,
  createGentleChapterRouteSegments,
  unwrapChapterCoordinates,
} from '@/app/lib/chapters/route-geometry';

describe('chapter route geometry', () => {
  it('keeps every stop anchored while adding a gentle curve', () => {
    const points = [
      { longitude: -84, latitude: 43 },
      { longitude: -83, latitude: 43 },
      { longitude: -82.5, latitude: 42.4 },
    ];
    const route = createGentleChapterRoute(points);

    expect(route[0]).toEqual([-84, 43]);
    expect(route[18]).toEqual([-83, 43]);
    expect(route.at(-1)).toEqual([-82.5, 42.4]);
    expect(route[9][1]).not.toBe(43);
  });

  it('separates nearby stops without moving isolated markers', () => {
    const offsets = createChapterMarkerOffsets([
      { latitude: 41.8902, longitude: 12.4922 },
      { latitude: 29.9792, longitude: 31.1342 },
      { latitude: 30.3285, longitude: 35.4444 },
      { latitude: 27.1751, longitude: 78.0421 },
    ]);

    expect(offsets).toEqual([
      [0, 0],
      [-13, 0],
      [13, 0],
      [0, 0],
    ]);
  });

  it('fans out several stops that share the same area', () => {
    const offsets = createChapterMarkerOffsets([
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 0 },
    ]);

    expect(new Set(offsets.map((offset) => offset.join(','))).size).toBe(3);
    expect(offsets.every((offset) => offset.some(Boolean))).toBe(true);
  });

  it('gives nearby stops more room on a world-spanning route', () => {
    const offsets = createChapterMarkerOffsets([
      { latitude: 41.8902, longitude: 12.4922 },
      { latitude: 29.9792, longitude: 31.1342 },
      { latitude: 30.3285, longitude: 35.4444 },
      { latitude: -27.1259, longitude: -109.2766 },
    ]);

    expect(offsets.slice(0, 3)).toEqual([
      [0, -18],
      [16, 9],
      [-16, 9],
    ]);
    expect(offsets[3]).toEqual([0, 0]);
  });

  it('never fans world-route edge markers beyond the map frame', () => {
    const offsets = createChapterMarkerOffsets([
      { latitude: 0, longitude: -170 },
      { latitude: 0, longitude: -169 },
      { latitude: 0, longitude: 0 },
      { latitude: 0, longitude: 1 },
      { latitude: 0, longitude: 169 },
      { latitude: 0, longitude: 170 },
    ]);

    expect(offsets[0][0]).toBeGreaterThanOrEqual(0);
    expect(offsets[5][0]).toBeLessThanOrEqual(0);
  });

  it('bows each leg away from the point behind it', () => {
    const route = createGentleChapterRoute([
      { longitude: 0, latitude: 0 },
      { longitude: 1, latitude: 0 },
      { longitude: 1, latitude: 1 },
    ]);

    // The next stop sits above the opening leg, so that leg bows below it.
    expect(route[9][1]).toBeLessThan(0);
    // The previous stop sits left of the second leg, so that leg bows right.
    expect(route[27][0]).toBeGreaterThan(1);
  });

  it('does not manufacture a route for one stop', () => {
    expect(
      createGentleChapterRoute([{ longitude: -83.6, latitude: 43.1 }]),
    ).toEqual([[-83.6, 43.1]]);
  });

  it('takes the short path across the international date line', () => {
    const coordinates = unwrapChapterCoordinates([
      { longitude: 179, latitude: 10 },
      { longitude: -179, latitude: 11 },
    ]);

    expect(coordinates).toEqual([
      [179, 10],
      [181, 11],
    ]);
  });

  it('preserves route legs as addressable playback segments', () => {
    const segments = createGentleChapterRouteSegments([
      { longitude: -84, latitude: 43 },
      { longitude: -83, latitude: 43 },
      { longitude: -82.5, latitude: 42.4 },
    ]);

    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ startIndex: 0, endIndex: 1 });
    expect(segments[1]).toMatchObject({ startIndex: 1, endIndex: 2 });
    expect(segments[0].coordinates[0]).toEqual([-84, 43]);
    expect(segments[0].coordinates.at(-1)).toEqual([-83, 43]);
    expect(segments[1].coordinates[0]).toEqual([-83, 43]);
    expect(segments[1].coordinates.at(-1)).toEqual([-82.5, 42.4]);
  });

  it('returns no playback segments until a route has two stops', () => {
    expect(createGentleChapterRouteSegments([])).toEqual([]);
    expect(
      createGentleChapterRouteSegments([{ longitude: -83.6, latitude: 43.1 }]),
    ).toEqual([]);
  });

  it('keeps playback segments unwrapped across the date line', () => {
    const segments = createGentleChapterRouteSegments([
      { longitude: 179, latitude: 10 },
      { longitude: -179, latitude: 11 },
    ]);

    expect(segments[0].coordinates[0]).toEqual([179, 10]);
    expect(segments[0].coordinates.at(-1)).toEqual([181, 11]);
  });

  it('follows the equator along an equatorial great-circle route', () => {
    const route = createGeodesicChapterRoute([
      { longitude: 0, latitude: 0 },
      { longitude: 80, latitude: 0 },
    ]);

    expect(route).toHaveLength(41);
    expect(route[20][0]).toBeCloseTo(40, 10);
    expect(route.every((coordinate) => Math.abs(coordinate[1]) < 1e-10)).toBe(
      true,
    );
  });

  it('bows a high-latitude great-circle route toward the pole', () => {
    const route = createGeodesicChapterRoute([
      { longitude: -60, latitude: 45 },
      { longitude: 60, latitude: 45 },
    ]);

    expect(
      Math.max(...route.map((coordinate) => coordinate[1])),
    ).toBeGreaterThan(63);
  });

  it('keeps every geodesic leg anchored to its exact unwrapped stops', () => {
    const points = [
      { longitude: 170, latitude: 35 },
      { longitude: -170, latitude: 40 },
      { longitude: -120, latitude: 45 },
    ];
    const stops = unwrapChapterCoordinates(points);
    const segments = createGeodesicChapterRouteSegments(points);

    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ startIndex: 0, endIndex: 1 });
    expect(segments[1]).toMatchObject({ startIndex: 1, endIndex: 2 });
    segments.forEach((segment, index) => {
      expect(segment.coordinates[0]).toEqual(stops[index]);
      expect(segment.coordinates.at(-1)).toEqual(stops[index + 1]);
    });
  });

  it('keeps a geodesic route continuous across the international date line', () => {
    const route = createGeodesicChapterRoute([
      { longitude: 179, latitude: 10 },
      { longitude: -179, latitude: 11 },
    ]);

    expect(route[0]).toEqual([179, 10]);
    expect(route.at(-1)).toEqual([181, 11]);
    expect(
      route
        .slice(1)
        .every(
          (coordinate, index) =>
            Math.abs(coordinate[0] - route[index][0]) <= 180,
        ),
    ).toBe(true);
  });

  it('handles coincident and tiny geodesic legs without unstable math', () => {
    const coincident = createGeodesicChapterRouteSegments([
      { longitude: 10, latitude: 20 },
      { longitude: 10, latitude: 20 },
    ])[0].coordinates;
    const tiny = createGeodesicChapterRouteSegments([
      { longitude: 10, latitude: 20 },
      { longitude: 10 + 1e-10, latitude: 20 + 1e-10 },
    ])[0].coordinates;

    expect(coincident).toEqual([
      [10, 20],
      [10, 20],
    ]);
    expect(tiny).toHaveLength(2);
    expect([...coincident, ...tiny].flat().every(Number.isFinite)).toBe(true);
  });

  it('renders near-antipodal legs deterministically with bounded finite samples', () => {
    const points = [
      { longitude: 0, latitude: 0 },
      { longitude: 179.999999999999, latitude: 0.000000000001 },
    ];
    const first = createGeodesicChapterRoute(points);
    const second = createGeodesicChapterRoute(points);

    expect(first).toEqual(second);
    expect(first.length).toBeGreaterThan(2);
    expect(first.length).toBeLessThanOrEqual(97);
    expect(first[0]).toEqual([0, 0]);
    expect(first.at(-1)).toEqual([179.999999999999, 0.000000000001]);
    expect(first.flat().every(Number.isFinite)).toBe(true);
    expect(
      first.every((coordinate) => coordinate[1] >= -90 && coordinate[1] <= 90),
    ).toBe(true);
    expect(
      first
        .slice(1)
        .every(
          (coordinate, index) =>
            Math.abs(coordinate[0] - first[index][0]) <= 180,
        ),
    ).toBe(true);
  });

  it('does not flip a near-antipodal route under stored-coordinate perturbations', () => {
    const routes = [-1, 0, 1].map((perturbation) =>
      createGeodesicChapterRoute([
        { longitude: 0, latitude: 20 },
        {
          longitude: 179.99999,
          latitude: -20 + perturbation * 0.00001,
        },
      ]),
    );
    const quarterCoordinates = routes.map(
      (route) => route[Math.floor(route.length / 4)],
    );

    expect(quarterCoordinates.every((coordinate) => coordinate[0] > 0)).toBe(
      true,
    );
    expect(quarterCoordinates.every((coordinate) => coordinate[1] > 10)).toBe(
      true,
    );
    expect(
      Math.max(...quarterCoordinates.map((coordinate) => coordinate[0])) -
        Math.min(...quarterCoordinates.map((coordinate) => coordinate[0])),
    ).toBeLessThan(1e-10);
    expect(
      Math.max(...quarterCoordinates.map((coordinate) => coordinate[1])) -
        Math.min(...quarterCoordinates.map((coordinate) => coordinate[1])),
    ).toBeLessThan(1e-10);
  });

  it('keeps the true polar geodesic on a globe and uses a safe Mercator path', () => {
    const points = [
      { longitude: 0, latitude: 80 },
      { longitude: 180, latitude: 80 },
    ];
    const globeRoute = createGeodesicChapterRoute(points, {
      projection: 'globe',
    });
    const defaultRoute = createGeodesicChapterRoute(points);
    const mercatorRoute = createGeodesicChapterRoute(points, {
      projection: 'mercator',
    });
    const longitudeDeltas = mercatorRoute
      .slice(1)
      .map((coordinate, index) => coordinate[0] - mercatorRoute[index][0]);

    expect(defaultRoute).toEqual(globeRoute);
    expect(
      Math.max(...globeRoute.map(([, latitude]) => latitude)),
    ).toBeGreaterThan(89);
    expect(mercatorRoute[0]).toEqual([0, 80]);
    expect(mercatorRoute.at(-1)).toEqual([180, 80]);
    expect(mercatorRoute).toHaveLength(91);
    expect(
      mercatorRoute
        .slice(1, -1)
        .every((coordinate) => Math.abs(coordinate[1]) < 81),
    ).toBe(true);
    expect(Math.max(...longitudeDeltas.map(Math.abs))).toBeLessThanOrEqual(
      2.0000001,
    );
    expect(
      [...globeRoute, ...mercatorRoute].flat().every(Number.isFinite),
    ).toBe(true);
  });

  it('keeps polar fallback legs bounded with exact unwrapped endpoints', () => {
    const route = createGeodesicChapterRoute(
      [
        { longitude: 170, latitude: 84 },
        { longitude: -10, latitude: 84 },
      ],
      { projection: 'mercator' },
    );

    expect(route[0]).toEqual([170, 84]);
    expect(route.at(-1)).toEqual([-10, 84]);
    expect(route.length).toBeLessThanOrEqual(97);
    expect(route.flat().every(Number.isFinite)).toBe(true);
    expect(
      route
        .slice(1)
        .every(
          (coordinate, index) =>
            Math.abs(coordinate[0] - route[index][0]) <= 2.0000001,
        ),
    ).toBe(true);
  });

  it('collapses coincident pole stops instead of drawing across half the world', () => {
    const points = [
      { longitude: 0, latitude: 90 },
      { longitude: 180, latitude: 90 },
    ];
    const globeStops = createGeodesicChapterStopCoordinates(points, {
      projection: 'globe',
    });
    const globeRoute = createGeodesicChapterRoute(points, {
      projection: 'globe',
    });
    const mercatorStops = createGeodesicChapterStopCoordinates(points, {
      projection: 'mercator',
    });
    const mercatorRoute = createGeodesicChapterRoute(points, {
      projection: 'mercator',
    });

    expect(globeStops).toEqual(mercatorStops);
    expect(globeRoute).toEqual(globeStops);
    expect(mercatorRoute).toEqual(mercatorStops);
    expect(new Set(mercatorRoute.map(([longitude]) => longitude))).toEqual(
      new Set([0]),
    );
    mercatorRoute.forEach(([, latitude]) => {
      expect(latitude).toBeCloseTo(85.0451287798066, 10);
    });
  });

  it('anchors a pole stop to its nearby leg without a longitude sweep', () => {
    const points = [
      { longitude: 0, latitude: 90 },
      { longitude: 120, latitude: 80 },
    ];
    const globeRoute = createGeodesicChapterRoute(points, {
      projection: 'globe',
    });
    const mercatorRoute = createGeodesicChapterRoute(points, {
      projection: 'mercator',
    });

    expect(globeRoute[0][0]).toBe(120);
    expect(globeRoute[0][1]).toBeCloseTo(85.0451287798066, 10);
    expect(globeRoute.at(-1)).toEqual([120, 80]);
    expect(
      globeRoute.every(([longitude]) => Math.abs(longitude - 120) < 1e-10),
    ).toBe(true);
    expect(mercatorRoute[0][0]).toBe(120);
    expect(mercatorRoute.at(-1)).toEqual([120, 80]);
    expect(
      mercatorRoute.every(
        ([longitude, latitude]) =>
          Number.isFinite(longitude) &&
          Number.isFinite(latitude) &&
          Math.abs(longitude - 120) < 1e-10 &&
          Math.abs(latitude) <= 85.0511287798066,
      ),
    ).toBe(true);
  });

  it.each(['globe', 'mercator'] as const)(
    'shares renderer-safe polar stop coordinates on %s without changing saved locations',
    (projection) => {
      const points = [
        { longitude: 120, latitude: 90 },
        { longitude: 120, latitude: 88 },
        { longitude: 120, latitude: 80 },
        { longitude: 120, latitude: -88 },
        { longitude: 120, latitude: -90 },
      ];
      const savedPoints = points.map((point) => ({ ...point }));
      const stops = createGeodesicChapterStopCoordinates(points, {
        projection,
      });
      const segments = createGeodesicChapterRouteSegments(points, {
        projection,
      });

      expect(stops.map(([, latitude]) => latitude)).toEqual([
        85.0451287798066, 85.0451287798066, 80, -85.0451287798066,
        -85.0451287798066,
      ]);
      segments.forEach((segment, index) => {
        expect(segment.coordinates[0]).toEqual(stops[index]);
        expect(segment.coordinates.at(-1)).toEqual(stops[index + 1]);
      });
      stops.forEach(([, latitude]) => {
        const sine = Math.sin((latitude * Math.PI) / 180);
        const tileY = Math.round(
          (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * 8192,
        );
        expect(tileY).toBeGreaterThan(0);
        expect(tileY).toBeLessThan(8192);
      });
      expect(points).toEqual(savedPoints);
    },
  );

  it('keeps downstream world copies consistent after a pole at the date line', () => {
    const points = [
      { longitude: 0, latitude: 70 },
      { longitude: 180, latitude: 90 },
      { longitude: -170, latitude: 70 },
    ];

    for (const projection of ['globe', 'mercator'] as const) {
      const stops = createGeodesicChapterStopCoordinates(points, {
        projection,
      });
      const segments = createGeodesicChapterRouteSegments(points, {
        projection,
      });

      expect(stops.map(([longitude]) => longitude)).toEqual([0, -85, -170]);
      segments.forEach((segment, index) => {
        expect(segment.coordinates[0]).toEqual(stops[index]);
        expect(segment.coordinates.at(-1)).toEqual(stops[index + 1]);
        expect(
          segment.coordinates
            .slice(1)
            .every(
              ([longitude], coordinateIndex) =>
                Math.abs(longitude - segment.coordinates[coordinateIndex][0]) <=
                (projection === 'mercator' ? 2.0000001 : 180),
            ),
        ).toBe(true);
      });
    }
  });

  it('chooses the requested unwrapped side for exact antipodes', () => {
    const eastward = createGeodesicChapterRoute([
      { longitude: 0, latitude: 0 },
      { longitude: 180, latitude: 0 },
    ]);
    const westward = createGeodesicChapterRoute([
      { longitude: 0, latitude: 0 },
      { longitude: -180, latitude: 0 },
    ]);

    expect(eastward.at(-1)).toEqual([180, 0]);
    expect(westward.at(-1)).toEqual([-180, 0]);
    expect(eastward[1][0]).toBeGreaterThan(0);
    expect(westward[1][0]).toBeLessThan(0);
    expect([...eastward, ...westward].flat().every(Number.isFinite)).toBe(true);
  });
});
