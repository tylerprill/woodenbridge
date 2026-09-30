import {
  deriveJourneyDisplayRoute,
  JOURNEY_LOCAL_LOOP_RADIUS_KM,
  JOURNEY_RETURN_RADIUS_KM,
  journeyDistanceKm,
  type JourneyDisplayStop,
} from '@/app/lib/chapters/journey-display';

function stop(
  placeLabel: string,
  latitude?: number,
  longitude?: number,
  fields: Partial<JourneyDisplayStop> = {},
): JourneyDisplayStop {
  return {
    placeLabel,
    placeName: placeLabel,
    placeLocality: placeLabel,
    placeRegion: null,
    placeCountry: 'United States',
    placeCountryCode: 'US',
    latitude,
    longitude,
    ...fields,
  };
}

describe('Journey display route', () => {
  it('handles empty and single-place journeys', () => {
    expect(deriveJourneyDisplayRoute([])).toEqual({ kind: 'none' });
    expect(deriveJourneyDisplayRoute([stop('  ', 42, -83)])).toEqual({
      kind: 'none',
    });
    expect(
      deriveJourneyDisplayRoute([stop('Grand Blanc', 42.93, -83.63)]),
    ).toEqual({
      kind: 'place',
      origin: 'Grand Blanc',
      destination: null,
      status: null,
      ariaLabel: 'Grand Blanc',
    });
  });

  it('keeps a one-way journey as its literal endpoints', () => {
    expect(
      deriveJourneyDisplayRoute([
        stop('Grand Blanc', 42.93, -83.63),
        stop('Leadville', 39.25, -106.29),
      ]),
    ).toEqual({
      kind: 'open',
      origin: 'Grand Blanc',
      destination: 'Leadville',
      status: null,
      ariaLabel: 'From Grand Blanc to Leadville',
    });
  });

  it('summarizes a closed excursion with its farthest meaningful stop', () => {
    expect(
      deriveJourneyDisplayRoute([
        stop('Grand Blanc', 42.9275, -83.63),
        stop('Omaha', 41.2565, -95.9345),
        stop('Leadville', 39.2508, -106.2925),
        stop('Denver', 39.7392, -104.9903),
        stop('Grand Blanc', 42.93, -83.62),
      ]),
    ).toEqual({
      kind: 'round-trip',
      origin: 'Grand Blanc',
      destination: 'Leadville',
      status: 'Round trip',
      ariaLabel:
        'Round trip from Grand Blanc via Leadville, returning to Grand Blanc',
    });
  });

  it('describes a short return as a local loop instead of repeating a place', () => {
    expect(
      deriveJourneyDisplayRoute([
        stop('Grand Blanc', 42.9275, -83.63),
        stop('Flint', 43.0125, -83.6875),
        stop('Grand Blanc', 42.93, -83.62),
      ]),
    ).toEqual({
      kind: 'local-loop',
      origin: 'Grand Blanc',
      destination: null,
      status: null,
      ariaLabel: 'Around Grand Blanc',
    });
  });

  it('recognizes the same structured place despite authored label changes', () => {
    expect(
      deriveJourneyDisplayRoute([
        stop('Grand Blanc, MI', undefined, undefined, {
          placeName: 'Grand Blanc',
          placeLocality: 'Grand Blanc',
          placeRegion: 'Michigan',
        }),
        stop('Leadville, Colorado', undefined, undefined, {
          placeName: 'Leadville',
          placeLocality: 'Leadville',
          placeRegion: 'Colorado',
        }),
        stop('Grand Blanc, Michigan', undefined, undefined, {
          placeName: 'Grand Blanc',
          placeLocality: 'Grand Blanc',
          placeRegion: 'Michigan',
        }),
      ]),
    ).toMatchObject({
      kind: 'round-trip',
      origin: 'Grand Blanc, MI',
      destination: 'Leadville, Colorado',
    });
  });

  it('uses the route midpoint when privacy removes coordinates', () => {
    expect(
      deriveJourneyDisplayRoute([
        stop('Grand Blanc'),
        stop('Omaha'),
        stop('Leadville'),
        stop('Omaha'),
        stop('Grand Blanc'),
      ]),
    ).toMatchObject({
      kind: 'round-trip',
      destination: 'Leadville',
    });
  });

  it('does not mistake two nearby but differently named endpoints for a loop', () => {
    expect(
      deriveJourneyDisplayRoute([
        stop('Grand Blanc', 42.9275, -83.63),
        stop('Flint', 43.0125, -83.6875),
      ]),
    ).toMatchObject({
      kind: 'open',
      origin: 'Grand Blanc',
      destination: 'Flint',
    });
  });

  it('detects a nearby return with a different final label', () => {
    expect(
      deriveJourneyDisplayRoute([
        stop('Grand Blanc', 42.9275, -83.63),
        stop('Leadville', 39.2508, -106.2925),
        stop('Back at the driveway', 42.93, -83.62, {
          placeName: 'Home',
          placeLocality: null,
        }),
      ]),
    ).toMatchObject({
      kind: 'round-trip',
      origin: 'Grand Blanc',
      destination: 'Leadville',
    });
  });

  it('does not let matching labels override conflicting structured places', () => {
    expect(
      deriveJourneyDisplayRoute([
        stop('Springfield', 39.7817, -89.6501, {
          placeLocality: 'Springfield',
          placeRegion: 'Illinois',
        }),
        stop('Chicago', 41.8781, -87.6298, {
          placeLocality: 'Chicago',
          placeRegion: 'Illinois',
        }),
        stop('Springfield', 37.209, -93.2923, {
          placeLocality: 'Springfield',
          placeRegion: 'Missouri',
        }),
      ]),
    ).toMatchObject({ kind: 'open' });
  });

  it('does not guess that unrelated short and long region names are equivalent', () => {
    expect(
      deriveJourneyDisplayRoute([
        stop('Springfield', 39.7817, -89.6501, {
          placeLocality: 'Springfield',
          placeRegion: 'IL',
        }),
        stop('Chicago', 41.8781, -87.6298, {
          placeLocality: 'Chicago',
          placeRegion: 'Illinois',
        }),
        stop('Springfield', 37.209, -93.2923, {
          placeLocality: 'Springfield',
          placeRegion: 'Missouri',
        }),
      ]),
    ).toMatchObject({ kind: 'open' });
  });

  it('does not let proximity override explicitly different localities', () => {
    expect(
      deriveJourneyDisplayRoute([
        stop('Grand Blanc', 42.9275, -83.63),
        stop('Leadville', 39.2508, -106.2925),
        stop('Flint', 43.0125, -83.6875),
      ]),
    ).toEqual({
      kind: 'open',
      origin: 'Grand Blanc',
      destination: 'Flint',
      status: null,
      ariaLabel: 'From Grand Blanc to Flint',
    });
  });

  it('falls back to label order when coordinates are incomplete or invalid', () => {
    expect(
      deriveJourneyDisplayRoute([
        stop('Grand Blanc', Number.NaN, -83.63),
        stop('Omaha', 41.2565, -95.9345),
        stop('Leadville'),
        stop('Grand Blanc', Number.POSITIVE_INFINITY, -83.63),
      ]),
    ).toMatchObject({
      kind: 'round-trip',
      destination: 'Omaha',
    });
  });

  it('keeps antimeridian distances on the short side of the globe', () => {
    expect(
      journeyDistanceKm(
        { latitude: 0, longitude: 179.9 },
        { latitude: 0, longitude: -179.9 },
      ),
    ).toBeLessThan(JOURNEY_RETURN_RADIUS_KM);
  });

  it('keeps the local-loop boundary outside the return radius', () => {
    expect(JOURNEY_LOCAL_LOOP_RADIUS_KM).toBeGreaterThan(
      JOURNEY_RETURN_RADIUS_KM,
    );
  });
});
