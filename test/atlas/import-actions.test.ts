import { readFileSync } from 'node:fs';
import { join } from 'node:path';

jest.mock('@vercel/postgres', () => {
  const clientQuery = jest.fn();
  const release = jest.fn();
  const connect = jest.fn(async () => ({ query: clientQuery, release }));
  const taggedQuery = jest.fn();
  Object.assign(taggedQuery, { query: jest.fn() });
  return {
    db: { connect },
    sql: taggedQuery,
    __testMocks: { clientQuery, release, connect, taggedQuery },
  };
});

jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('@/app/lib/auth/session', () => ({
  requireVerifiedSession: jest.fn(),
}));
jest.mock('@/app/lib/atlas/import-data', () => ({
  loadAtlasImportBatchForUser: jest.fn(),
}));
jest.mock('@/app/lib/atlas/geocoding', () => ({
  lookupAtlasPlace: jest.fn(),
}));

import { requireVerifiedSession } from '@/app/lib/auth/session';
import {
  cancelAtlasImportBatchAction,
  createAtlasImportBatchAction,
  finalizeAtlasImportBatchAction,
  prepareAtlasImportItemAction,
  resolveAtlasImportPlaceAction,
} from '@/app/lib/actions/atlas-import';
import { loadAtlasImportBatchForUser } from '@/app/lib/atlas/import-data';
import { lookupAtlasPlace } from '@/app/lib/atlas/geocoding';
import type { AtlasImportBatch } from '@/app/lib/atlas/import-definitions';

const { __testMocks } = jest.requireMock('@vercel/postgres') as {
  __testMocks: {
    clientQuery: jest.Mock;
    release: jest.Mock;
    connect: jest.Mock;
    taggedQuery: jest.Mock;
  };
};

const userId = '17d69b97-9d24-4e07-a461-271263c71c52';
const batchId = '3fe3cf16-c676-42cf-b3e6-87158c836fd9';
const itemId = '1476ce67-531d-423a-a977-f6e895374419';
const entryId = 'f7c0bf19-59fc-49df-9bd7-ae405a69e49c';
const mediaId = '2df8f2d8-9fae-4c86-9578-3ed6179e262b';
const clientRequestId = '719229d8-32fb-4e6f-bbed-772ff89935ce';
const sourceHash = 'a'.repeat(64);
const originalGeocodeInterval = process.env.ATLAS_GEOCODER_MIN_INTERVAL_MS;

const createInput = {
  clientRequestId,
  chapterTitle: '',
  chapterIntroduction: '',
  coverClientItemId: null,
  items: [
    {
      clientItemId: itemId,
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
      sourceHash,
      sourceWidth: null,
      sourceHeight: null,
      mediaWidth: null,
      mediaHeight: null,
      preparedByteSize: null,
      thumbnailByteSize: null,
    },
  ],
};

const batchDto = {
  id: batchId,
  clientRequestId,
  status: 'uploading',
  version: 1,
  chapterTitle: '',
  chapterIntroduction: '',
  coverClientItemId: null,
  items: [],
  createdAt: '2026-08-18T12:00:00.000Z',
  updatedAt: '2026-08-18T12:00:00.000Z',
  completedAt: null,
} satisfies AtlasImportBatch;

function normalizeQuery(query: unknown) {
  return String(query).replace(/\s+/g, ' ').trim();
}

describe('Atlas import server actions', () => {
  beforeEach(() => {
    __testMocks.clientQuery.mockReset();
    __testMocks.release.mockReset();
    __testMocks.connect.mockClear();
    __testMocks.taggedQuery.mockReset();
    jest.mocked(requireVerifiedSession).mockResolvedValue({
      user: { id: userId },
    } as Awaited<ReturnType<typeof requireVerifiedSession>>);
    jest.mocked(loadAtlasImportBatchForUser).mockReset();
    jest.mocked(lookupAtlasPlace).mockReset();
  });

  afterEach(() => {
    if (originalGeocodeInterval === undefined) {
      delete process.env.ATLAS_GEOCODER_MIN_INTERVAL_MS;
    } else {
      process.env.ATLAS_GEOCODER_MIN_INTERVAL_MS = originalGeocodeInterval;
    }
  });

  it('returns the original user-owned batch for an idempotent create retry', async () => {
    __testMocks.clientQuery.mockImplementation(
      async (query: string, values?: unknown[]) => {
        const text = normalizeQuery(query);
        if (
          text.includes('FROM atlas_import_batches') &&
          text.includes('client_request_id = $2')
        ) {
          return {
            rows: [{ id: batchId, payload_matches: true }],
            rowCount: 1,
            values,
          };
        }
        return { rows: [], rowCount: 0, values };
      },
    );
    jest.mocked(loadAtlasImportBatchForUser).mockResolvedValue(batchDto);

    await expect(createAtlasImportBatchAction(createInput)).resolves.toEqual({
      ok: true,
      data: batchDto,
    });

    const existingCall = __testMocks.clientQuery.mock.calls.find(([query]) =>
      normalizeQuery(query).includes('client_request_id = $2'),
    );
    expect(existingCall?.[1]).toEqual([
      userId,
      clientRequestId,
      expect.stringMatching(/^[0-9a-f]{64}$/),
    ]);
    expect(normalizeQuery(existingCall?.[0])).toContain(
      'payload_fingerprint = $3::char(64)',
    );
    expect(
      __testMocks.clientQuery.mock.calls.some(([query]) =>
        normalizeQuery(query).includes('INSERT INTO atlas_import_batches'),
      ),
    ).toBe(false);
  });

  it('rejects an edited payload that reuses an existing idempotency key', async () => {
    __testMocks.clientQuery.mockImplementation(async (query: string) => {
      const text = normalizeQuery(query);
      if (
        text.includes('FROM atlas_import_batches') &&
        text.includes('client_request_id = $2')
      ) {
        return {
          rows: [{ id: batchId, payload_matches: false }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    await expect(
      createAtlasImportBatchAction({
        ...createInput,
        items: [
          {
            ...createInput.items[0],
            title: 'A title edited after the first request',
          },
        ],
      }),
    ).resolves.toMatchObject({ ok: false, error: 'conflict' });
    expect(loadAtlasImportBatchForUser).not.toHaveBeenCalled();
    expect(
      __testMocks.clientQuery.mock.calls.some(([query]) =>
        normalizeQuery(query).includes('INSERT INTO atlas_import_batches'),
      ),
    ).toBe(false);
    expect(
      __testMocks.clientQuery.mock.calls.map(([query]) =>
        normalizeQuery(query),
      ),
    ).toContain('ROLLBACK');
  });

  it('reports only same-user duplicate matches and creates no records', async () => {
    __testMocks.clientQuery.mockImplementation(
      async (query: string, values?: unknown[]) => {
        const text = normalizeQuery(query);
        if (text.includes('client_request_id = $2')) {
          return { rows: [], rowCount: 0 };
        }
        if (text.includes('WITH requested AS')) {
          return {
            rows: [
              {
                source_hash: sourceHash,
                entry_id: entryId,
                title: 'Above the tree line',
              },
            ],
            rowCount: 1,
            values,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    );

    const result = await createAtlasImportBatchAction(createInput);
    expect(result).toMatchObject({
      ok: false,
      error: 'duplicate',
      duplicates: [{ clientItemId: itemId, entryId }],
    });
    const duplicateCall = __testMocks.clientQuery.mock.calls.find(([query]) =>
      normalizeQuery(query).includes('WITH requested AS'),
    );
    expect(duplicateCall?.[1]).toEqual([userId, [sourceHash]]);
    expect(normalizeQuery(duplicateCall?.[0])).toContain('media.user_id = $1');
    expect(normalizeQuery(duplicateCall?.[0])).toContain('item.user_id = $1');
    expect(normalizeQuery(duplicateCall?.[0])).toContain(
      "batch.status IN ('uploading', 'ready', 'completed')",
    );
  });

  it('allows a fresh import when three cancelled batches await cleanup', async () => {
    __testMocks.clientQuery.mockImplementation(async (query: string) => {
      const text = normalizeQuery(query);
      if (text.includes('client_request_id = $2')) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('WITH requested AS')) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('AS open_batches')) {
        return {
          rows: [
            {
              open_batches: 0,
              retained_cleanup_batches: 3,
              live_entries: 3,
            },
          ],
          rowCount: 1,
        };
      }
      if (text.includes('INSERT INTO atlas_import_batches')) {
        return { rows: [{ id: batchId }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    jest.mocked(loadAtlasImportBatchForUser).mockResolvedValue(batchDto);

    await expect(createAtlasImportBatchAction(createInput)).resolves.toEqual({
      ok: true,
      data: batchDto,
    });
    const usageQuery = __testMocks.clientQuery.mock.calls.find(([query]) =>
      normalizeQuery(query).includes('AS open_batches'),
    );
    const normalizedUsageQuery = normalizeQuery(usageQuery?.[0]);
    expect(normalizedUsageQuery).toContain("status IN ('uploading', 'ready')");
    expect(normalizedUsageQuery).toContain("status = 'cancel_pending'");
  });

  it('bounds retained cancellation cleanup before opening another import', async () => {
    __testMocks.clientQuery.mockImplementation(async (query: string) => {
      const text = normalizeQuery(query);
      if (text.includes('client_request_id = $2')) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('WITH requested AS')) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('AS open_batches')) {
        return {
          rows: [
            {
              open_batches: 0,
              retained_cleanup_batches: 20,
              live_entries: 0,
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    await expect(createAtlasImportBatchAction(createInput)).resolves.toEqual({
      ok: false,
      error: 'limit',
      message:
        'Cancelled photo imports are still being cleaned up. Try starting a new import after cleanup finishes.',
    });
    expect(
      __testMocks.clientQuery.mock.calls.some(([query]) =>
        normalizeQuery(query).includes('INSERT INTO atlas_import_batches'),
      ),
    ).toBe(false);
  });

  it('releases a registered photo identity and immediately accepts the same file in a new import', async () => {
    const retryBatchId = '11572aa1-30cc-4d17-b8d6-ef78ef196537';
    const retryClientRequestId = '72c1104e-48c2-480a-a9e5-149431f9278c';
    let sourceIdentityClaimed = true;
    __testMocks.clientQuery.mockImplementation(async (query: string) => {
      const text = normalizeQuery(query);
      if (
        text.includes('SELECT id, status, version') &&
        text.includes('FROM atlas_import_batches')
      ) {
        return {
          rows: [
            {
              id: batchId,
              status: 'ready',
              version: 4,
              item_count: 1,
              chapter_title: '',
              chapter_introduction: '',
              cover_client_item_id: null,
            },
          ],
          rowCount: 1,
        };
      }
      if (text.includes('UPDATE atlas_media AS media')) {
        sourceIdentityClaimed = false;
        return { rows: [], rowCount: 1 };
      }
      if (text.includes('client_request_id = $2')) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('WITH requested AS')) {
        return sourceIdentityClaimed
          ? {
              rows: [
                {
                  source_hash: sourceHash,
                  entry_id: entryId,
                  title: 'Above the tree line',
                },
              ],
              rowCount: 1,
            }
          : { rows: [], rowCount: 0 };
      }
      if (text.includes('AS open_batches')) {
        return {
          rows: [
            {
              open_batches: 0,
              retained_cleanup_batches: 1,
              live_entries: 1,
            },
          ],
          rowCount: 1,
        };
      }
      if (text.includes('INSERT INTO atlas_import_batches')) {
        return { rows: [{ id: retryBatchId }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    await expect(
      cancelAtlasImportBatchAction({ batchId, version: 4 }),
    ).resolves.toEqual({
      ok: true,
      data: { batchId, cleanupPending: true },
    });

    const queries = __testMocks.clientQuery.mock.calls.map(([query]) =>
      normalizeQuery(query),
    );
    const cancellation = queries.findIndex(
      (query) =>
        query.includes('UPDATE atlas_import_batches') &&
        query.includes("status = 'cancel_pending'"),
    );
    const sourceRelease = queries.findIndex(
      (query) =>
        query.includes('UPDATE atlas_media AS media') &&
        query.includes('SET source_hash = NULL'),
    );
    const commit = queries.lastIndexOf('COMMIT');
    expect(cancellation).toBeGreaterThan(-1);
    expect(sourceRelease).toBeGreaterThan(cancellation);
    expect(sourceRelease).toBeLessThan(commit);
    expect(queries[sourceRelease]).toContain(
      'media.id = item.expected_media_id',
    );

    const retryBatch = {
      ...batchDto,
      id: retryBatchId,
      clientRequestId: retryClientRequestId,
    };
    jest.mocked(loadAtlasImportBatchForUser).mockResolvedValue(retryBatch);
    await expect(
      createAtlasImportBatchAction({
        ...createInput,
        clientRequestId: retryClientRequestId,
      }),
    ).resolves.toEqual({ ok: true, data: retryBatch });
    expect(sourceIdentityClaimed).toBe(false);
    expect(loadAtlasImportBatchForUser).toHaveBeenCalledWith(
      userId,
      retryBatchId,
    );
    const usageQuery = __testMocks.clientQuery.mock.calls.find(([query]) =>
      normalizeQuery(query).includes('AS open_batches'),
    );
    expect(normalizeQuery(usageQuery?.[0])).toContain(
      "cancelled_batch.status IN ('cancel_pending', 'cancelled')",
    );
    const batchInsert = __testMocks.clientQuery.mock.calls.find(([query]) =>
      normalizeQuery(query).includes('INSERT INTO atlas_import_batches'),
    );
    expect(normalizeQuery(batchInsert?.[0])).toContain('payload_fingerprint');
    expect(batchInsert?.[1]?.[2]).toEqual(
      expect.stringMatching(/^[0-9a-f]{64}$/),
    );
    expect(batchInsert?.[1]?.[6]).toBeNull();
    const itemInsert = __testMocks.clientQuery.mock.calls.find(([query]) =>
      normalizeQuery(query).includes('INSERT INTO atlas_import_items'),
    );
    expect(normalizeQuery(itemInsert?.[0])).toContain('date_confirmed');
    expect(String(itemInsert?.[1]?.[1])).toContain('"date_confirmed":true');
  });

  it('keeps cancelled and archived hashes reusable in the unapplied schema', () => {
    const migration = readFileSync(
      join(process.cwd(), 'migrations/024_atlas_bulk_imports.sql'),
      'utf8',
    );
    const itemTable = migration.slice(
      migration.indexOf('CREATE TABLE IF NOT EXISTS atlas_import_items'),
      migration.indexOf(
        'CREATE INDEX IF NOT EXISTS atlas_import_items_batch_status_idx',
      ),
    );

    expect(itemTable).not.toContain('UNIQUE (user_id, source_hash)');
    expect(itemTable).not.toContain('atlas_import_items_user_source_unique');
    expect(migration).toContain('payload_fingerprint CHAR(64) NOT NULL');
    expect(migration).toContain(
      'atlas_import_batches_payload_fingerprint_valid',
    );
    expect(migration).toContain('cover_client_item_id UUID');
    expect(migration).toContain(
      'atlas_import_batches_chapter_intent_consistent',
    );
    expect(migration).toContain('date_confirmed BOOLEAN NOT NULL');
    expect(migration).toContain('atlas_import_items_file_date_confirmed');
    expect(migration).toContain(
      'CREATE TABLE IF NOT EXISTS atlas_import_geocode_global_usage',
    );
    expect(migration).toContain('in_flight_token UUID');
    expect(migration).toContain('in_flight_until TIMESTAMPTZ');
    expect(migration).toContain(
      'atlas_import_geocode_global_usage_lease_consistent',
    );
  });

  it('treats prepared dimensions as immutable and idempotent', async () => {
    __testMocks.clientQuery.mockImplementation(async (query: string) => {
      const text = normalizeQuery(query);
      if (
        text.includes('SELECT status FROM atlas_import_batches') &&
        text.includes('FOR UPDATE')
      ) {
        return { rows: [{ status: 'uploading' }], rowCount: 1 };
      }
      if (text.includes('FROM atlas_import_items AS item')) {
        return {
          rows: [
            {
              id: itemId,
              status: 'pending',
              source_width: 4032,
              source_height: 3024,
              media_width: 2560,
              media_height: 1920,
              prepared_byte_size: 5_000_000,
              thumbnail_byte_size: 300_000,
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const result = await prepareAtlasImportItemAction({
      batchId,
      itemId,
      sourceWidth: 4032,
      sourceHeight: 3024,
      mediaWidth: 2000,
      mediaHeight: 1500,
      preparedByteSize: 4_000_000,
      thumbnailByteSize: 300_000,
    });
    expect(result).toMatchObject({ ok: false, error: 'conflict' });
    expect(
      __testMocks.clientQuery.mock.calls.some(([query]) =>
        normalizeQuery(query).includes('UPDATE atlas_import_items'),
      ),
    ).toBe(false);
  });

  it('rejects a finalization cover that differs from persisted chapter intent', async () => {
    const persistedCoverClientItemId = 'd88932bb-661a-4fb3-8123-e0742d577293';
    const persistedCoverMediaId = 'a1bb3af5-c510-41a8-bff5-c1c1dc6c0848';
    __testMocks.clientQuery.mockImplementation(async (query: string) => {
      const text = normalizeQuery(query);
      if (
        text.includes('FROM atlas_import_batches') &&
        text.includes('FOR UPDATE')
      ) {
        return {
          rows: [
            {
              id: batchId,
              status: 'ready',
              version: 1,
              item_count: 2,
              chapter_title: 'A chapter in motion',
              chapter_introduction: '',
              cover_client_item_id: persistedCoverClientItemId,
            },
          ],
          rowCount: 1,
        };
      }
      if (text.includes('FROM atlas_import_items AS item')) {
        return {
          rows: [
            {
              client_item_id: itemId,
              entry_id: entryId,
              expected_media_id: mediaId,
              position: 0,
              status: 'uploaded',
              title: 'First memory',
              media_id: mediaId,
            },
            {
              client_item_id: persistedCoverClientItemId,
              entry_id: '0dc3d929-e644-46ca-be4d-8a506994bb40',
              expected_media_id: persistedCoverMediaId,
              position: 1,
              status: 'uploaded',
              title: 'Chosen cover',
              media_id: persistedCoverMediaId,
            },
          ],
          rowCount: 2,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    await expect(
      finalizeAtlasImportBatchAction({
        batchId,
        version: 1,
        createChapter: true,
        coverMediaId: mediaId,
      }),
    ).resolves.toMatchObject({ ok: false, error: 'conflict' });
    expect(
      __testMocks.clientQuery.mock.calls.some(([query]) =>
        normalizeQuery(query).includes('INSERT INTO atlas_chapters'),
      ),
    ).toBe(false);
  });

  it('returns an already-completed finalization without repeating writes', async () => {
    __testMocks.clientQuery.mockImplementation(async (query: string) => {
      const text = normalizeQuery(query);
      if (
        text.includes('SELECT id, status, version') &&
        text.includes('FOR UPDATE')
      ) {
        return {
          rows: [
            {
              id: batchId,
              status: 'completed',
              version: 2,
              item_count: 1,
              chapter_title: '',
              chapter_introduction: '',
              cover_client_item_id: null,
            },
          ],
        };
      }
      if (text.includes('SELECT entry_id FROM atlas_import_items')) {
        return { rows: [{ entry_id: entryId }] };
      }
      if (text.includes('SELECT id, share_id FROM atlas_chapters')) {
        return { rows: [] };
      }
      return { rows: [], rowCount: 0 };
    });

    await expect(
      finalizeAtlasImportBatchAction({
        batchId,
        version: 1,
        createChapter: false,
        coverMediaId: null,
      }),
    ).resolves.toEqual({
      ok: true,
      data: {
        batchId,
        version: 2,
        entryIds: [entryId],
        chapterId: null,
        shareId: null,
      },
    });
    expect(
      __testMocks.clientQuery.mock.calls.some(([query]) =>
        normalizeQuery(query).startsWith('UPDATE'),
      ),
    ).toBe(false);
  });

  it('serves a fresh durable geocoder cache hit without upstream usage', async () => {
    __testMocks.clientQuery.mockImplementation(async (query: string) => {
      const text = normalizeQuery(query);
      if (text.includes('FROM atlas_import_geocode_cache')) {
        return {
          rows: [
            {
              status: 'ready',
              lease_token: null,
              leased_until: null,
              place_name: 'Twin Lakes',
              locality: 'Twin Lakes',
              region: 'Colorado',
              country: 'United States',
              country_code: 'US',
              geocoder: 'nominatim',
              geocoded_at: new Date('2026-08-18T12:00:00.000Z'),
              expires_at: new Date(Date.now() + 60_000),
            },
          ],
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const result = await resolveAtlasImportPlaceAction({
      latitude: 39.1176694,
      longitude: -106.4454111,
    });
    expect(result).toMatchObject({
      ok: true,
      data: { placeName: 'Twin Lakes', region: 'Colorado' },
    });
    expect(lookupAtlasPlace).not.toHaveBeenCalled();
    expect(
      __testMocks.clientQuery.mock.calls.some(([query]) =>
        normalizeQuery(query).includes('atlas_import_geocode_usage'),
      ),
    ).toBe(false);
  });

  it('gives a bounded retry for an in-flight same-coordinate lookup', async () => {
    __testMocks.clientQuery.mockImplementation(async (query: string) => {
      const text = normalizeQuery(query);
      if (text.includes('FROM atlas_import_geocode_cache')) {
        return {
          rows: [
            {
              status: 'pending',
              lease_token: 'b227c7de-fdb3-4682-bc2a-135170aaf9b2',
              leased_until: new Date(Date.now() + 5_000),
              place_name: null,
              locality: null,
              region: null,
              country: null,
              country_code: null,
              geocoder: null,
              geocoded_at: null,
              expires_at: new Date(Date.now() + 5_000),
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const result = await resolveAtlasImportPlaceAction({
      latitude: 39.1176694,
      longitude: -106.4454111,
    });
    expect(result).toMatchObject({ ok: false, error: 'limit' });
    expect(result).toHaveProperty('retryAfterMs', 750);
    expect(lookupAtlasPlace).not.toHaveBeenCalled();
    expect(
      __testMocks.clientQuery.mock.calls.some(([query]) =>
        normalizeQuery(query).includes('atlas_import_geocode_usage'),
      ),
    ).toBe(false);
  });

  it('enforces the transaction-safe one-second geocoder interval', async () => {
    __testMocks.clientQuery.mockImplementation(async (query: string) => {
      const text = normalizeQuery(query);
      if (text.includes('FROM atlas_import_geocode_cache')) {
        return { rows: [] };
      }
      if (text.includes('FROM atlas_import_geocode_usage')) {
        return {
          rows: [
            {
              request_count: 1,
              window_expired: false,
              too_fast: true,
              retry_after_ms: 400,
            },
          ],
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const result = await resolveAtlasImportPlaceAction({
      latitude: 39.1176694,
      longitude: -106.4454111,
    });
    expect(result).toMatchObject({
      ok: false,
      error: 'limit',
      retryAfterMs: 400,
    });
    expect(lookupAtlasPlace).not.toHaveBeenCalled();
    expect(
      __testMocks.clientQuery.mock.calls.some(([query]) =>
        normalizeQuery(query).includes(
          'INSERT INTO atlas_import_geocode_cache',
        ),
      ),
    ).toBe(false);
  });

  it('surfaces hourly geocoder exhaustion without a short-retry instruction', async () => {
    __testMocks.clientQuery.mockImplementation(async (query: string) => {
      const text = normalizeQuery(query);
      if (text.includes('FROM atlas_import_geocode_cache')) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('FROM atlas_import_geocode_usage')) {
        return {
          rows: [
            {
              request_count: 120,
              window_expired: false,
              too_fast: true,
              retry_after_ms: 400,
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    const result = await resolveAtlasImportPlaceAction({
      latitude: 39.1176694,
      longitude: -106.4454111,
    });
    expect(result).toMatchObject({ ok: false, error: 'limit' });
    expect(result).not.toHaveProperty('retryAfterMs');
    expect(lookupAtlasPlace).not.toHaveBeenCalled();
    expect(
      __testMocks.clientQuery.mock.calls.some(([query]) =>
        normalizeQuery(query).includes(
          'FROM atlas_import_geocode_global_usage',
        ),
      ),
    ).toBe(false);
  });

  it('atomically claims missing cache and usage rows before one upstream lookup', async () => {
    process.env.ATLAS_GEOCODER_MIN_INTERVAL_MS = '250';
    __testMocks.clientQuery.mockImplementation(async (query: string) => {
      const text = normalizeQuery(query);
      if (text.includes('FROM atlas_import_geocode_cache')) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('FROM atlas_import_geocode_usage')) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('FROM atlas_import_geocode_global_usage')) {
        return { rows: [{ too_fast: false }], rowCount: 1 };
      }
      if (text.startsWith('UPDATE atlas_import_geocode_global_usage')) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    __testMocks.taggedQuery.mockResolvedValue({
      rows: [{ cache_key: 'claimed' }],
      rowCount: 1,
    });
    jest.mocked(lookupAtlasPlace).mockResolvedValue({
      ok: true,
      data: {
        placeName: 'Twin Lakes, Colorado',
        locality: 'Twin Lakes',
        region: 'Colorado',
        country: 'United States',
        countryCode: 'US',
        geocoder: 'nominatim',
        geocodedAt: '2026-08-18T12:00:00.000Z',
      },
    });

    await expect(
      resolveAtlasImportPlaceAction({
        latitude: 39.1176694,
        longitude: -106.4454111,
      }),
    ).resolves.toMatchObject({
      ok: true,
      data: { locality: 'Twin Lakes', region: 'Colorado' },
    });

    const queries = __testMocks.clientQuery.mock.calls.map(([query]) =>
      normalizeQuery(query),
    );
    const cacheClaim = queries.findIndex((query) =>
      query.includes('atlas-import-geocode-cache:'),
    );
    const cacheRead = queries.findIndex((query) =>
      query.includes('FROM atlas_import_geocode_cache'),
    );
    const userClaim = queries.findIndex((query) =>
      query.includes('atlas-import-geocode-user:'),
    );
    const usageRead = queries.findIndex((query) =>
      query.includes('FROM atlas_import_geocode_usage'),
    );
    const globalRead = queries.findIndex((query) =>
      query.includes('FROM atlas_import_geocode_global_usage'),
    );
    const globalUpdate = queries.findIndex((query) =>
      query.startsWith('UPDATE atlas_import_geocode_global_usage'),
    );
    expect(cacheClaim).toBeLessThan(cacheRead);
    expect(userClaim).toBeLessThan(usageRead);
    expect(globalRead).toBeLessThan(globalUpdate);
    const usageCall = __testMocks.clientQuery.mock.calls.find(([query]) =>
      normalizeQuery(query).includes('FROM atlas_import_geocode_usage'),
    );
    const globalCall = __testMocks.clientQuery.mock.calls.find(([query]) =>
      normalizeQuery(query).includes('FROM atlas_import_geocode_global_usage'),
    );
    expect(usageCall?.[1]).toEqual([userId, 250]);
    expect(globalCall?.[1]).toEqual([250]);
    expect(lookupAtlasPlace).toHaveBeenCalledTimes(1);
  });

  it('enforces the application-wide upstream geocoder interval', async () => {
    __testMocks.clientQuery.mockImplementation(async (query: string) => {
      const text = normalizeQuery(query);
      if (text.includes('FROM atlas_import_geocode_cache')) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('FROM atlas_import_geocode_usage')) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('FROM atlas_import_geocode_global_usage')) {
        return {
          rows: [{ too_fast: true, retry_after_ms: 325 }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 0 };
    });

    await expect(
      resolveAtlasImportPlaceAction({
        latitude: 39.1176694,
        longitude: -106.4454111,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: 'limit',
      retryAfterMs: 325,
    });
    expect(lookupAtlasPlace).not.toHaveBeenCalled();
    expect(
      __testMocks.clientQuery.mock.calls.some(([query]) =>
        normalizeQuery(query).includes(
          'INSERT INTO atlas_import_geocode_cache',
        ),
      ),
    ).toBe(false);
  });

  it('releases the pending claim and preserves provider retry timing', async () => {
    __testMocks.clientQuery.mockImplementation(async (query: string) => {
      const text = normalizeQuery(query);
      if (text.includes('FROM atlas_import_geocode_cache')) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('FROM atlas_import_geocode_usage')) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('FROM atlas_import_geocode_global_usage')) {
        return {
          rows: [
            {
              in_flight: false,
              in_flight_retry_after_ms: 0,
              too_fast: false,
              retry_after_ms: 0,
            },
          ],
          rowCount: 1,
        };
      }
      if (text.startsWith('UPDATE atlas_import_geocode_global_usage')) {
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });
    __testMocks.taggedQuery.mockResolvedValue({ rows: [], rowCount: 1 });
    jest.mocked(lookupAtlasPlace).mockResolvedValue({
      ok: false,
      reason: 'rate-limited',
      retryAfterMs: 2_300,
    });

    await expect(
      resolveAtlasImportPlaceAction({
        latitude: 39.1176694,
        longitude: -106.4454111,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: 'provider',
      retryAfterMs: 2_300,
    });
    const taggedQueries = __testMocks.taggedQuery.mock.calls.map(([strings]) =>
      normalizeQuery(Array.from(strings as TemplateStringsArray).join(' ')),
    );
    expect(taggedQueries).toEqual(
      expect.arrayContaining([
        expect.stringContaining('DELETE FROM atlas_import_geocode_cache'),
        expect.stringContaining('UPDATE atlas_import_geocode_global_usage'),
      ]),
    );
    expect(
      taggedQueries.find((query) =>
        query.includes('DELETE FROM atlas_import_geocode_cache'),
      ),
    ).toContain('AND lease_token =');
  });

  it('holds one global upstream lease across users and coordinate keys until fetch settles', async () => {
    const secondUserId = 'b208e745-9209-4310-a8b4-b7f6ff058d3d';
    let globalInFlight = false;
    let resolveUpstream!: (
      place: Awaited<ReturnType<typeof lookupAtlasPlace>>,
    ) => void;
    let signalUpstreamStarted!: () => void;
    const upstreamStarted = new Promise<void>((resolve) => {
      signalUpstreamStarted = resolve;
    });
    const upstreamResult = new Promise<
      Awaited<ReturnType<typeof lookupAtlasPlace>>
    >((resolve) => {
      resolveUpstream = resolve;
    });

    jest
      .mocked(requireVerifiedSession)
      .mockResolvedValueOnce({ user: { id: userId } } as Awaited<
        ReturnType<typeof requireVerifiedSession>
      >)
      .mockResolvedValueOnce({ user: { id: secondUserId } } as Awaited<
        ReturnType<typeof requireVerifiedSession>
      >);
    __testMocks.clientQuery.mockImplementation(
      async (query: string, values?: unknown[]) => {
        const text = normalizeQuery(query);
        if (text.includes('FROM atlas_import_geocode_cache')) {
          return { rows: [], rowCount: 0 };
        }
        if (text.includes('FROM atlas_import_geocode_usage')) {
          return { rows: [], rowCount: 0 };
        }
        if (text.includes('FROM atlas_import_geocode_global_usage')) {
          return {
            rows: [
              {
                in_flight: globalInFlight,
                in_flight_retry_after_ms: globalInFlight ? 9_000 : 0,
                too_fast: false,
                retry_after_ms: 0,
              },
            ],
            rowCount: 1,
          };
        }
        if (text.startsWith('UPDATE atlas_import_geocode_global_usage')) {
          expect(values).toEqual([expect.any(String), 10]);
          globalInFlight = true;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    );
    __testMocks.taggedQuery.mockImplementation(
      async (strings: TemplateStringsArray) => {
        const text = normalizeQuery(Array.from(strings).join(' '));
        if (text.includes('UPDATE atlas_import_geocode_global_usage')) {
          expect(text).toContain('AND in_flight_token =');
          globalInFlight = false;
          return { rows: [], rowCount: 1 };
        }
        return { rows: [{ cache_key: 'claimed' }], rowCount: 1 };
      },
    );
    jest.mocked(lookupAtlasPlace).mockImplementationOnce(async () => {
      signalUpstreamStarted();
      return upstreamResult;
    });

    const firstLookup = resolveAtlasImportPlaceAction({
      latitude: 39.1176694,
      longitude: -106.4454111,
    });
    await upstreamStarted;

    const secondLookup = await resolveAtlasImportPlaceAction({
      latitude: 35.6762,
      longitude: 139.6503,
    });
    expect(secondLookup).toMatchObject({
      ok: false,
      error: 'limit',
      retryAfterMs: 9_000,
    });
    expect(lookupAtlasPlace).toHaveBeenCalledTimes(1);

    const advisoryKeys = __testMocks.clientQuery.mock.calls
      .filter(([, values]) =>
        String(values?.[0]).startsWith('atlas-import-geocode-cache:'),
      )
      .map(([, values]) => values?.[0]);
    expect(new Set(advisoryKeys).size).toBe(2);
    const userKeys = __testMocks.clientQuery.mock.calls
      .filter(([, values]) =>
        String(values?.[0]).startsWith('atlas-import-geocode-user:'),
      )
      .map(([, values]) => values?.[0]);
    expect(userKeys).toEqual([
      `atlas-import-geocode-user:${userId}`,
      `atlas-import-geocode-user:${secondUserId}`,
    ]);

    resolveUpstream({
      ok: true,
      data: {
        placeName: 'Twin Lakes, Colorado',
        locality: 'Twin Lakes',
        region: 'Colorado',
        country: 'United States',
        countryCode: 'US',
        geocoder: 'nominatim',
        geocodedAt: '2026-08-18T12:00:00.000Z',
      },
    });
    await expect(firstLookup).resolves.toMatchObject({ ok: true });
    expect(globalInFlight).toBe(false);

    jest.mocked(lookupAtlasPlace).mockResolvedValueOnce({
      ok: false,
      reason: 'not-found',
    });
    await expect(
      resolveAtlasImportPlaceAction({
        latitude: -33.8688,
        longitude: 151.2093,
      }),
    ).resolves.toMatchObject({ ok: false, error: 'failed' });
    expect(globalInFlight).toBe(false);
    const releaseQueries = __testMocks.taggedQuery.mock.calls
      .map(([strings]) =>
        normalizeQuery(Array.from(strings as TemplateStringsArray).join(' ')),
      )
      .filter((query) =>
        query.includes('UPDATE atlas_import_geocode_global_usage'),
      );
    expect(releaseQueries).toHaveLength(2);
    expect(
      releaseQueries.every((query) => query.includes('AND in_flight_token =')),
    ).toBe(true);
  });
});
