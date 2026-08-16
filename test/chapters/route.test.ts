import {
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
