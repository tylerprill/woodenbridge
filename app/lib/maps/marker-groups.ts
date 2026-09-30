export type ProjectedMapMarker = {
  x: number;
  y: number;
};

function markerAxisDistance(
  first: ProjectedMapMarker,
  second: ProjectedMapMarker,
) {
  // Marker controls occupy axis-aligned boxes. Chebyshev distance groups
  // diagonal neighbors whose circular centers look separated but whose DOM
  // hit targets would still intersect.
  return Math.max(Math.abs(first.x - second.x), Math.abs(first.y - second.y));
}

export function groupNearbyMapMarkers(
  points: readonly ProjectedMapMarker[],
  maximumDistance = 48,
  partitions?: readonly (boolean | number | string)[],
): number[][] {
  const groups: number[][] = [];

  points.forEach((point, index) => {
    // The first point is also where the aggregate marker is rendered. Using
    // that stable representative keeps every later group center beyond the
    // collision radius instead of moving aggregates back into one another.
    const nearbyGroup = groups.find(
      ([representativeIndex]) =>
        (!partitions ||
          partitions[index] === partitions[representativeIndex]) &&
        markerAxisDistance(point, points[representativeIndex]) <=
          maximumDistance,
    );

    if (nearbyGroup) {
      nearbyGroup.push(index);
    } else {
      groups.push([index]);
    }
  });

  return groups;
}
