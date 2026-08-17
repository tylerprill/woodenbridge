import {
  createChapterMarkerOffsets,
  createGentleChapterRoute,
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
});
