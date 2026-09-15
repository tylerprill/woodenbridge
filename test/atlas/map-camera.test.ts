import { mat4, vec4 } from 'gl-matrix';
import { createGeodesicChapterRoute } from '@/app/lib/chapters/route-geometry';
import {
  alignCoordinatesToMinimalLongitudeEnvelope,
  getAtlasFitPadding,
  getAtlasFocusPadding,
  getAtlasJourneyFitPadding,
  getAtlasJourneyFocusPadding,
  getAtlasJourneyGlobeFitZoomLimit,
  type AtlasMapCoordinate,
  type AtlasMapPadding,
} from '@/components/atlas/atlas-map-camera';

const VERTICAL_FOV_DEGREES = 36.86989764584402;
const MAX_CENTER_LATITUDE = 85.0511287798066;
const radians = (degrees: number) => (degrees * Math.PI) / 180;

function mercatorY(latitude: number) {
  const safeLatitude = Math.min(
    MAX_CENTER_LATITUDE,
    Math.max(-MAX_CENTER_LATITUDE, latitude),
  );
  return (
    (1 -
      Math.log(Math.tan(Math.PI / 4 + radians(safeLatitude) / 2)) / Math.PI) /
    2
  );
}

function boundsCandidateCenter(
  coordinates: readonly AtlasMapCoordinate[],
): AtlasMapCoordinate {
  const longitudes = coordinates.map(([longitude]) => longitude);
  const latitudes = coordinates.map(([, latitude]) => latitude);
  const centerY =
    (mercatorY(Math.min(...latitudes)) + mercatorY(Math.max(...latitudes))) / 2;
  return [
    (Math.min(...longitudes) + Math.max(...longitudes)) / 2,
    (360 / Math.PI) * Math.atan(Math.exp((1 - 2 * centerY) * Math.PI)) - 90,
  ];
}

// Independently build MapLibre's globe view/projection matrix. Comparing its
// projected points against the cap catches axis, latitude, FOV and inset errors
// without restating the implementation's radius-limit algebra in assertions.
function globeProjection(
  width: number,
  height: number,
  padding: AtlasMapPadding,
  center: AtlasMapCoordinate,
  zoom: number,
  verticalFovDegrees = VERTICAL_FOV_DEGREES,
) {
  const centerLatitude = Math.min(
    MAX_CENTER_LATITUDE,
    Math.max(-MAX_CENTER_LATITUDE, center[1]),
  );
  const distance = height / (2 * Math.tan(radians(verticalFovDegrees) / 2));
  const radius =
    (512 * 2 ** zoom) / (2 * Math.PI * Math.cos(radians(centerLatitude)));
  const matrix = mat4.create();
  mat4.perspective(
    matrix,
    radians(verticalFovDegrees),
    width / height,
    0.5,
    distance + 2 * radius,
  );
  matrix[8] = -(padding.left - padding.right) / width;
  matrix[9] = (padding.top - padding.bottom) / height;
  mat4.translate(matrix, matrix, [0, 0, -distance]);
  mat4.translate(matrix, matrix, [0, 0, -radius]);
  mat4.rotateX(matrix, matrix, radians(centerLatitude));
  mat4.rotateY(matrix, matrix, -radians(center[0]));
  mat4.scale(matrix, matrix, [radius, radius, radius]);

  return ([longitude, latitude]: AtlasMapCoordinate) => {
    const longitudeRadians = radians(longitude);
    const latitudeRadians = radians(latitude);
    const projected = vec4.transformMat4(
      vec4.create(),
      [
        Math.sin(longitudeRadians) * Math.cos(latitudeRadians),
        Math.sin(latitudeRadians),
        Math.cos(longitudeRadians) * Math.cos(latitudeRadians),
        1,
      ],
      matrix,
    );
    const centerDot =
      Math.sin(latitudeRadians) * Math.sin(radians(centerLatitude)) +
      Math.cos(latitudeRadians) *
        Math.cos(longitudeRadians - radians(center[0])) *
        Math.cos(radians(centerLatitude));
    return {
      x: ((projected[0] / projected[3] + 1) * width) / 2,
      y: ((1 - projected[1] / projected[3]) * height) / 2,
      visible: centerDot >= radius / (radius + distance),
    };
  };
}

function expectGlobeRouteInsideInset(
  coordinates: readonly AtlasMapCoordinate[],
  width: number,
  height: number,
  padding: AtlasMapPadding,
  center: AtlasMapCoordinate,
  zoom: number,
  verticalFovDegrees = VERTICAL_FOV_DEGREES,
) {
  const project = globeProjection(
    width,
    height,
    padding,
    center,
    zoom,
    verticalFovDegrees,
  );
  for (const coordinate of coordinates) {
    const point = project(coordinate);
    expect(point.x).toBeGreaterThanOrEqual(padding.left - 0.001);
    expect(point.x).toBeLessThanOrEqual(width - padding.right + 0.001);
    expect(point.y).toBeGreaterThanOrEqual(padding.top - 0.001);
    expect(point.y).toBeLessThanOrEqual(height - padding.bottom + 0.001);
    expect(point.visible).toBe(true);
  }
}

describe('Atlas map camera longitude alignment', () => {
  it('preserves ordinary coordinates and their latitudes', () => {
    const coordinates = [
      [-100, 42],
      [-90, -3],
      [-80, 11],
    ] as const;

    expect(alignCoordinatesToMinimalLongitudeEnvelope(coordinates)).toEqual(
      coordinates,
    );
  });

  it('fits a date-line crossing inside a two-degree envelope', () => {
    const aligned = alignCoordinatesToMinimalLongitudeEnvelope([
      [179, 10],
      [-179, 11],
    ]);
    const longitudes = aligned.map(([longitude]) => longitude);

    expect(Math.max(...longitudes) - Math.min(...longitudes)).toBe(2);
    expect(aligned.map(([, latitude]) => latitude)).toEqual([10, 11]);
  });

  it('aligns samples supplied from several longitude world copies', () => {
    const aligned = alignCoordinatesToMinimalLongitudeEnvelope([
      [539, 1],
      [541, 2],
      [-181, 3],
      [-179, 4],
      [180, 5],
    ]);
    const longitudes = aligned.map(([longitude]) => longitude);

    expect(Math.max(...longitudes) - Math.min(...longitudes)).toBe(2);
    expect(aligned.map(([, latitude]) => latitude)).toEqual([1, 2, 3, 4, 5]);
  });

  it('keeps an already compact noncanonical world copy unchanged', () => {
    expect(
      alignCoordinatesToMinimalLongitudeEnvelope([
        [539, 10],
        [541, 20],
      ]),
    ).toEqual([
      [539, 10],
      [541, 20],
    ]);
  });

  it('resolves equally small envelopes independently of sample order', () => {
    const forward = alignCoordinatesToMinimalLongitudeEnvelope([
      [179, 1],
      [-179, 2],
    ]);
    const reverse = alignCoordinatesToMinimalLongitudeEnvelope([
      [-179, 2],
      [179, 1],
    ]);

    expect(forward).toEqual([
      [-181, 1],
      [-179, 2],
    ]);
    expect(reverse).toEqual([
      [-179, 2],
      [-181, 1],
    ]);
  });

  it('preserves a linear 180-degree tie when it is already minimal', () => {
    expect(
      alignCoordinatesToMinimalLongitudeEnvelope([
        [0, -8],
        [180, 12],
      ]),
    ).toEqual([
      [0, -8],
      [180, 12],
    ]);
  });

  it('aligns the maximum Journey overview without exceeding argument limits', () => {
    // 100 Journeys with 50 stops can contribute 49 sampled legs apiece. At the
    // geodesic sampling ceiling that is roughly 440k camera coordinates.
    const maximumOverviewCoordinateCount = 100 * (49 * 90 + 1);
    const coordinates = Array.from(
      { length: maximumOverviewCoordinateCount },
      (_, index) => [index % 2 === 0 ? 179 : 181, (index % 160) - 80] as const,
    );

    const aligned = alignCoordinatesToMinimalLongitudeEnvelope(coordinates);
    const [west, east] = aligned.reduce(
      ([minimum, maximum], [longitude]) => [
        Math.min(minimum, longitude),
        Math.max(maximum, longitude),
      ],
      [Infinity, -Infinity],
    );

    expect(aligned).toHaveLength(maximumOverviewCoordinateCount);
    expect(east - west).toBe(2);
    expect(aligned[0]).toEqual([179, -80]);
    expect(aligned.at(-1)).toEqual(coordinates.at(-1));
  });
});

describe('Atlas globe Journey fit limit', () => {
  it('fits every global route sample beside a rail wider than half the canvas', () => {
    const coordinates = createGeodesicChapterRoute([
      { longitude: -75.1652, latitude: 39.9526 },
      { longitude: 76.8897, latitude: 43.2389 },
      { longitude: 18.4241, latitude: -33.9249 },
    ]);
    const padding = getAtlasJourneyFitPadding(901, 700);
    const center = boundsCandidateCenter(coordinates);
    const limit = getAtlasJourneyGlobeFitZoomLimit(
      coordinates,
      901,
      700,
      padding,
      center,
      VERTICAL_FOV_DEGREES,
    );

    expect(padding.left).toBeGreaterThan(901 / 2);
    expect(limit).toBeGreaterThan(-2);
    expect(limit).toBeLessThan(1.4175); // Unpadded globe refinement clipped both outer stops.
    expectGlobeRouteInsideInset(coordinates, 901, 700, padding, center, limit);
  });

  it('corrects a poleward front-side route that a Mercator estimate over-zooms', () => {
    const coordinates = createGeodesicChapterRoute([
      { longitude: 0, latitude: -65 },
      { longitude: 140, latitude: -65 },
    ]);
    const padding = getAtlasJourneyFitPadding(901, 700);
    const center = boundsCandidateCenter(coordinates);
    const mercatorEstimate = Math.log2(
      (901 - padding.left - padding.right) / ((140 / 360) * 512),
    );
    const projectOverZoomed = globeProjection(
      901,
      700,
      padding,
      center,
      mercatorEstimate,
    );
    expect(
      coordinates.some((coordinate) => {
        const point = projectOverZoomed(coordinate);
        return point.x < padding.left || point.x > 901 - padding.right;
      }),
    ).toBe(true);
    const limit = getAtlasJourneyGlobeFitZoomLimit(
      coordinates,
      901,
      700,
      padding,
      center,
      VERTICAL_FOV_DEGREES,
    );

    expect(limit).toBeLessThan(mercatorEstimate);
    expectGlobeRouteInsideInset(coordinates, 901, 700, padding, center, limit);
  });

  it('caps interior route samples even when both endpoints are at the camera center', () => {
    const center = [10, 20] as const;
    const endpoints = [center, center];
    const coordinates = [center, [45, 60] as const, center];
    const padding = getAtlasJourneyFitPadding(901, 700);
    const endpointLimit = getAtlasJourneyGlobeFitZoomLimit(
      endpoints,
      901,
      700,
      padding,
      center,
      VERTICAL_FOV_DEGREES,
    );
    const limit = getAtlasJourneyGlobeFitZoomLimit(
      coordinates,
      901,
      700,
      padding,
      center,
      VERTICAL_FOV_DEGREES,
    );

    expect(endpointLimit).toBe(8.5);
    expect(limit).toBeLessThan(endpointLimit);
    expectGlobeRouteInsideInset(coordinates, 901, 700, padding, center, limit);
  });

  it('fits a true over-pole geodesic with finite bounds', () => {
    const coordinates = createGeodesicChapterRoute([
      { longitude: 0, latitude: 80 },
      { longitude: 180, latitude: 80 },
    ]);
    const padding = getAtlasJourneyFitPadding(901, 700);
    const center = boundsCandidateCenter(coordinates);
    const limit = getAtlasJourneyGlobeFitZoomLimit(
      coordinates,
      901,
      700,
      padding,
      center,
      VERTICAL_FOV_DEGREES,
    );

    expect(Number.isFinite(limit)).toBe(true);
    expect(
      Math.max(...coordinates.map(([, latitude]) => latitude)),
    ).toBeGreaterThan(89);
    expectGlobeRouteInsideInset(coordinates, 901, 700, padding, center, limit);
  });

  it('includes exact-pole sample latitudes rather than flattening them to the center cap', () => {
    const center = [0, MAX_CENTER_LATITUDE] as const;
    const coordinates = [center, [0, 90] as const, center];
    const padding = { top: 250, right: 0, bottom: 250, left: 0 };
    const limit = getAtlasJourneyGlobeFitZoomLimit(
      coordinates,
      400,
      700,
      padding,
      center,
      VERTICAL_FOV_DEGREES,
    );

    expect(limit).toBeLessThan(8.5);
    expectGlobeRouteInsideInset(coordinates, 400, 700, padding, center, limit);
    expect(
      getAtlasJourneyGlobeFitZoomLimit(
        coordinates,
        400,
        700,
        padding,
        [0, 90],
        VERTICAL_FOV_DEGREES,
      ),
    ).toBeCloseTo(limit, 12);
  });

  it('respects the public field of view and equivalent longitude world copies', () => {
    const coordinates = [
      [-45, 0],
      [45, 0],
    ] as const;
    const center = [0, 0] as const;
    const padding = getAtlasJourneyFitPadding(901, 700);
    const limits = [30, 75].map((fov) => {
      const limit = getAtlasJourneyGlobeFitZoomLimit(
        coordinates,
        901,
        700,
        padding,
        center,
        fov,
      );
      expectGlobeRouteInsideInset(
        coordinates,
        901,
        700,
        padding,
        center,
        limit,
        fov,
      );
      return limit;
    });
    expect(limits[1]).toBeGreaterThan(limits[0]);
    expect(
      getAtlasJourneyGlobeFitZoomLimit(
        [
          [315, 0],
          [405, 0],
        ],
        901,
        700,
        padding,
        [360, 0],
        30,
      ),
    ).toBeCloseTo(limits[0], 12);
  });

  it('keeps front-side samples visible instead of only testing their screen positions', () => {
    const coordinates = [[88, 0]] as const;
    const center = [0, 0] as const;
    const padding = { top: 0, right: 0, bottom: 0, left: 0 };
    const limit = getAtlasJourneyGlobeFitZoomLimit(
      coordinates,
      1440,
      900,
      padding,
      center,
      VERTICAL_FOV_DEGREES,
    );

    expectGlobeRouteInsideInset(coordinates, 1440, 900, padding, center, limit);
    expect(
      globeProjection(1440, 900, padding, center, limit + 0.001)(coordinates[0])
        .visible,
    ).toBe(false);
  });

  it('uses the latitude-compensated floor for a narrow exposed polar region', () => {
    const center = [0, MAX_CENTER_LATITUDE] as const;
    const coordinates = [center, [0, 70] as const];
    const padding = { top: 335, right: 0, bottom: 335, left: 0 };
    const limit = getAtlasJourneyGlobeFitZoomLimit(
      coordinates,
      400,
      700,
      padding,
      center,
      VERTICAL_FOV_DEGREES,
    );

    expect(limit).toBeLessThan(-2);
    expect(limit).toBeGreaterThan(-2 + Math.log2(Math.cos(radians(center[1]))));
    expectGlobeRouteInsideInset(coordinates, 400, 700, padding, center, limit);
    expect(
      globeProjection(400, 700, padding, center, -2)(coordinates[1]).y,
    ).toBeGreaterThan(700 - padding.bottom);
  });

  it('fits the whole globe for hemisphere-spanning polar or antipodal inputs', () => {
    const padding = getAtlasJourneyFitPadding(320, 568);
    for (const coordinates of [
      [
        [0, -90],
        [180, 90],
      ],
      [
        [0, 0],
        [180, 0],
      ],
    ] as const) {
      const limit = getAtlasJourneyGlobeFitZoomLimit(
        coordinates,
        320,
        568,
        padding,
        [0, 0],
        VERTICAL_FOV_DEGREES,
      );
      const radius = (512 * 2 ** limit) / (2 * Math.PI);
      const distance = 568 / (2 * Math.tan(radians(VERTICAL_FOV_DEGREES) / 2));
      const apparentRadius =
        (distance * radius) / Math.sqrt(distance ** 2 + 2 * distance * radius);

      expect(limit).toBeGreaterThan(-2);
      expect(apparentRadius).toBeCloseTo(63, 10);
    }
  });

  it('keeps a world Journey substantial and fits its complete globe beside the 901px rail', () => {
    const center = [17, 38] as const;
    const padding = getAtlasJourneyFitPadding(901, 700);
    const coordinates = [
      [17, 38],
      [197, -38],
      [45, 25],
    ] as const;
    const limit = getAtlasJourneyGlobeFitZoomLimit(
      coordinates,
      901,
      700,
      padding,
      center,
      VERTICAL_FOV_DEGREES,
    );
    const radius =
      (512 * 2 ** limit) / (2 * Math.PI * Math.cos(radians(center[1])));
    const distance = 700 / (2 * Math.tan(radians(VERTICAL_FOV_DEGREES) / 2));
    const apparentRadius =
      (distance * radius) / Math.sqrt(distance ** 2 + 2 * distance * radius);
    const project = globeProjection(901, 700, padding, center, limit);

    expect(apparentRadius).toBeCloseTo(127.5, 10);
    expect(apparentRadius * 2).toBeGreaterThan(200);
    expect(project(coordinates[1]).visible).toBe(false);
    // Check the whole surface geometrically, without claiming back-side
    // samples become visible. Independent globe matrices include the inset.
    for (let longitude = -180; longitude < 180; longitude += 10) {
      for (let latitude = -90; latitude <= 90; latitude += 10) {
        const point = project([longitude, latitude]);
        expect(point.x).toBeGreaterThanOrEqual(padding.left - 0.001);
        expect(point.x).toBeLessThanOrEqual(901 - padding.right + 0.001);
        expect(point.y).toBeGreaterThanOrEqual(padding.top - 0.001);
        expect(point.y).toBeLessThanOrEqual(700 - padding.bottom + 0.001);
      }
    }
    expect(
      getAtlasJourneyGlobeFitZoomLimit(
        [...coordinates].reverse(),
        901,
        700,
        padding,
        center,
        VERTICAL_FOV_DEGREES,
      ),
    ).toBeCloseTo(limit, 12);
  });

  it('retains the tight normal-route cap instead of always fitting the full planet', () => {
    const padding = getAtlasJourneyFitPadding(901, 700);
    const coordinates = [
      [-45, 0],
      [45, 0],
    ] as const;
    const distance = 700 / (2 * Math.tan(radians(VERTICAL_FOV_DEGREES) / 2));
    const allowedRadius =
      (127.5 * distance) /
      (Math.sin(radians(45)) * distance - 127.5 * (1 - Math.cos(radians(45))));
    const expected = Math.log2((allowedRadius * 2 * Math.PI) / 512);
    const limit = getAtlasJourneyGlobeFitZoomLimit(
      coordinates,
      901,
      700,
      padding,
      [0, 0],
      VERTICAL_FOV_DEGREES,
    );

    expect(limit).toBeCloseTo(expected, 12);
    expectGlobeRouteInsideInset(coordinates, 901, 700, padding, [0, 0], limit);
  });

  it('keeps the full-globe fit latitude-compensated near a pole', () => {
    const center = [0, MAX_CENTER_LATITUDE] as const;
    const padding = getAtlasJourneyFitPadding(901, 700);
    const limit = getAtlasJourneyGlobeFitZoomLimit(
      [center, [180, -MAX_CENTER_LATITUDE]],
      901,
      700,
      padding,
      center,
      VERTICAL_FOV_DEGREES,
    );
    const radius =
      (512 * 2 ** limit) / (2 * Math.PI * Math.cos(radians(center[1])));
    const distance = 700 / (2 * Math.tan(radians(VERTICAL_FOV_DEGREES) / 2));

    expect(limit).toBeLessThan(-2);
    expect(limit).toBeGreaterThan(-2 + Math.log2(Math.cos(radians(center[1]))));
    expect(
      (distance * radius) / Math.sqrt(distance ** 2 + 2 * distance * radius),
    ).toBeCloseTo(127.5, 10);
  });

  it('retains the close-route zoom ceiling for coincident stops', () => {
    expect(
      getAtlasJourneyGlobeFitZoomLimit(
        [
          [10, 20],
          [10, 20],
        ],
        1440,
        900,
        getAtlasJourneyFitPadding(1440, 900),
        [10, 20],
        VERTICAL_FOV_DEGREES,
      ),
    ).toBe(8.5);
    expect(
      getAtlasJourneyGlobeFitZoomLimit(
        [],
        0,
        0,
        getAtlasJourneyFitPadding(0, 0),
        [0, 0],
        VERTICAL_FOV_DEGREES,
      ),
    ).toBe(8.5);
  });

  it('never leaks non-finite zooms from malformed data or transition dimensions', () => {
    const padding = getAtlasJourneyFitPadding(901, 700);
    const cases: Array<{
      coordinates: AtlasMapCoordinate[];
      width: number;
      height: number;
      center: AtlasMapCoordinate;
      fov: number;
    }> = [
      {
        coordinates: [[NaN, 0]],
        width: 901,
        height: 700,
        center: [0, 0],
        fov: VERTICAL_FOV_DEGREES,
      },
      {
        coordinates: [
          [180, 0],
          [NaN, 0],
        ],
        width: 901,
        height: 700,
        center: [0, 0],
        fov: VERTICAL_FOV_DEGREES,
      },
      {
        coordinates: [[45, 0]],
        width: NaN,
        height: 700,
        center: [0, 0],
        fov: VERTICAL_FOV_DEGREES,
      },
      {
        coordinates: [[45, 0]],
        width: 901,
        height: 0,
        center: [0, 0],
        fov: VERTICAL_FOV_DEGREES,
      },
      {
        coordinates: [[45, 0]],
        width: 901,
        height: 700,
        center: [Infinity, 0],
        fov: VERTICAL_FOV_DEGREES,
      },
      {
        coordinates: [[45, 0]],
        width: 901,
        height: 700,
        center: [0, NaN],
        fov: VERTICAL_FOV_DEGREES,
      },
      {
        coordinates: [[45, 0]],
        width: 901,
        height: 700,
        center: [0, 0],
        fov: NaN,
      },
    ];
    for (const testCase of cases) {
      expect(
        getAtlasJourneyGlobeFitZoomLimit(
          testCase.coordinates,
          testCase.width,
          testCase.height,
          padding,
          testCase.center,
          testCase.fov,
        ),
      ).toBe(-2);
    }
  });
});

describe('Atlas map camera padding', () => {
  it('fits safely inside the compact mobile journey map', () => {
    const padding = getAtlasFitPadding(320, 256);

    expect(padding).toEqual({
      top: 41,
      right: 38,
      bottom: 72,
      left: 38,
    });
    expect(padding.left + padding.right).toBeLessThan(320);
    expect(padding.top + padding.bottom).toBeLessThan(256);
  });

  it('preserves generous editorial padding on a desktop map', () => {
    expect(getAtlasFitPadding(1000, 752)).toEqual({
      top: 120,
      right: 120,
      bottom: 140,
      left: 120,
    });
  });

  it('never produces invalid padding for a zero-size transition frame', () => {
    expect(getAtlasFitPadding(0, 0)).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });
  });

  it('uses compact focus padding that stays inside a phone canvas', () => {
    const padding = getAtlasFocusPadding(320, 568);

    expect(padding).toEqual({
      top: 91,
      right: 38,
      bottom: 140,
      left: 38,
    });
    expect(padding.left + padding.right).toBeLessThan(320);
    expect(padding.top + padding.bottom).toBeLessThan(568);
  });

  it('preserves room for the desktop memory drawer when focusing a pin', () => {
    expect(getAtlasFocusPadding(1000, 752)).toEqual({
      top: 90,
      right: 360,
      bottom: 80,
      left: 80,
    });
  });

  it('preserves room for the left Journey panel when focusing a stop', () => {
    expect(getAtlasJourneyFocusPadding(1000, 752)).toEqual({
      top: 90,
      right: 64,
      bottom: 80,
      left: 538,
    });
  });

  it('preserves room for the compact Journey bottom sheet', () => {
    expect(getAtlasJourneyFocusPadding(390, 756)).toEqual({
      top: 45,
      right: 47,
      bottom: 484,
      left: 47,
    });
  });

  it('reserves the taller portrait playback sheet without changing regular stop focus', () => {
    expect(getAtlasJourneyFocusPadding(390, 756, true)).toEqual({
      top: 56,
      right: 47,
      bottom: 600,
      left: 47,
    });
    expect(getAtlasJourneyFocusPadding(390, 756, false)).toEqual(
      getAtlasJourneyFocusPadding(390, 756),
    );
  });

  it.each([568, 480])(
    'keeps the entire active pin above the playback sheet on a 320px-wide %ipx canvas',
    (height) => {
      const padding = getAtlasJourneyFocusPadding(320, height, true);
      const markerCenter = (padding.top + height - padding.bottom) / 2;
      const sheetTop = height * (1 - 0.76) - 8.8;

      expect(padding.top).toBe(56);
      expect(padding.bottom).toBe(Math.round(height * 0.78) + 10);
      expect(markerCenter - 22).toBeGreaterThan(0);
      expect(markerCenter + 22).toBeLessThan(sheetTop);
      expect(padding.top + padding.bottom).toBeLessThanOrEqual(height - 2);
    },
  );

  it.each([
    [901, 700],
    [768, 1024],
    [915, 412],
    [852, 393],
  ])(
    'does not alter desktop/tablet/landscape playback padding at %ix%i',
    (width, height) => {
      expect(getAtlasJourneyFocusPadding(width, height, true)).toEqual(
        getAtlasJourneyFocusPadding(width, height),
      );
    },
  );

  it.each([
    [0, 0],
    [1, 1],
    [2, 2],
    [3, 4],
    [320, 60],
  ])(
    'keeps playback padding valid during a %ix%i transition',
    (width, height) => {
      const padding = getAtlasJourneyFocusPadding(width, height, true);
      expect(padding.left + padding.right).toBeLessThanOrEqual(
        Math.max(0, width - 2),
      );
      expect(padding.top + padding.bottom).toBeLessThanOrEqual(
        Math.max(0, height - 2),
      );
    },
  );

  it('adds a complete-dot inset for narrow multi-stop fits without changing focus padding', () => {
    expect(getAtlasJourneyFitPadding(320, 568)).toEqual({
      top: 56,
      right: 60,
      bottom: 386,
      left: 60,
    });
    expect(getAtlasJourneyFocusPadding(320, 568)).toEqual({
      top: 34,
      right: 38,
      bottom: 364,
      left: 38,
    });
  });

  it.each([
    [0, 0],
    [1, 1],
    [2, 2],
    [3, 4],
    [12, 15],
    [320, 100],
  ])(
    'keeps marker fit insets valid during a %ix%i transition',
    (width, height) => {
      const padding = getAtlasJourneyFitPadding(width, height);
      expect(padding.left + padding.right).toBeLessThanOrEqual(
        Math.max(0, width - 2),
      );
      expect(padding.top + padding.bottom).toBeLessThanOrEqual(
        Math.max(0, height - 2),
      );
      expect(
        Object.values(padding).every(
          (inset) => Number.isFinite(inset) && inset >= 0,
        ),
      ).toBe(true);
    },
  );

  it('preserves room for the Journey rail in short landscape', () => {
    expect(getAtlasJourneyFocusPadding(611, 412)).toEqual({
      top: 90,
      right: 386,
      bottom: 80,
      left: 48,
    });
  });

  it('keeps focus padding valid through a zero-size resize frame', () => {
    expect(getAtlasFocusPadding(0, 0)).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });
  });
});
