import {
  formatAtlasDate,
  getAtlasPlaceContextLabel,
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

  it('falls back to country when no region is available', () => {
    expect(
      getAtlasPlaceContextLabel({
        ...entry,
        placeRegion: null,
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
