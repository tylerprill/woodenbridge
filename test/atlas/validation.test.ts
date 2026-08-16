import {
  atlasDraftSchema,
  atlasEntryUpdateSchema,
  atlasViewSchema,
} from '@/app/lib/atlas/validation';

describe('atlas validation', () => {
  it('accepts valid map coordinates and rejects points outside the world', () => {
    const validDraft = {
      clientRequestId: '2df8f2d8-9fae-4c86-9578-3ed6179e262b',
      latitude: 35.6762,
      longitude: 139.6503,
    };

    expect(atlasDraftSchema.safeParse(validDraft).success).toBe(true);
    expect(
      atlasDraftSchema.safeParse({ ...validDraft, latitude: 91 }).success,
    ).toBe(false);
    expect(
      atlasDraftSchema.safeParse({ ...validDraft, longitude: -181 }).success,
    ).toBe(false);
  });

  it('requires a title before a draft becomes a saved memory', () => {
    const memory = {
      id: 'f7c0bf19-59fc-49df-9bd7-ae405a69e49c',
      version: 1,
      title: 'Morning at Fushimi Inari',
      description: 'The torii gates were quiet just after sunrise.',
      placeLabel: 'Kyoto, Japan',
      visitedOn: '2026-04-19',
      journeyState: 'visited',
    };

    expect(atlasEntryUpdateSchema.safeParse(memory).success).toBe(true);
    expect(
      atlasEntryUpdateSchema.safeParse({ ...memory, title: '   ' }).success,
    ).toBe(false);
  });

  it('normalizes an empty visit date and constrains camera state', () => {
    const memory = atlasEntryUpdateSchema.parse({
      id: 'f7c0bf19-59fc-49df-9bd7-ae405a69e49c',
      version: 3,
      title: 'The long road north',
      description: '',
      placeLabel: '',
      visitedOn: '',
      journeyState: 'want_to_visit',
    });

    expect(memory.visitedOn).toBeNull();
    expect(
      atlasViewSchema.safeParse({
        latitude: 20,
        longitude: 30,
        zoom: 4,
        bearing: 0,
        pitch: 45,
      }).success,
    ).toBe(true);
    expect(
      atlasViewSchema.safeParse({
        latitude: 20,
        longitude: 30,
        zoom: 25,
        bearing: 0,
        pitch: 45,
      }).success,
    ).toBe(false);
  });
});
