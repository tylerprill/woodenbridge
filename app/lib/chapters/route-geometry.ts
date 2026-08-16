type RoutePoint = {
  latitude: number;
  longitude: number;
};

export type ChapterCoordinate = [longitude: number, latitude: number];

const CURVE_STRENGTH = 0.075;
const CURVE_STEPS = 18;

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
  const controlX =
    (startX + endX) / 2 - deltaY * CURVE_STRENGTH * direction;
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
