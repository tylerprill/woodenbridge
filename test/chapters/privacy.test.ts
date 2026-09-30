import type { AtlasChapter } from '@/app/lib/chapters/definitions';
import { deriveJourneyDisplayRoute } from '@/app/lib/chapters/journey-display';
import { toSharedAtlasChapter } from '@/app/lib/chapters/shared';

const chapter: AtlasChapter = {
  id: 'c202ab58-61c3-455d-8cee-6bd9f29a7e94',
  title: 'Private coordinates',
  introduction: 'The story can travel without the pin.',
  version: 1,
  memoryCount: 1,
  startDate: '2026-08-17',
  endDate: '2026-08-17',
  coverMedia: null,
  coverMediaId: null,
  visibility: 'shared',
  shareId: '3a6e63ac-e82e-4f00-aacf-15a0344749f0',
  shareMap: false,
  shareLocationPrecision: 'exact',
  createdAt: '2026-08-17T12:00:00.000Z',
  updatedAt: '2026-08-17T12:00:00.000Z',
  segments: [],
  entries: [
    {
      id: '5a4ea1bb-4a42-43c4-bca4-8278f4971486',
      title: 'A private cabin',
      description: 'No map needed.',
      placeLabel: 'Northern Michigan',
      placeName: 'Michigan',
      placeLocality: null,
      placeRegion: 'Michigan',
      placeCountry: 'United States',
      placeCountryCode: 'US',
      placeGeocoder: null,
      placeGeocodedAt: null,
      visitedOn: '2026-08-17',
      occurredTime: null,
      occurredUtcOffsetMinutes: null,
      recordState: 'saved',
      journeyState: 'visited',
      latitude: 44.987654,
      longitude: -84.123456,
      version: 1,
      createdAt: '2026-08-17T12:00:00.000Z',
      updatedAt: '2026-08-17T12:00:00.000Z',
      media: [],
      transitionNote: '',
      segmentId: null,
    },
  ],
};

describe('shared chapter privacy DTO', () => {
  it('omits coordinate keys entirely when the map is disabled', () => {
    const shared = toSharedAtlasChapter(chapter);
    const entry = shared.entries[0];
    const serialized = JSON.stringify(shared);

    expect(shared.shareMap).toBe(false);
    expect(shared.shareLocationPrecision).toBe('approximate');
    expect(entry).not.toHaveProperty('latitude');
    expect(entry).not.toHaveProperty('longitude');
    expect(serialized).not.toContain('latitude');
    expect(serialized).not.toContain('longitude');
  });

  it('uses only approximate coordinates when an approximate map is shared', () => {
    const shared = toSharedAtlasChapter({
      ...chapter,
      shareMap: true,
      shareLocationPrecision: 'approximate',
    });

    expect(shared.entries[0]).toMatchObject({
      latitude: 45,
      longitude: -84.1,
    });
  });

  it('derives a round-trip label after private coordinates are removed', () => {
    const start = {
      ...chapter.entries[0],
      id: 'grand-blanc-start',
      placeLabel: 'Grand Blanc',
      placeName: 'Grand Blanc',
      placeLocality: 'Grand Blanc',
      placeRegion: 'Michigan',
      latitude: 42.9275,
      longitude: -83.63,
    };
    const destination = {
      ...start,
      id: 'leadville',
      placeLabel: 'Leadville',
      placeName: 'Leadville',
      placeLocality: 'Leadville',
      placeRegion: 'Colorado',
      latitude: 39.2508,
      longitude: -106.2925,
    };
    const shared = toSharedAtlasChapter({
      ...chapter,
      memoryCount: 3,
      shareMap: false,
      entries: [start, destination, { ...start, id: 'grand-blanc-return' }],
    });

    expect(deriveJourneyDisplayRoute(shared.entries)).toMatchObject({
      kind: 'round-trip',
      origin: 'Grand Blanc',
      destination: 'Leadville',
    });
    expect(JSON.stringify(shared)).not.toContain('latitude');
    expect(JSON.stringify(shared)).not.toContain('longitude');
  });

  it('publishes only metadata-stripped thumbnail derivatives', () => {
    const originalUrl =
      '/api/atlas/media/media-id?grant=signed-private-original';
    const thumbnailUrl =
      '/api/atlas/media/media-id?variant=thumbnail&grant=signed-private-thumbnail';
    const shared = toSharedAtlasChapter({
      ...chapter,
      entries: [
        {
          ...chapter.entries[0],
          media: [
            {
              id: 'media-id',
              entryId: chapter.entries[0].id,
              mimeType: 'image/jpeg',
              width: 2400,
              height: 1600,
              byteSize: 500_000,
              altText: 'A private photograph',
              sortOrder: 0,
              createdAt: '2026-08-17T12:00:00.000Z',
              deliveryUrl: originalUrl,
              thumbnailUrl,
            },
          ],
        },
      ],
    });
    const media = shared.entries[0].media[0];

    expect(media.deliveryUrl).toBe(media.thumbnailUrl);
    expect(media.deliveryUrl).toContain('variant=thumbnail');
    expect(media.deliveryUrl).toContain(`share=${chapter.shareId}`);
    expect(JSON.stringify(shared)).not.toContain('signed-private-original');
    expect(JSON.stringify(shared)).not.toContain('signed-private-thumbnail');
    expect(media.deliveryUrl).not.toContain('grant=');
  });
});
