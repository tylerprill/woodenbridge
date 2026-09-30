import { groupNearbyMapMarkers } from '@/app/lib/maps/marker-groups';

describe('journey marker groups', () => {
  it('groups exact and boundary-distance points with the default distance', () => {
    expect(
      groupNearbyMapMarkers([
        { x: 0, y: 0 },
        { x: 0, y: 0 },
        { x: 48, y: 0 },
      ]),
    ).toEqual([[0, 1, 2]]);
  });

  it('leaves isolated points in input order', () => {
    expect(
      groupNearbyMapMarkers(
        [
          { x: 0, y: 0 },
          { x: 50, y: 0 },
          { x: 0, y: 50 },
        ],
        49,
      ),
    ).toEqual([[0], [1], [2]]);
  });

  it('groups diagonal neighbors whose square hit targets would overlap', () => {
    expect(
      groupNearbyMapMarkers(
        [
          { x: 0, y: 0 },
          { x: 35, y: 35 },
        ],
        48,
      ),
    ).toEqual([[0, 1]]);
  });

  it('does not collapse a proximity chain into one wide group', () => {
    expect(
      groupNearbyMapMarkers(
        [
          { x: 0, y: 0 },
          { x: 40, y: 0 },
          { x: 80, y: 0 },
        ],
        48,
      ),
    ).toEqual([[0, 1], [2]]);
  });

  it('keeps rendered group representatives outside the collision distance', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 48, y: 0 },
      { x: 60, y: 0 },
    ];
    const groups = groupNearbyMapMarkers(points, 48);

    expect(groups).toEqual([[0, 1], [2]]);
    expect(
      Math.abs(points[groups[0][0]].x - points[groups[1][0]].x),
    ).toBeGreaterThan(48);
  });

  it('groups non-contiguous indices while preserving group and member order', () => {
    expect(
      groupNearbyMapMarkers(
        [
          { x: 0, y: 0 },
          { x: 100, y: 0 },
          { x: 10, y: 0 },
          { x: 110, y: 0 },
        ],
        12,
      ),
    ).toEqual([
      [0, 2],
      [1, 3],
    ]);
  });

  it('condenses a dense 24-stop mobile route without losing stop coverage', () => {
    const groups = groupNearbyMapMarkers(
      Array.from({ length: 24 }, (_, index) => ({
        x: index * 8,
        y: 120,
      })),
      72,
    );

    expect(groups).toEqual([
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
      [10, 11, 12, 13, 14, 15, 16, 17, 18, 19],
      [20, 21, 22, 23],
    ]);
    expect(groups.flat()).toEqual(
      Array.from({ length: 24 }, (_, index) => index),
    );
  });

  it('keeps coincident points in separate visibility partitions', () => {
    expect(
      groupNearbyMapMarkers(
        [
          { x: 10, y: 20 },
          { x: 10, y: 20 },
          { x: 12, y: 20 },
        ],
        48,
        ['visible', 'occluded', 'visible'],
      ),
    ).toEqual([[0, 2], [1]]);
  });

  it('returns no groups when there are no markers', () => {
    expect(groupNearbyMapMarkers([])).toEqual([]);
  });
});
