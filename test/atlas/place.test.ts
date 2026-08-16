import {
  formatAtlasDate,
  getAtlasPlaceContextLabel,
  getAtlasPlaceInputLabel,
  withAtlasPlaceContext,
} from '@/app/lib/atlas/place';

const entry = {
  placeLabel: '',
  placeName: 'Kyoto',
  placeLocality: 'Kyoto',
  placeRegion: 'Kyoto Prefecture',
  placeCountry: 'Japan',
} as const;

describe('withAtlasPlaceContext', () => {
  it('maps a freshly resolved region into the Atlas entry immediately', () => {
    const enriched = withAtlasPlaceContext(
      {
        id: 'memory-1',
        title: '',
        description: '',
        placeLabel: '',
        placeName: null,
        placeLocality: null,
        placeRegion: null,
        placeCountry: null,
        placeCountryCode: null,
        placeGeocoder: null,
        placeGeocodedAt: null,
        visitedOn: null,
        recordState: 'draft',
        journeyState: 'visited',
        latitude: 43.42,
        longitude: -82.83,
        version: 1,
        createdAt: '2026-08-16T00:00:00.000Z',
        updatedAt: '2026-08-16T00:00:00.000Z',
        media: [],
      },
      {
        placeName: 'Sandusky',
        locality: 'Sandusky',
        region: 'Michigan',
        country: 'United States',
        countryCode: 'US',
        geocoder: 'nominatim',
        geocodedAt: '2026-08-16T00:00:00.000Z',
      },
    );

    expect(enriched.placeRegion).toBe('Michigan');
    expect(getAtlasPlaceInputLabel(enriched)).toBe('Sandusky, Michigan');
  });
});

describe('getAtlasPlaceContextLabel', () => {
  it('prefers a user-authored label', () => {
    expect(
      getAtlasPlaceContextLabel({ ...entry, placeLabel: 'The quiet corner' }),
    ).toBe('The quiet corner');
  });

  it('formats a locality and region as the primary context', () => {
    expect(getAtlasPlaceContextLabel(entry)).toBe('Kyoto, Kyoto Prefecture');
  });

  it('formats a US locality with its state', () => {
    expect(
      getAtlasPlaceContextLabel({
        placeLabel: '',
        placeName: 'Mount Pleasant',
        placeLocality: 'Mount Pleasant',
        placeRegion: 'Michigan',
        placeCountry: 'United States',
      }),
    ).toBe('Mount Pleasant, Michigan');
  });

  it('falls back to country when no region is available', () => {
    expect(
      getAtlasPlaceContextLabel({
        ...entry,
        placeRegion: null,
      }),
    ).toBe('Kyoto, Japan');
  });

  it('avoids repeating the same locality and region', () => {
    expect(
      getAtlasPlaceContextLabel({
        ...entry,
        placeRegion: 'Kyoto',
      }),
    ).toBe('Kyoto, Japan');
  });

  it('uses the recognized place name when locality is unavailable', () => {
    expect(
      getAtlasPlaceContextLabel({
        ...entry,
        placeLocality: null,
        placeRegion: null,
      }),
    ).toBe('Kyoto, Japan');
  });
});

describe('getAtlasPlaceInputLabel', () => {
  it('upgrades a previously stored locality fragment to city and state', () => {
    expect(
      getAtlasPlaceInputLabel({
        placeLabel: 'Mount Pleasant',
        placeName: 'Mount Pleasant',
        placeLocality: 'Mount Pleasant',
        placeRegion: 'Michigan',
        placeCountry: 'United States',
      }),
    ).toBe('Mount Pleasant, Michigan');
  });

  it('keeps a user-authored place name', () => {
    expect(
      getAtlasPlaceInputLabel({
        ...entry,
        placeLabel: 'The quiet corner',
      }),
    ).toBe('The quiet corner');
  });
});

describe('formatAtlasDate', () => {
  it('uses clear copy when a date is missing', () => {
    expect(formatAtlasDate({ visitedOn: null, journeyState: 'visited' })).toBe(
      'Date not set',
    );
    expect(
      formatAtlasDate({ visitedOn: null, journeyState: 'want_to_visit' }),
    ).toBe('No date set');
  });
});
