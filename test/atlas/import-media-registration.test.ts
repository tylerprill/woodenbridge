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
jest.mock('@/app/lib/atlas/media-storage', () => ({
  getAtlasBlobToken: () => 'blob-test-token',
}));
jest.mock('@/app/lib/atlas/rows', () => ({
  toAtlasMedia: jest.fn((row: { id: string; entry_id: string }) => ({
    id: row.id,
    entryId: row.entry_id,
  })),
}));
jest.mock('@/app/lib/atlas/upload-intents', () => ({
  lockAtlasMediaUploadIntentForRegistration: jest.fn(),
  consumeAtlasMediaUploadIntent: jest.fn(),
  discardAtlasMediaUploadIntent: jest.fn(),
}));
jest.mock('@vercel/blob', () => ({
  BlobNotFoundError: class BlobNotFoundError extends Error {},
  del: jest.fn(),
  head: jest.fn(),
  get: jest.fn(),
}));
jest.mock('sharp', () => ({
  __esModule: true,
  default: jest.fn((bytes: Buffer) => ({
    metadata: jest.fn(async () =>
      bytes.toString() === 'main'
        ? { format: 'jpeg', width: 1000, height: 750 }
        : { format: 'webp', width: 1000, height: 750 },
    ),
  })),
}));

import { BlobNotFoundError, get, head } from '@vercel/blob';
import sharp from 'sharp';
import { requireVerifiedSession } from '@/app/lib/auth/session';
import {
  getAtlasImportMediaPairStatusAction,
  registerAtlasMediaAction,
} from '@/app/lib/actions/atlas-media';
import {
  consumeAtlasMediaUploadIntent,
  lockAtlasMediaUploadIntentForRegistration,
} from '@/app/lib/atlas/upload-intents';

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
const sourceHash = 'a'.repeat(64);
const pathname = `atlas/memories/${entryId}/${mediaId}.jpg`;
const thumbnailPathname = `atlas/memories/${entryId}/${mediaId}.thumbnail.webp`;

function normalizeQuery(query: unknown) {
  return String(query).replace(/\s+/g, ' ').trim();
}

function privateBlob(bytes: string) {
  return {
    statusCode: 200,
    stream: new Blob([bytes]).stream(),
  };
}

describe('Atlas import media registration', () => {
  beforeEach(() => {
    __testMocks.clientQuery.mockReset();
    __testMocks.release.mockReset();
    __testMocks.connect.mockClear();
    __testMocks.taggedQuery.mockReset();
    jest.mocked(requireVerifiedSession).mockResolvedValue({
      user: { id: userId },
    } as Awaited<ReturnType<typeof requireVerifiedSession>>);
    jest
      .mocked(lockAtlasMediaUploadIntentForRegistration)
      .mockResolvedValue(true);
    jest.mocked(consumeAtlasMediaUploadIntent).mockResolvedValue(true);
    jest.mocked(head).mockImplementation(
      async (requestedPath) =>
        (requestedPath === pathname
          ? {
              pathname,
              contentType: 'image/jpeg',
              size: 4,
            }
          : {
              pathname: thumbnailPathname,
              contentType: 'image/webp',
              size: 5,
            }) as never,
    );
    jest
      .mocked(get)
      .mockResolvedValueOnce(privateBlob('main') as never)
      .mockResolvedValueOnce(privateBlob('thumb') as never);
    jest.mocked(sharp).mockImplementation(((bytes: Buffer) => ({
      metadata: jest.fn(async () =>
        bytes.toString() === 'main'
          ? {
              format: 'jpeg',
              width: 1000,
              height: 750,
              icc: Buffer.alloc(456),
            }
          : {
              format: 'webp',
              width: 1000,
              height: 750,
              icc: Buffer.alloc(456),
            },
      ),
    })) as never);
  });

  it('accepts browser sRGB profiles and atomically marks the import ready', async () => {
    __testMocks.taggedQuery.mockResolvedValue({
      rows: [
        {
          id: entryId,
          import_item_id: itemId,
          import_batch_id: batchId,
          import_batch_status: 'uploading',
          expected_media_id: mediaId,
          source_hash: sourceHash,
          source_width: 4032,
          source_height: 3024,
          media_width: 1000,
          media_height: 750,
          prepared_byte_size: 4,
          expected_thumbnail_byte_size: 5,
          already_registered: false,
        },
      ],
      rowCount: 1,
    });
    __testMocks.clientQuery.mockImplementation(
      async (query: string, values?: unknown[]) => {
        const text = normalizeQuery(query);
        if (text.includes('SELECT batch_id FROM atlas_import_items')) {
          return { rows: [{ batch_id: batchId }] };
        }
        if (text.includes('SELECT status FROM atlas_import_batches')) {
          return { rows: [{ status: 'uploading' }] };
        }
        if (
          text.includes('FROM atlas_import_items') &&
          text.includes('media_width = $5')
        ) {
          return {
            rows: [
              {
                id: itemId,
                batch_id: batchId,
                status: 'pending',
                expected_media_id: mediaId,
                source_hash: sourceHash,
              },
            ],
          };
        }
        if (text.includes('SELECT title, place_label FROM atlas_entries')) {
          return { rows: [{ title: 'Above the tree line', place_label: '' }] };
        }
        if (
          text.includes('FROM atlas_media') &&
          text.includes('WHERE id = $1')
        ) {
          return { rows: [] };
        }
        if (text.includes('SELECT COUNT(*)::int AS count FROM atlas_media')) {
          return { rows: [{ count: 0 }] };
        }
        if (text.includes('INSERT INTO atlas_media')) {
          return {
            rows: [
              {
                id: mediaId,
                entry_id: entryId,
                storage_path: pathname,
                thumbnail_path: thumbnailPathname,
                mime_type: 'image/jpeg',
                width: 1000,
                height: 750,
                byte_size: 4,
                alt_text: 'Above the tree line',
                sort_order: 0,
                created_at: new Date('2026-08-18T12:00:00.000Z'),
              },
            ],
            values,
          };
        }
        if (text.includes("SET status = 'uploaded'")) {
          return { rows: [{ id: itemId }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    );

    await expect(
      registerAtlasMediaAction({
        entryId,
        mediaId,
        pathname,
        thumbnailPathname,
        width: 1000,
        height: 750,
        altText: '',
      }),
    ).resolves.toMatchObject({
      ok: true,
      data: { id: mediaId, entryId },
    });

    const queries = __testMocks.clientQuery.mock.calls.map(([query]) =>
      normalizeQuery(query),
    );
    expect(
      queries.some((query) => query.includes("SET status = 'uploaded'")),
    ).toBe(true);
    expect(
      queries.some(
        (query) =>
          query.includes("SET status = 'ready'") &&
          query.includes("pending.status <> 'uploaded'"),
      ),
    ).toBe(true);
    const insertCall = __testMocks.clientQuery.mock.calls.find(([query]) =>
      normalizeQuery(query).includes('INSERT INTO atlas_media'),
    );
    expect(insertCall?.[1]).toContain(sourceHash);
  });

  it('reports a committed original and missing thumbnail without allowing overwrite', async () => {
    __testMocks.taggedQuery.mockResolvedValue({
      rows: [
        {
          prepared_byte_size: 4,
          thumbnail_byte_size: 5,
          registered: false,
        },
      ],
      rowCount: 1,
    });
    jest.mocked(head).mockImplementation(async (requestedPath) => {
      if (requestedPath === pathname) {
        return {
          pathname,
          contentType: 'image/jpeg',
          size: 4,
        } as never;
      }
      throw new BlobNotFoundError();
    });

    await expect(
      getAtlasImportMediaPairStatusAction({
        entryId,
        mediaId,
        pathname,
        thumbnailPathname,
        width: 1000,
        height: 750,
        altText: '',
      }),
    ).resolves.toEqual({
      ok: true,
      data: {
        originalCommitted: true,
        thumbnailCommitted: false,
        registered: false,
      },
    });
    expect(head).toHaveBeenCalledTimes(2);
  });

  it('does not probe Blob storage for a foreign or cancelled import item', async () => {
    __testMocks.taggedQuery.mockResolvedValue({ rows: [], rowCount: 0 });

    await expect(
      getAtlasImportMediaPairStatusAction({
        entryId,
        mediaId,
        pathname,
        thumbnailPathname,
        width: 1000,
        height: 750,
        altText: '',
      }),
    ).resolves.toMatchObject({ ok: false, error: 'not-found' });
    expect(head).not.toHaveBeenCalled();
  });

  it('rejects a metadata-free thumbnail that does not match the master dimensions', async () => {
    __testMocks.taggedQuery.mockResolvedValue({
      rows: [
        {
          id: entryId,
          import_item_id: itemId,
          import_batch_id: batchId,
          import_batch_status: 'uploading',
          expected_media_id: mediaId,
          source_hash: sourceHash,
          source_width: 4032,
          source_height: 3024,
          media_width: 1000,
          media_height: 750,
          prepared_byte_size: 4,
          expected_thumbnail_byte_size: 5,
          already_registered: false,
        },
      ],
      rowCount: 1,
    });
    jest.mocked(sharp).mockImplementation(((bytes: Buffer) => ({
      metadata: jest.fn(async () =>
        bytes.toString() === 'main'
          ? { format: 'jpeg', width: 1000, height: 750 }
          : { format: 'webp', width: 1, height: 1 },
      ),
    })) as never);

    await expect(
      registerAtlasMediaAction({
        entryId,
        mediaId,
        pathname,
        thumbnailPathname,
        width: 1000,
        height: 750,
        altText: '',
      }),
    ).resolves.toMatchObject({ ok: false, error: 'invalid' });
    expect(__testMocks.connect).not.toHaveBeenCalled();
  });

  it('rejects imported derivatives that retain private EXIF metadata', async () => {
    __testMocks.taggedQuery.mockResolvedValue({
      rows: [
        {
          id: entryId,
          import_item_id: itemId,
          import_batch_id: batchId,
          import_batch_status: 'uploading',
          expected_media_id: mediaId,
          source_hash: sourceHash,
          source_width: 4032,
          source_height: 3024,
          media_width: 1000,
          media_height: 750,
          prepared_byte_size: 4,
          expected_thumbnail_byte_size: 5,
          already_registered: false,
        },
      ],
      rowCount: 1,
    });
    jest.mocked(sharp).mockImplementation(((bytes: Buffer) => ({
      metadata: jest.fn(async () =>
        bytes.toString() === 'main'
          ? {
              format: 'jpeg',
              width: 1000,
              height: 750,
              exif: Buffer.from('private-photo-metadata'),
            }
          : { format: 'webp', width: 1000, height: 750 },
      ),
    })) as never);

    await expect(
      registerAtlasMediaAction({
        entryId,
        mediaId,
        pathname,
        thumbnailPathname,
        width: 1000,
        height: 750,
        altText: '',
      }),
    ).resolves.toMatchObject({ ok: false, error: 'invalid' });
    expect(__testMocks.connect).not.toHaveBeenCalled();
  });
});
