type RoutePoint = {
  latitude: number;
  longitude: number;
};

export type ChapterCoordinate = [longitude: number, latitude: number];

const CURVE_STRENGTH = 0.075;
const CURVE_STEPS = 18;
const MARKER_CLUSTER_DISTANCE = 8;
const MARKER_SEPARATION = 13;
const WORLD_ROUTE_LONGITUDE_SPAN = 120;
const WORLD_MARKER_CLUSTER_DISTANCE = 22;
const WORLD_MARKER_SEPARATION = 18;

export type ChapterMarkerOffset = [x: number, y: number];

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

export function createGentleChapterRoute(
  points: RoutePoint[],
): ChapterCoordinate[] {
  const stops = unwrapChapterCoordinates(points);
  if (stops.length < 2) return stops;

  return stops.flatMap((stop, index) => {
    const next = stops[index + 1];
    if (!next) return [];
    const reference = index === 0 ? stops[2] : stops[index - 1];
    const segment = curvedSegment(stop, next, reference);
    return index === 0 ? segment : segment.slice(1);
  });
}
