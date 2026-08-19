import {
  createAtlasImportBatchSchema,
  prepareAtlasImportItemSchema,
} from '@/app/lib/atlas/import-validation';
import type { ReviewedAtlasImportItemInput } from '@/app/lib/atlas/import-definitions';

const baseItem: ReviewedAtlasImportItemInput = {
  clientItemId: '6bde00bb-a1f7-4cbf-a66b-b12c0b49dd37',
  title: 'Above the tree line',
  description: '',
  placeLabel: 'Twin Lakes, Colorado',
  placeName: 'Twin Lakes',
  placeLocality: 'Twin Lakes',
  placeRegion: 'Colorado',
  placeCountry: 'United States',
  placeCountryCode: 'US',
  placeGeocoder: 'nominatim',
  placeGeocodedAt: '2026-08-18T12:00:00.000Z',
  visitedOn: '2023-06-18',
  latitude: 39.1176694,
  longitude: -106.4454111,
  locationSource: 'photo_gps' as const,
  dateSource: 'photo_metadata' as const,
  dateConfirmed: true,
  sourceName: 'IMG_1364.HEIC',
  sourceMimeType: 'image/heic' as const,
  sourceByteSize: 3_200_000,
  sourceHash: 'a'.repeat(64),
  sourceWidth: null,
  sourceHeight: null,
  mediaWidth: null,
  mediaHeight: null,
  preparedByteSize: null,
  thumbnailByteSize: null,
};

function batch(items = [baseItem]) {
  return {
    clientRequestId: '719229d8-32fb-4e6f-bbed-772ff89935ce',
    chapterTitle: '',
    chapterIntroduction: '',
    coverClientItemId: null,
    items,
  };
}

describe('Atlas bulk import validation', () => {
  it('accepts an undecoded reviewed item for streaming preparation', () => {
    expect(createAtlasImportBatchSchema.safeParse(batch()).success).toBe(true);
  });

  it('accepts an explicitly user-entered visit date as manual provenance', () => {
    const result = createAtlasImportBatchSchema.safeParse(
      batch([{ ...baseItem, dateSource: 'manual' as const }]),
    );
    expect(result.success).toBe(true);
  });

  it('rejects a missing-date provenance when a visit date is present', () => {
    const result = createAtlasImportBatchSchema.safeParse(
      batch([{ ...baseItem, dateSource: 'missing' as const }]),
    );
    expect(result.success).toBe(false);
  });

  it('requires explicit confirmation before trusting a low-confidence file date', () => {
    const result = createAtlasImportBatchSchema.safeParse(
      batch([
        {
          ...baseItem,
          dateSource: 'file_date' as const,
          dateConfirmed: false,
        },
      ]),
    );
    expect(result.success).toBe(false);
    if (result.success) throw new Error('The file date was not rejected.');
    expect(result.error.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: ['items', 0, 'dateConfirmed'] }),
      ]),
    );
  });

  it('binds chapter intent to a selected photograph in the same batch', () => {
    const secondItem = {
      ...baseItem,
      clientItemId: 'd88932bb-661a-4fb3-8123-e0742d577293',
      sourceHash: 'b'.repeat(64),
    };
    expect(
      createAtlasImportBatchSchema.safeParse({
        ...batch([baseItem, secondItem]),
        chapterTitle: 'A chapter in motion',
        coverClientItemId: secondItem.clientItemId,
      }).success,
    ).toBe(true);
    expect(
      createAtlasImportBatchSchema.safeParse({
        ...batch([baseItem, secondItem]),
        chapterTitle: 'A chapter in motion',
        coverClientItemId: '3265f50a-6ab8-4db5-a84e-ec59d04e0d3d',
      }).success,
    ).toBe(false);
  });

  it('rejects duplicate hashes before any server records are created', () => {
    const result = createAtlasImportBatchSchema.safeParse(
      batch([
        baseItem,
        {
          ...baseItem,
          clientItemId: 'd88932bb-661a-4fb3-8123-e0742d577293',
        },
      ]),
    );
    expect(result.success).toBe(false);
  });

  it('requires preparation values to be entirely absent or entirely present', () => {
    const result = createAtlasImportBatchSchema.safeParse(
      batch([{ ...baseItem, sourceWidth: 4032 }]),
    );
    expect(result.success).toBe(false);
  });

  it('enforces source byte and 25-megapixel limits', () => {
    expect(
      createAtlasImportBatchSchema.safeParse(
        batch([{ ...baseItem, sourceByteSize: 25 * 1024 * 1024 + 1 }]),
      ).success,
    ).toBe(false);

    expect(
      prepareAtlasImportItemSchema.safeParse({
        batchId: '719229d8-32fb-4e6f-bbed-772ff89935ce',
        itemId: baseItem.clientItemId,
        sourceWidth: 5_001,
        sourceHeight: 5_000,
        mediaWidth: 2560,
        mediaHeight: 1440,
        preparedByteSize: 8_000_000,
        thumbnailByteSize: 500_000,
      }).success,
    ).toBe(false);
  });
});
