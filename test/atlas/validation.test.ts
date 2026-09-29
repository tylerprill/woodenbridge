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
      occurredTime: '06:42',
      occurredUtcOffsetMinutes: 540,
      journeyState: 'visited',
    };

    expect(atlasEntryUpdateSchema.safeParse(memory).success).toBe(true);
    expect(
      atlasEntryUpdateSchema.safeParse({ ...memory, title: '   ' }).success,
    ).toBe(false);
    expect(
      atlasEntryUpdateSchema.parse({
        ...memory,
        occurredTime: undefined,
        occurredUtcOffsetMinutes: undefined,
      }),
    ).toMatchObject({
      occurredTime: null,
      occurredUtcOffsetMinutes: null,
    });
  });

  it('normalizes an empty visit date and constrains camera state', () => {
    const memory = atlasEntryUpdateSchema.parse({
      id: 'f7c0bf19-59fc-49df-9bd7-ae405a69e49c',
      version: 3,
      title: 'The long road north',
      description: '',
      placeLabel: '',
      visitedOn: '',
      occurredTime: '',
      occurredUtcOffsetMinutes: null,
      journeyState: 'want_to_visit',
    });

    expect(memory.visitedOn).toBeNull();
    expect(memory.occurredTime).toBeNull();
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

  it('requires a date for visited memories while leaving planned dates optional', () => {
    const memory = {
      id: 'f7c0bf19-59fc-49df-9bd7-ae405a69e49c',
      version: 1,
      title: 'Coffee before the trail',
      description: '',
      placeLabel: 'Leadville, Colorado',
      visitedOn: null,
      occurredTime: null,
      occurredUtcOffsetMinutes: null,
      journeyState: 'visited' as const,
    };

    const visitedResult = atlasEntryUpdateSchema.safeParse(memory);
    expect(visitedResult.success).toBe(false);
    if (!visitedResult.success) {
      expect(visitedResult.error.flatten().fieldErrors.visitedOn).toContain(
        'Choose the date this memory happened.',
      );
    }
    expect(
      atlasEntryUpdateSchema.safeParse({
        ...memory,
        journeyState: 'want_to_visit',
      }).success,
    ).toBe(true);
  });

  it('requires a calendar date for a local occurrence time', () => {
    const memory = {
      id: 'f7c0bf19-59fc-49df-9bd7-ae405a69e49c',
      version: 1,
      title: 'Sunrise at the pass',
      description: '',
      placeLabel: '',
      visitedOn: null,
      occurredTime: '06:42',
      occurredUtcOffsetMinutes: null,
      journeyState: 'visited' as const,
    };

    expect(atlasEntryUpdateSchema.safeParse(memory).success).toBe(false);
    expect(
      atlasEntryUpdateSchema.safeParse({
        ...memory,
        visitedOn: '2026-04-19',
      }).success,
    ).toBe(true);
    expect(
      atlasEntryUpdateSchema.safeParse({
        ...memory,
        visitedOn: '2026-04-19',
        occurredUtcOffsetMinutes: 900,
      }).success,
    ).toBe(false);
  });

  it('accepts only a valid Journey id when saving into a Journey', () => {
    const memory = {
      id: 'f7c0bf19-59fc-49df-9bd7-ae405a69e49c',
      version: 1,
      title: 'Lunch beside the lake',
      description: '',
      placeLabel: 'Lake Michigan',
      visitedOn: '2026-09-28',
      occurredTime: '12:30',
      occurredUtcOffsetMinutes: -360,
      journeyState: 'visited' as const,
      appendToJourneyId: '78daf767-13e6-4f2f-a7bf-8a087824c005',
    };

    expect(atlasEntryUpdateSchema.safeParse(memory).success).toBe(true);
    expect(
      atlasEntryUpdateSchema.safeParse({
        ...memory,
        appendToJourneyId: 'not-a-journey-id',
      }).success,
    ).toBe(false);
  });

  it('validates existing and new Segment destinations inside a Journey', () => {
    const memory = {
      id: 'f7c0bf19-59fc-49df-9bd7-ae405a69e49c',
      version: 1,
      title: 'Lunch beside the lake',
      description: '',
      placeLabel: 'Lake Michigan',
      visitedOn: '2026-09-28',
      occurredTime: null,
      occurredUtcOffsetMinutes: null,
      journeyState: 'visited' as const,
      appendToJourneyId: '78daf767-13e6-4f2f-a7bf-8a087824c005',
    };
    const segmentId = 'e8ef6529-4961-4847-8272-e0da4aebf38b';

    expect(
      atlasEntryUpdateSchema.safeParse({
        ...memory,
        appendToJourneySegmentId: segmentId,
      }).success,
    ).toBe(true);
    expect(
      atlasEntryUpdateSchema.parse({
        ...memory,
        appendToNewJourneySegmentTitle: '  Day 2 · The coast  ',
      }).appendToNewJourneySegmentTitle,
    ).toBe('Day 2 · The coast');
    expect(
      atlasEntryUpdateSchema.safeParse({
        ...memory,
        appendToJourneySegmentId: segmentId,
        appendToNewJourneySegmentTitle: 'Day 3',
      }).success,
    ).toBe(false);
    expect(
      atlasEntryUpdateSchema.safeParse({
        ...memory,
        appendToJourneyId: undefined,
        appendToJourneySegmentId: segmentId,
      }).success,
    ).toBe(false);
  });
});
