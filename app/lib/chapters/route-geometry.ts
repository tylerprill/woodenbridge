type RoutePoint = {
  latitude: number;
  longitude: number;
};

export type ChapterCoordinate = [longitude: number, latitude: number];

export type ChapterRouteProjection = 'globe' | 'mercator';

export type GeodesicChapterRouteOptions = {
  projection?: ChapterRouteProjection;
};

const CURVE_STRENGTH = 0.075;
const CURVE_STEPS = 18;
const DEGREES_TO_RADIANS = Math.PI / 180;
const RADIANS_TO_DEGREES = 180 / Math.PI;
const STORED_COORDINATE_PRECISION_DEGREES = 1e-5;
const GEODESIC_ANTIPODAL_TIE_RADIANS =
  STORED_COORDINATE_PRECISION_DEGREES * 2 * DEGREES_TO_RADIANS;
const GEODESIC_MAX_STEP_RADIANS = 2 * DEGREES_TO_RADIANS;
const GEODESIC_MAX_STEPS = 96;
const GEODESIC_VECTOR_EPSILON = 1e-12;
const WEB_MERCATOR_MAX_LATITUDE = 85.0511287798066;
const MAPLIBRE_VISUAL_MAX_LATITUDE = WEB_MERCATOR_MAX_LATITUDE - 0.006;
const WEB_MERCATOR_MAX_LATITUDE_SINE = Math.sin(
  WEB_MERCATOR_MAX_LATITUDE * DEGREES_TO_RADIANS,
);
const MARKER_CLUSTER_DISTANCE = 8;
const MARKER_SEPARATION = 13;
const WORLD_ROUTE_LONGITUDE_SPAN = 120;
const WORLD_MARKER_CLUSTER_DISTANCE = 22;
const WORLD_MARKER_SEPARATION = 18;
const DEFAULT_GEODESIC_PROJECTION: ChapterRouteProjection = 'globe';

export type ChapterMarkerOffset = [x: number, y: number];

export type ChapterRouteSegment = {
  startIndex: number;
  endIndex: number;
  coordinates: ChapterCoordinate[];
};

export function unwrapChapterCoordinates(
  points: RoutePoint[],
): ChapterCoordinate[] {
  return points.reduce<ChapterCoordinate[]>((coordinates, point) => {
    let longitude = point.longitude;
    const previousLongitude = coordinates.at(-1)?.[0];
    if (previousLongitude !== undefined) {
      while (longitude - previousLongitude > 180) longitude -= 360;
      while (longitude - previousLongitude < -180) longitude += 360;
    }
    coordinates.push([longitude, point.latitude]);
    return coordinates;
  }, []);
}

function approximateCoordinateDistance(
  first: ChapterCoordinate,
  second: ChapterCoordinate,
) {
  const meanLatitude = ((first[1] + second[1]) / 2) * (Math.PI / 180);
  const longitudeScale = Math.max(Math.abs(Math.cos(meanLatitude)), 0.2);
  return Math.hypot(
    (first[0] - second[0]) * longitudeScale,
    first[1] - second[1],
  );
}

export function createChapterMarkerOffsets(
  points: RoutePoint[],
): ChapterMarkerOffset[] {
  const coordinates = unwrapChapterCoordinates(points);
  const offsets = coordinates.map<ChapterMarkerOffset>(() => [0, 0]);
  const remaining = new Set(coordinates.map((_, index) => index));
  const longitudes = coordinates.map(([longitude]) => longitude);
  const longitudeSpan = longitudes.length
    ? Math.max(...longitudes) - Math.min(...longitudes)
    : 0;
  const worldScale = longitudeSpan >= WORLD_ROUTE_LONGITUDE_SPAN;
  const clusterDistance = worldScale
    ? WORLD_MARKER_CLUSTER_DISTANCE
    : MARKER_CLUSTER_DISTANCE;
  const markerSeparation = worldScale
    ? WORLD_MARKER_SEPARATION
    : MARKER_SEPARATION;

  while (remaining.size) {
    const first = remaining.values().next().value as number;
    const cluster = [first];
    remaining.delete(first);

    for (let cursor = 0; cursor < cluster.length; cursor += 1) {
      const current = cluster[cursor];
      for (const candidate of Array.from(remaining)) {
        if (
          approximateCoordinateDistance(
            coordinates[current],
            coordinates[candidate],
          ) <= clusterDistance
        ) {
          cluster.push(candidate);
          remaining.delete(candidate);
        }
      }
    }

    if (cluster.length === 2) {
      offsets[cluster[0]] = [-markerSeparation, 0];
      offsets[cluster[1]] = [markerSeparation, 0];
      continue;
    }

    if (cluster.length > 2) {
      cluster.forEach((index, position) => {
        const angle = -Math.PI / 2 + (position / cluster.length) * Math.PI * 2;
        offsets[index] = [
          Math.round(Math.cos(angle) * markerSeparation),
          Math.round(Math.sin(angle) * markerSeparation),
        ];
      });
    }
  }

  if (worldScale) {
    const minimumLongitude = Math.min(...longitudes);
    const maximumLongitude = Math.max(...longitudes);

    coordinates.forEach(([longitude], index) => {
      if (longitude === minimumLongitude) {
        offsets[index] = [Math.max(0, offsets[index][0]), offsets[index][1]];
      }
      if (longitude === maximumLongitude) {
        offsets[index] = [Math.min(0, offsets[index][0]), offsets[index][1]];
      }
    });
  }

  return offsets;
}

function curvedSegment(
  start: ChapterCoordinate,
  end: ChapterCoordinate,
  reference: ChapterCoordinate | undefined,
) {
  const meanLatitude = ((start[1] + end[1]) / 2) * (Math.PI / 180);
  const longitudeScale = Math.max(Math.abs(Math.cos(meanLatitude)), 0.2);
  const startX = start[0] * longitudeScale;
  const endX = end[0] * longitudeScale;
  const deltaX = endX - startX;
  const deltaY = end[1] - start[1];
  const referenceX = reference ? reference[0] * longitudeScale : null;
  const referenceSide = reference
    ? deltaX * (reference[1] - start[1]) -
      deltaY * ((referenceX ?? startX) - startX)
    : 0;
  const direction = referenceSide > 0 ? -1 : 1;
  const controlX = (startX + endX) / 2 - deltaY * CURVE_STRENGTH * direction;
  const controlY =
    (start[1] + end[1]) / 2 + deltaX * CURVE_STRENGTH * direction;

  return Array.from({ length: CURVE_STEPS + 1 }, (_, step) => {
    const progress = step / CURVE_STEPS;
    const inverse = 1 - progress;
    const x =
      inverse * inverse * startX +
      2 * inverse * progress * controlX +
      progress * progress * endX;
    const latitude =
      inverse * inverse * start[1] +
      2 * inverse * progress * controlY +
      progress * progress * end[1];
    return [x / longitudeScale, latitude] satisfies ChapterCoordinate;
  });
}

type UnitVector = [x: number, y: number, z: number];

function coordinateToUnitVector(coordinate: ChapterCoordinate): UnitVector {
  const longitude = coordinate[0] * DEGREES_TO_RADIANS;
  const latitude = coordinate[1] * DEGREES_TO_RADIANS;
  const latitudeRadius = Math.cos(latitude);

  return [
    latitudeRadius * Math.cos(longitude),
    latitudeRadius * Math.sin(longitude),
    Math.sin(latitude),
  ];
}

function deterministicAntipodalTangent(
  start: ChapterCoordinate,
  longitudeDelta: number,
): UnitVector {
  const longitude = start[0] * DEGREES_TO_RADIANS;
  const direction = longitudeDelta < 0 ? -1 : 1;

  // Exact antipodes have infinitely many equally short routes. Following the
  // local east/west tangent gives us a stable answer while respecting which
  // unwrapped side of the world the endpoint occupies.
  return [-Math.sin(longitude) * direction, Math.cos(longitude) * direction, 0];
}

function unwrapLongitude(longitude: number, previousLongitude: number) {
  while (longitude - previousLongitude > 180) longitude -= 360;
  while (longitude - previousLongitude < -180) longitude += 360;
  return longitude;
}

function clampMercatorLatitude(latitude: number) {
  return Math.max(
    -WEB_MERCATOR_MAX_LATITUDE,
    Math.min(WEB_MERCATOR_MAX_LATITUDE, latitude),
  );
}

function mercatorLatitude(latitude: number) {
  const radians = clampMercatorLatitude(latitude) * DEGREES_TO_RADIANS;
  return Math.log(Math.tan(Math.PI / 4 + radians / 2));
}

function latitudeFromMercator(value: number) {
  return (2 * Math.atan(Math.exp(value)) - Math.PI / 2) * RADIANS_TO_DEGREES;
}

function isExactPole([, latitude]: ChapterCoordinate) {
  return Math.abs(latitude) === 90;
}

function canonicalizePoleLongitudes(stops: ChapterCoordinate[]) {
  const coordinates = stops.map<ChapterCoordinate>((coordinate) => [
    coordinate[0],
    coordinate[1],
  ]);
  let index = 0;

  while (index < coordinates.length) {
    if (!isExactPole(coordinates[index])) {
      index += 1;
      continue;
    }

    const firstPoleIndex = index;
    while (index < coordinates.length && isExactPole(coordinates[index])) {
      index += 1;
    }

    const previousLongitude = coordinates[firstPoleIndex - 1]?.[0];
    const nextLongitude = coordinates[index]?.[0];
    let canonicalLongitude = coordinates[firstPoleIndex][0];

    if (previousLongitude !== undefined && nextLongitude !== undefined) {
      const unwrappedNextLongitude = unwrapLongitude(
        nextLongitude,
        previousLongitude,
      );
      canonicalLongitude =
        previousLongitude + (unwrappedNextLongitude - previousLongitude) / 2;
    } else if (previousLongitude !== undefined) {
      canonicalLongitude = previousLongitude;
    } else if (nextLongitude !== undefined) {
      canonicalLongitude = nextLongitude;
    }

    for (let poleIndex = firstPoleIndex; poleIndex < index; poleIndex += 1) {
      coordinates[poleIndex][0] = canonicalLongitude;
    }
  }

  // Arbitrary stored pole longitudes may have selected a different world copy
  // during the initial unwrap. After canonicalizing them, align downstream
  // stops again so no leg jumps a whole world at its exact endpoint.
  for (
    let coordinateIndex = 1;
    coordinateIndex < coordinates.length;
    coordinateIndex += 1
  ) {
    coordinates[coordinateIndex][0] = unwrapLongitude(
      coordinates[coordinateIndex][0],
      coordinates[coordinateIndex - 1][0],
    );
  }

  return coordinates;
}

export function createGeodesicChapterStopCoordinates(
  points: RoutePoint[],
  _options: GeodesicChapterRouteOptions = {},
): ChapterCoordinate[] {
  const stops = canonicalizePoleLongitudes(unwrapChapterCoordinates(points));

  // MapLibre tiles GeoJSON through Web Mercator even on a globe, while DOM
  // markers can project the actual poles. Share visual coordinates to avoid
  // detached endpoints, keeping just inside the tile boundary so south-edge
  // circle vertices survive quantization and exclusion at y === extent.
  // This affects rendering only; the saved stop coordinates remain unchanged.
  return stops.map(([longitude, latitude]) => [
    longitude,
    Math.max(
      -MAPLIBRE_VISUAL_MAX_LATITUDE,
      Math.min(MAPLIBRE_VISUAL_MAX_LATITUDE, latitude),
    ),
  ]);
}

function projectionSafeSegment(
  start: ChapterCoordinate,
  end: ChapterCoordinate,
  minimumStepCount: number,
): ChapterCoordinate[] {
  const longitudeDelta = end[0] - start[0];
  const longitudeStepCount = Math.ceil(
    Math.abs(longitudeDelta) / (GEODESIC_MAX_STEP_RADIANS * RADIANS_TO_DEGREES),
  );
  const stepCount = Math.min(
    GEODESIC_MAX_STEPS,
    Math.max(1, minimumStepCount, longitudeStepCount),
  );
  const startMercatorLatitude = mercatorLatitude(start[1]);
  const endMercatorLatitude = mercatorLatitude(end[1]);
  const coordinates: ChapterCoordinate[] = [start];

  for (let step = 1; step < stepCount; step += 1) {
    const progress = step / stepCount;
    coordinates.push([
      start[0] + longitudeDelta * progress,
      latitudeFromMercator(
        startMercatorLatitude +
          (endMercatorLatitude - startMercatorLatitude) * progress,
      ),
    ]);
  }

  coordinates.push(end);
  return coordinates;
}

function geodesicExceedsMercatorLatitude(
  start: UnitVector,
  tangent: UnitVector,
  angle: number,
) {
  const exceedsLimit = (distance: number) =>
    Math.abs(start[2] * Math.cos(distance) + tangent[2] * Math.sin(distance)) >
    WEB_MERCATOR_MAX_LATITUDE_SINE;

  if (exceedsLimit(0) || exceedsLimit(angle)) return true;

  // z(d) = start.z*cos(d) + tangent.z*sin(d). Its extrema repeat every PI,
  // so checking the few extrema that can fall within this at-most-PI arc is
  // enough to catch even a very narrow crossing between sampled vertices.
  const firstExtremum = Math.atan2(tangent[2], start[2]);
  for (let offset = -2; offset <= 2; offset += 1) {
    const distance = firstExtremum + offset * Math.PI;
    if (distance > 0 && distance < angle && exceedsLimit(distance)) return true;
  }
  return false;
}

function geodesicSegment(
  start: ChapterCoordinate,
  end: ChapterCoordinate,
  projection: ChapterRouteProjection,
): ChapterCoordinate[] {
  const startVector = coordinateToUnitVector(start);
  const endVector = coordinateToUnitVector(end);
  const dot = Math.max(
    -1,
    Math.min(
      1,
      startVector[0] * endVector[0] +
        startVector[1] * endVector[1] +
        startVector[2] * endVector[2],
    ),
  );
  const tangentCandidate: UnitVector = [
    endVector[0] - startVector[0] * dot,
    endVector[1] - startVector[1] * dot,
    endVector[2] - startVector[2] * dot,
  ];
  const tangentMagnitude = Math.hypot(...tangentCandidate);
  const angle = Math.atan2(tangentMagnitude, dot);
  // Coordinates are persisted and compared at five decimal degrees in the
  // Atlas flows. Treat the last-place noise around an ambiguous antipode as a
  // tie so tiny import/geocoder changes cannot flip the route across Earth.
  const nearAntipodal = Math.PI - angle <= GEODESIC_ANTIPODAL_TIE_RADIANS;
  const interpolationAngle = nearAntipodal ? Math.PI : angle;
  const stepCount = Math.min(
    GEODESIC_MAX_STEPS,
    Math.max(1, Math.ceil(interpolationAngle / GEODESIC_MAX_STEP_RADIANS)),
  );

  if (stepCount === 1) return [start, end];

  const tangent =
    !nearAntipodal && tangentMagnitude > GEODESIC_VECTOR_EPSILON
      ? (tangentCandidate.map(
          (component) => component / tangentMagnitude,
        ) as UnitVector)
      : deterministicAntipodalTangent(start, end[0] - start[0]);
  const coordinates: ChapterCoordinate[] = [start];
  let previousLongitude = start[0];

  for (let step = 1; step < stepCount; step += 1) {
    const distance = interpolationAngle * (step / stepCount);
    const cosine = Math.cos(distance);
    const sine = Math.sin(distance);
    const x = startVector[0] * cosine + tangent[0] * sine;
    const y = startVector[1] * cosine + tangent[1] * sine;
    const z = startVector[2] * cosine + tangent[2] * sine;
    const magnitude = Math.hypot(x, y, z);
    const longitude = unwrapLongitude(
      Math.atan2(y, x) * RADIANS_TO_DEGREES,
      previousLongitude,
    );
    const latitude =
      Math.asin(Math.max(-1, Math.min(1, z / magnitude))) * RADIANS_TO_DEGREES;

    coordinates.push([longitude, latitude]);
    previousLongitude = longitude;
  }

  // Never let spherical floating-point math move a visible line endpoint away
  // from the exact unwrapped coordinate used by the corresponding map marker.
  coordinates.push(end);
  if (
    projection === 'mercator' &&
    geodesicExceedsMercatorLatitude(startVector, tangent, interpolationAngle)
  ) {
    // A surface geodesic can pass through a pole even when both stops are
    // safely projectable. At the Mercator latitude cap that path collapses
    // into a near-180-degree longitude jump. A straight line in Mercator
    // space is the stable fallback on compact maps, while exact endpoints and
    // the bounded sampling contract remain unchanged.
    return projectionSafeSegment(start, end, stepCount);
  }
  return coordinates;
}

export function createGeodesicChapterRoute(
  points: RoutePoint[],
  options: GeodesicChapterRouteOptions = {},
): ChapterCoordinate[] {
  const projection = options.projection ?? DEFAULT_GEODESIC_PROJECTION;
  const stops = createGeodesicChapterStopCoordinates(points, { projection });
  if (stops.length < 2) return stops;

  return createGeodesicChapterRouteSegmentsFromCoordinates(
    stops,
    projection,
  ).flatMap((segment, index) =>
    index === 0 ? segment.coordinates : segment.coordinates.slice(1),
  );
}

export function createGeodesicChapterRouteSegments(
  points: RoutePoint[],
  options: GeodesicChapterRouteOptions = {},
): ChapterRouteSegment[] {
  const projection = options.projection ?? DEFAULT_GEODESIC_PROJECTION;
  return createGeodesicChapterRouteSegmentsFromCoordinates(
    createGeodesicChapterStopCoordinates(points, { projection }),
    projection,
  );
}

function createGeodesicChapterRouteSegmentsFromCoordinates(
  stops: ChapterCoordinate[],
  projection: ChapterRouteProjection,
) {
  if (stops.length < 2) return [];

  return stops.flatMap<ChapterRouteSegment>((stop, index) => {
    const next = stops[index + 1];
    if (!next) return [];
    return [
      {
        startIndex: index,
        endIndex: index + 1,
        coordinates: geodesicSegment(stop, next, projection),
      },
    ];
  });
}

export function createGentleChapterRoute(
  points: RoutePoint[],
): ChapterCoordinate[] {
  const stops = unwrapChapterCoordinates(points);
  if (stops.length < 2) return stops;

  return createGentleChapterRouteSegmentsFromCoordinates(stops).flatMap(
    (segment, index) =>
      index === 0 ? segment.coordinates : segment.coordinates.slice(1),
  );
}

export function createGentleChapterRouteSegments(
  points: RoutePoint[],
): ChapterRouteSegment[] {
  return createGentleChapterRouteSegmentsFromCoordinates(
    unwrapChapterCoordinates(points),
  );
}

function createGentleChapterRouteSegmentsFromCoordinates(
  stops: ChapterCoordinate[],
) {
  if (stops.length < 2) return [];

  return stops.flatMap<ChapterRouteSegment>((stop, index) => {
    const next = stops[index + 1];
    if (!next) return [];
    const reference = index === 0 ? stops[2] : stops[index - 1];
    return [
      {
        startIndex: index,
        endIndex: index + 1,
        coordinates: curvedSegment(stop, next, reference),
      },
    ];
  });
}
