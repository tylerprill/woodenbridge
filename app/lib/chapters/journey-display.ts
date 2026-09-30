const EARTH_RADIUS_KM = 6371;

// Public approximate pins are rounded to 0.1°, so the return radius needs to
// absorb rounding on both ends while remaining small enough to mean the route
// genuinely came back to its starting area.
export const JOURNEY_RETURN_RADIUS_KM = 25;
export const JOURNEY_LOCAL_LOOP_RADIUS_KM = 50;

export type JourneyDisplayStop = {
  placeLabel?: string | null;
  placeName?: string | null;
  placeLocality?: string | null;
  placeRegion?: string | null;
  placeCountry?: string | null;
  placeCountryCode?: string | null;
  latitude?: number;
  longitude?: number;
};

export type JourneyDisplayRoute =
  | { kind: 'none' }
  | {
      kind: 'place';
      origin: string;
      destination: null;
      status: null;
      ariaLabel: string;
    }
  | {
      kind: 'open';
      origin: string;
      destination: string;
      status: null;
      ariaLabel: string;
    }
  | {
      kind: 'round-trip';
      origin: string;
      destination: string;
      status: 'Round trip';
      ariaLabel: string;
    }
  | {
      kind: 'local-loop';
      origin: string;
      destination: null;
      status: null;
      ariaLabel: string;
    };

type DisplayStop = {
  entry: JourneyDisplayStop;
  index: number;
  label: string;
};

type Coordinates = {
  latitude: number;
  longitude: number;
};

function normalizedText(value: string | null | undefined) {
  return (value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase()
    .replace(
      /[^a-z0-9\u00c0-\u024f\u0370-\u052f\u3040-\u30ff\u3400-\u9fff]+/gi,
      ' ',
    )
    .trim();
}

function displayPlace(entry: JourneyDisplayStop) {
  return entry.placeLabel?.trim() || entry.placeName?.trim() || null;
}

type PlaceComparison = 'match' | 'conflict' | 'unknown';

function structuredPlaceComparison(
  first: JourneyDisplayStop,
  second: JourneyDisplayStop,
): PlaceComparison {
  const firstLocality = normalizedText(first.placeLocality);
  const secondLocality = normalizedText(second.placeLocality);
  if (!firstLocality || !secondLocality) return 'unknown';
  if (firstLocality !== secondLocality) return 'conflict';

  const firstRegion = normalizedText(first.placeRegion);
  const secondRegion = normalizedText(second.placeRegion);
  if (firstRegion && secondRegion && firstRegion !== secondRegion) {
    return 'conflict';
  }

  const firstCountryCode = normalizedText(first.placeCountryCode);
  const secondCountryCode = normalizedText(second.placeCountryCode);
  if (
    firstCountryCode &&
    secondCountryCode &&
    firstCountryCode !== secondCountryCode
  ) {
    return 'conflict';
  }
  const firstCountry = normalizedText(first.placeCountry);
  const secondCountry = normalizedText(second.placeCountry);
  if (firstCountry && secondCountry && firstCountry !== secondCountry) {
    return 'conflict';
  }
  return 'match';
}

function coordinates(entry: JourneyDisplayStop): Coordinates | null {
  const { latitude, longitude } = entry;
  if (
    typeof latitude !== 'number' ||
    typeof longitude !== 'number' ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return null;
  }
  return { latitude, longitude };
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

export function journeyDistanceKm(first: Coordinates, second: Coordinates) {
  const latitudeDelta = toRadians(second.latitude - first.latitude);
  let longitudeDelta = second.longitude - first.longitude;
  while (longitudeDelta > 180) longitudeDelta -= 360;
  while (longitudeDelta < -180) longitudeDelta += 360;

  const longitudeDeltaRadians = toRadians(longitudeDelta);
  const firstLatitude = toRadians(first.latitude);
  const secondLatitude = toRadians(second.latitude);
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(firstLatitude) *
      Math.cos(secondLatitude) *
      Math.sin(longitudeDeltaRadians / 2) ** 2;

  return (
    2 *
    EARTH_RADIUS_KM *
    Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine))
  );
}

function placeIdentityComparison(
  first: DisplayStop,
  second: DisplayStop,
): PlaceComparison {
  const structuredComparison = structuredPlaceComparison(
    first.entry,
    second.entry,
  );
  if (structuredComparison !== 'unknown') return structuredComparison;
  if (normalizedText(first.label) !== normalizedText(second.label)) {
    return 'unknown';
  }

  const firstCoordinates = coordinates(first.entry);
  const secondCoordinates = coordinates(second.entry);
  if (
    firstCoordinates &&
    secondCoordinates &&
    journeyDistanceKm(firstCoordinates, secondCoordinates) >
      JOURNEY_RETURN_RADIUS_KM
  ) {
    return 'conflict';
  }
  return 'match';
}

function placesMatch(first: DisplayStop, second: DisplayStop) {
  const identityComparison = placeIdentityComparison(first, second);
  if (identityComparison === 'match') return true;
  if (identityComparison === 'conflict') return false;

  const firstCoordinates = coordinates(first.entry);
  const secondCoordinates = coordinates(second.entry);
  return Boolean(
    firstCoordinates &&
    secondCoordinates &&
    journeyDistanceKm(firstCoordinates, secondCoordinates) <=
      JOURNEY_RETURN_RADIUS_KM,
  );
}

function midpointCandidate(candidates: DisplayStop[], lastIndex: number) {
  const midpoint = lastIndex / 2;
  return candidates.reduce((best, candidate) => {
    const candidateDistance = Math.abs(candidate.index - midpoint);
    const bestDistance = Math.abs(best.index - midpoint);
    return candidateDistance < bestDistance ? candidate : best;
  });
}

export function deriveJourneyDisplayRoute(
  orderedStops: readonly JourneyDisplayStop[],
): JourneyDisplayRoute {
  const stops = orderedStops.flatMap((entry, index): DisplayStop[] => {
    const label = displayPlace(entry);
    return label ? [{ entry, index, label }] : [];
  });
  if (!stops.length) return { kind: 'none' };

  const origin = stops[0];
  if (stops.length === 1) {
    return {
      kind: 'place',
      origin: origin.label,
      destination: null,
      status: null,
      ariaLabel: origin.label,
    };
  }

  const endpoint = stops.at(-1)!;
  const endpointCoordinates = coordinates(endpoint.entry);
  const originCoordinates = coordinates(origin.entry);
  const coordinateReturn = Boolean(
    stops.length >= 3 &&
    originCoordinates &&
    endpointCoordinates &&
    journeyDistanceKm(originCoordinates, endpointCoordinates) <=
      JOURNEY_RETURN_RADIUS_KM,
  );
  const endpointComparison = placeIdentityComparison(origin, endpoint);
  const isClosed =
    endpointComparison === 'match' ||
    (endpointComparison === 'unknown' && coordinateReturn);

  if (!isClosed) {
    return {
      kind: 'open',
      origin: origin.label,
      destination: endpoint.label,
      status: null,
      ariaLabel: `From ${origin.label} to ${endpoint.label}`,
    };
  }

  const excursionCandidates = stops
    .slice(1, -1)
    .filter((candidate) => !placesMatch(origin, candidate));
  if (!excursionCandidates.length) {
    return {
      kind: 'local-loop',
      origin: origin.label,
      destination: null,
      status: null,
      ariaLabel: `Around ${origin.label}`,
    };
  }

  const candidatesWithDistance = originCoordinates
    ? excursionCandidates.flatMap((candidate) => {
        const candidateCoordinates = coordinates(candidate.entry);
        return candidateCoordinates
          ? [
              {
                candidate,
                distance: journeyDistanceKm(
                  originCoordinates,
                  candidateCoordinates,
                ),
              },
            ]
          : [];
      })
    : [];

  let destination: DisplayStop;
  if (candidatesWithDistance.length === excursionCandidates.length) {
    const midpoint = (stops.length - 1) / 2;
    const farthest = candidatesWithDistance.reduce((best, current) => {
      if (current.distance > best.distance) return current;
      if (current.distance < best.distance) return best;
      const currentMidpointDistance = Math.abs(
        current.candidate.index - midpoint,
      );
      const bestMidpointDistance = Math.abs(best.candidate.index - midpoint);
      return currentMidpointDistance < bestMidpointDistance ? current : best;
    });
    if (farthest.distance <= JOURNEY_LOCAL_LOOP_RADIUS_KM) {
      return {
        kind: 'local-loop',
        origin: origin.label,
        destination: null,
        status: null,
        ariaLabel: `Around ${origin.label}`,
      };
    }
    destination = farthest.candidate;
  } else {
    destination = midpointCandidate(excursionCandidates, stops.length - 1);
  }

  return {
    kind: 'round-trip',
    origin: origin.label,
    destination: destination.label,
    status: 'Round trip',
    ariaLabel: `Round trip from ${origin.label} via ${destination.label}, returning to ${origin.label}`,
  };
}
