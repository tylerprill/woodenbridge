import {
  atlasJourneyDistanceKm,
  buildHistoricalJourneySuggestions,
  buildImportJourneySuggestions,
  selectAtlasJourneySuggestions,
  type AtlasJourneySuggestionCandidate,
} from '@/app/lib/atlas/journeys/suggestions';

function candidate(
  entryId: string,
  overrides: Partial<AtlasJourneySuggestionCandidate> = {},
): AtlasJourneySuggestionCandidate {
  return {
    entryId,
    version: 1,
    title: `Memory ${entryId}`,
    placeLabel: 'Ann Arbor, Michigan',
    placeName: 'Ann Arbor',
    placeLocality: 'Ann Arbor',
    placeRegion: 'Michigan',
    placeCountry: 'United States',
    visitedOn: '2026-05-10',
    latitude: 42.2808,
    longitude: -83.743,
    ...overrides,
  };
}

describe('Atlas journey suggestions', () => {
  it('keeps import order while deriving a stable membership key', () => {
    const first = candidate('entry-a');
    const second = candidate('entry-b', { visitedOn: '2026-05-11' });
    const forward = buildImportJourneySuggestions([
      {
        batchId: 'batch-a',
        completedAt: '2026-05-12T12:00:00.000Z',
        entries: [
          { ...first, position: 0 },
          { ...second, position: 1 },
        ],
      },
    ])[0];
    const reversedInput = buildImportJourneySuggestions([
      {
        batchId: 'batch-a',
        completedAt: '2026-05-12T12:00:00.000Z',
        entries: [
          { ...second, position: 1 },
          { ...first, position: 0 },
        ],
      },
    ])[0];

    expect(forward.entryIds).toEqual(['entry-a', 'entry-b']);
    expect(reversedInput.key).toBe(forward.key);
    expect(forward).toMatchObject({
      source: 'photo_import',
      reason: 'imported_together',
      explanation: 'These 2 memories were imported together.',
    });
  });

  it('keeps undated memories in an import-bound suggestion', () => {
    const [suggestion] = buildImportJourneySuggestions([
      {
        batchId: 'batch-undated',
        completedAt: '2026-05-12T12:00:00.000Z',
        entries: [
          { ...candidate('dated'), position: 0 },
          { ...candidate('undated', { visitedOn: null }), position: 1 },
        ],
      },
    ]);

    expect(suggestion.entryIds).toEqual(['dated', 'undated']);
    expect(suggestion.startDate).toBe('2026-05-10');
    expect(suggestion.endDate).toBe('2026-05-10');
  });

  it('groups only memories that are both near in time and geography', () => {
    const suggestions = buildHistoricalJourneySuggestions([
      candidate('near-a'),
      candidate('near-b', {
        visitedOn: '2026-05-12',
        latitude: 42.3314,
        longitude: -83.0458,
      }),
      candidate('too-late', { visitedOn: '2026-05-20' }),
      candidate('too-far', {
        visitedOn: '2026-05-11',
        latitude: 34.0522,
        longitude: -118.2437,
      }),
    ]);

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]).toMatchObject({
      source: 'atlas_history',
      reason: 'nearby_dates_and_places',
      entryIds: ['near-a', 'near-b'],
      startDate: '2026-05-10',
      endDate: '2026-05-12',
    });
  });

  it('treats locations on either side of the antimeridian as nearby', () => {
    const distance = atlasJourneyDistanceKm(
      candidate('west', { latitude: -17.7, longitude: 179.8 }),
      candidate('east', { latitude: -17.7, longitude: -179.8 }),
    );

    expect(distance).toBeLessThan(50);
  });

  it('prioritizes import suggestions without overlapping recommendations', () => {
    const imported = buildImportJourneySuggestions([
      {
        batchId: 'batch-a',
        completedAt: '2026-05-12T12:00:00.000Z',
        entries: [
          { ...candidate('shared'), position: 0 },
          { ...candidate('import-only'), position: 1 },
        ],
      },
    ]);
    const historical = buildHistoricalJourneySuggestions([
      candidate('shared'),
      candidate('history-only'),
    ]);

    expect(
      selectAtlasJourneySuggestions({ imports: imported, historical }),
    ).toEqual(imported);
    expect(
      selectAtlasJourneySuggestions({
        imports: imported,
        historical,
        excludedKeys: new Set([imported[0].key]),
      }),
    ).toEqual(historical);
  });

  it('changes the key when a member version changes', () => {
    const build = (version: number) =>
      buildHistoricalJourneySuggestions([
        candidate('entry-a', { version }),
        candidate('entry-b'),
      ])[0].key;

    expect(build(1)).not.toBe(build(2));
  });
});
