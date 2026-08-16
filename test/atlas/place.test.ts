import {
  formatAtlasDate,
  getAtlasPlaceContextLabel,
  getAtlasPlaceInputLabel,
} from '@/app/lib/atlas/place';

const entry = {
  placeLabel: '',
  placeName: 'Kyoto',
  placeLocality: 'Kyoto',
  placeRegion: 'Kyoto Prefecture',
  placeCountry: 'Japan',
} as const;

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
