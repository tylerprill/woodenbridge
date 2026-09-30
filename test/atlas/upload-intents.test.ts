jest.mock('@vercel/postgres', () => {
  const clientQuery = jest.fn();
  const release = jest.fn();
  const connect = jest.fn(async () => ({ query: clientQuery, release }));
  const taggedQuery = jest.fn();
  const textQuery = jest.fn();
  Object.assign(taggedQuery, { query: textQuery });

  return {
    db: { connect },
    sql: taggedQuery,
    __testMocks: {
      clientQuery,
      release,
      connect,
      taggedQuery,
      textQuery,
    },
  };
});

jest.mock('@/app/lib/atlas/media-storage', () => ({
  deleteAtlasMediaObjects: jest.fn(),
}));
jest.mock('@/app/lib/atlas/media-deletion-outbox', () => ({
  enqueueAtlasMediaDeletionWithinTransaction: jest.fn(async () => 'job-id'),
}));
jest.mock('@/app/lib/atlas/media-deletion-scheduler', () => ({
  scheduleAtlasMediaDeletion: jest.fn(),
}));

import { deleteAtlasMediaObjects } from '@/app/lib/atlas/media-storage';
import { enqueueAtlasMediaDeletionWithinTransaction } from '@/app/lib/atlas/media-deletion-outbox';
import { scheduleAtlasMediaDeletion } from '@/app/lib/atlas/media-deletion-scheduler';

import {
  AtlasUploadIntentError,
  cleanupExpiredAtlasMediaUploadIntents,
  consumeAtlasMediaUploadIntent,
  discardAtlasMediaUploadIntent,
  lockAtlasMediaUploadIntentForRegistration,
  markAtlasMediaUploadCompleted,
  reserveAtlasMediaUploadVariant,
} from '@/app/lib/atlas/upload-intents';

const { __testMocks } = jest.requireMock('@vercel/postgres') as {
  __testMocks: {
    clientQuery: jest.Mock;
    release: jest.Mock;
    connect: jest.Mock;
    taggedQuery: jest.Mock;
    textQuery: jest.Mock;
  };
};

const userId = '17d69b97-9d24-4e07-a461-271263c71c52';
const entryId = 'f7c0bf19-59fc-49df-9bd7-ae405a69e49c';
const mediaId = '2df8f2d8-9fae-4c86-9578-3ed6179e262b';
const pathname = `atlas/memories/${entryId}/${mediaId}.jpg`;
const thumbnailPathname = `atlas/memories/${entryId}/${mediaId}.thumbnail.webp`;

const intent = {
  userId,
  entryId,
  mediaId,
  pathname,
  thumbnailPathname,
  variant: 'original' as const,
};

function normalizeQuery(query: unknown) {
  return String(query).replace(/\s+/g, ' ').trim();
}

function taggedQueryText(strings: TemplateStringsArray) {
  return strings.join(' ? ').replace(/\s+/g, ' ').trim();
}

describe('atlas media upload intent abuse controls', () => {
  beforeEach(() => {
    __testMocks.clientQuery.mockReset();
    __testMocks.release.mockReset();
    __testMocks.connect.mockClear();
    __testMocks.taggedQuery.mockReset();
    __testMocks.textQuery.mockReset();
    jest.mocked(deleteAtlasMediaObjects).mockReset();
    jest.mocked(enqueueAtlasMediaDeletionWithinTransaction).mockClear();
    jest.mocked(scheduleAtlasMediaDeletion).mockClear();
  });

  it('refuses to issue a Blob token after an import leaves uploading state', async () => {
    __testMocks.clientQuery.mockImplementation(
      async (query: string, values?: unknown[]) => {
        const text = normalizeQuery(query);
        if (
          text.includes(
            'SELECT batch_id, expected_media_id FROM atlas_import_items',
          )
        ) {
          expect(text).toContain('SELECT batch_id, expected_media_id');
          expect(values).toEqual([entryId, userId]);
          return {
            rows: [
              {
                batch_id: '3fe3cf16-c676-42cf-b3e6-87158c836fd9',
                expected_media_id: mediaId,
              },
            ],
          };
        }
        if (text.includes('SELECT status FROM atlas_import_batches')) {
          return { rows: [{ status: 'cancel_pending' }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    );

    await expect(reserveAtlasMediaUploadVariant(intent)).rejects.toMatchObject<
      Partial<AtlasUploadIntentError>
    >({ code: 'not-found' });

    const batchLockIndex = __testMocks.clientQuery.mock.calls.findIndex(
      ([query]) =>
        normalizeQuery(query).includes(
          'SELECT status FROM atlas_import_batches',
        ),
    );
    const entryLockIndex = __testMocks.clientQuery.mock.calls.findIndex(
      ([query]) =>
        normalizeQuery(query).includes('SELECT id FROM atlas_entries'),
    );
    expect(batchLockIndex).toBeGreaterThanOrEqual(0);
    expect(entryLockIndex).toBe(-1);
    expect(
      __testMocks.clientQuery.mock.calls.some(([query]) =>
        normalizeQuery(query).includes(
          'INSERT INTO atlas_media_upload_intents',
        ),
      ),
    ).toBe(false);
  });

  it('allows a normal photo append after the entry import is complete', async () => {
    __testMocks.clientQuery.mockImplementation(
      async (query: string, values?: unknown[]) => {
        const text = normalizeQuery(query);
        if (
          text.includes(
            'SELECT batch_id, expected_media_id FROM atlas_import_items',
          )
        ) {
          expect(text).toContain('SELECT batch_id, expected_media_id');
          expect(values).toEqual([entryId, userId]);
          return {
            rows: [
              {
                batch_id: '3fe3cf16-c676-42cf-b3e6-87158c836fd9',
                // The historical import item belongs to the original photo,
                // not the fresh media UUID used by the editor append.
                expected_media_id: '0bcdfb8e-a7c1-4dbd-9f3a-172de486b7d9',
              },
            ],
            rowCount: 1,
          };
        }
        if (text.includes('SELECT status FROM atlas_import_batches')) {
          return { rows: [{ status: 'completed' }], rowCount: 1 };
        }
        if (text.includes('SELECT id FROM atlas_entries')) {
          return { rows: [{ id: entryId }], rowCount: 1 };
        }
        if (
          text.includes('FROM atlas_media_upload_intents') &&
          text.includes('WHERE media_id = $1')
        ) {
          return { rows: [], rowCount: 0 };
        }
        if (text.includes('AS reserved_entry_count')) {
          return {
            rows: [
              {
                registered_entry_count: 1,
                reserved_entry_count: 0,
                registered_user_bytes: 1024,
                reserved_user_bytes: 0,
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 1 };
      },
    );

    await expect(reserveAtlasMediaUploadVariant(intent)).resolves.toEqual({
      validUntil: expect.any(Number),
    });

    const queries = __testMocks.clientQuery.mock.calls.map(([query]) =>
      normalizeQuery(query),
    );
    expect(
      queries.some((query) =>
        query.includes('SELECT status FROM atlas_import_batches'),
      ),
    ).toBe(true);
    expect(
      queries.some(
        (query) =>
          query.includes('SELECT id FROM atlas_import_items') &&
          query.includes('expected_media_id = $4'),
      ),
    ).toBe(false);
    expect(
      queries.some((query) =>
        query.includes('INSERT INTO atlas_media_upload_intents'),
      ),
    ).toBe(true);
    expect(queries.at(-1)).toBe('COMMIT');
  });

  it.each(['uploading', 'ready', 'cancel_pending'])(
    'does not let a new editor upload bypass an import in %s state',
    async (status) => {
      __testMocks.clientQuery.mockImplementation(async (query: string) => {
        const text = normalizeQuery(query);
        if (
          text.includes(
            'SELECT batch_id, expected_media_id FROM atlas_import_items',
          )
        ) {
          return {
            rows: [
              {
                batch_id: '3fe3cf16-c676-42cf-b3e6-87158c836fd9',
                expected_media_id: '0bcdfb8e-a7c1-4dbd-9f3a-172de486b7d9',
              },
            ],
          };
        }
        if (text.includes('SELECT status FROM atlas_import_batches')) {
          return { rows: [{ status }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      });

      await expect(
        reserveAtlasMediaUploadVariant(intent),
      ).rejects.toMatchObject<Partial<AtlasUploadIntentError>>({
        code: 'not-found',
      });

      expect(
        __testMocks.clientQuery.mock.calls.some(([query]) =>
          normalizeQuery(query).includes('SELECT id FROM atlas_entries'),
        ),
      ).toBe(false);
    },
  );

  it('locks an active import batch before its item and entry', async () => {
    __testMocks.clientQuery.mockImplementation(async (query: string) => {
      const text = normalizeQuery(query);
      if (
        text.includes(
          'SELECT batch_id, expected_media_id FROM atlas_import_items',
        )
      ) {
        return {
          rows: [
            {
              batch_id: '3fe3cf16-c676-42cf-b3e6-87158c836fd9',
              expected_media_id: mediaId,
            },
          ],
        };
      }
      if (text.includes('SELECT status FROM atlas_import_batches')) {
        return { rows: [{ status: 'uploading' }], rowCount: 1 };
      }
      if (
        text.includes('SELECT id FROM atlas_import_items') &&
        text.includes('expected_media_id = $4')
      ) {
        return { rows: [{ id: '1476ce67-531d-423a-a977-f6e895374419' }] };
      }
      if (text.includes('SELECT id FROM atlas_entries')) {
        return { rows: [{ id: entryId }], rowCount: 1 };
      }
      if (
        text.includes('FROM atlas_media_upload_intents') &&
        text.includes('WHERE media_id = $1')
      ) {
        return {
          rows: [
            {
              media_id: mediaId,
              user_id: userId,
              entry_id: entryId,
              original_path: `${pathname}.other`,
              thumbnail_path: thumbnailPathname,
              expires_at: new Date(Date.now() + 60_000),
              consumed_at: null,
              cleanup_started_at: null,
            },
          ],
        };
      }
      return { rows: [], rowCount: 0 };
    });

    await expect(reserveAtlasMediaUploadVariant(intent)).rejects.toMatchObject<
      Partial<AtlasUploadIntentError>
    >({ code: 'invalid' });

    const queries = __testMocks.clientQuery.mock.calls.map(([query]) =>
      normalizeQuery(query),
    );
    const batchLock = queries.findIndex((query) =>
      query.includes('SELECT status FROM atlas_import_batches'),
    );
    const itemLock = queries.findIndex(
      (query) =>
        query.includes('SELECT id FROM atlas_import_items') &&
        query.includes('expected_media_id = $4'),
    );
    const entryLock = queries.findIndex((query) =>
      query.includes('SELECT id FROM atlas_entries'),
    );
    expect(batchLock).toBeGreaterThanOrEqual(0);
    expect(itemLock).toBeGreaterThan(batchLock);
    expect(entryLock).toBeGreaterThan(itemLock);
  });

  it('counts abandoned and expired reservations against the per-entry limit', async () => {
    __testMocks.clientQuery.mockImplementation(
      async (query: string, values?: unknown[]) => {
        const text = normalizeQuery(query);

        if (text.includes('SELECT id FROM atlas_entries')) {
          return { rows: [{ id: entryId }], rowCount: 1 };
        }
        if (
          text.includes('FROM atlas_media_upload_intents') &&
          text.includes('WHERE media_id = $1')
        ) {
          return { rows: [], rowCount: 0 };
        }
        if (text.includes('AS reserved_entry_count')) {
          return {
            rows: [
              {
                registered_entry_count: 0,
                // This intentionally represents expired rows. The quota query
                // has no expiry filter because Blob cleanup has not succeeded.
                reserved_entry_count: 6,
                registered_user_bytes: 0,
                reserved_user_bytes: 6 * 12 * 1024 * 1024,
              },
            ],
            rowCount: 1,
          };
        }

        return { rows: [], rowCount: 0, values };
      },
    );

    await expect(reserveAtlasMediaUploadVariant(intent)).rejects.toMatchObject<
      Partial<AtlasUploadIntentError>
    >({ code: 'limit' });

    const calls = __testMocks.clientQuery.mock.calls.map(([query, values]) => ({
      query: normalizeQuery(query),
      values,
    }));
    expect(
      calls.find(({ query }) => query.includes('pg_advisory_xact_lock'))
        ?.values,
    ).toEqual([`atlas-upload:${userId}`]);
    expect(
      calls.some(({ query }) =>
        query.includes('INSERT INTO atlas_media_upload_intents'),
      ),
    ).toBe(false);
    expect(calls.at(-1)?.query).toBe('ROLLBACK');
    expect(__testMocks.release).toHaveBeenCalledTimes(1);
  });

  it('will not repurpose an existing media UUID for a different Blob pair', async () => {
    __testMocks.clientQuery.mockImplementation(async (query: string) => {
      const text = normalizeQuery(query);

      if (text.includes('SELECT id FROM atlas_entries')) {
        return { rows: [{ id: entryId }], rowCount: 1 };
      }
      if (
        text.includes('FROM atlas_media_upload_intents') &&
        text.includes('WHERE media_id = $1')
      ) {
        return {
          rows: [
            {
              media_id: mediaId,
              user_id: userId,
              entry_id: entryId,
              original_path: `atlas/memories/${entryId}/${mediaId}.png`,
              thumbnail_path: thumbnailPathname,
              expires_at: new Date(Date.now() + 60_000),
              consumed_at: null,
              cleanup_started_at: null,
            },
          ],
          rowCount: 1,
        };
      }

      return { rows: [], rowCount: 0 };
    });

    await expect(reserveAtlasMediaUploadVariant(intent)).rejects.toMatchObject<
      Partial<AtlasUploadIntentError>
    >({ code: 'invalid' });

    const queries = __testMocks.clientQuery.mock.calls.map(([query]) =>
      normalizeQuery(query),
    );
    expect(
      queries.some((query) => query.includes('original_authorized_at')),
    ).toBe(false);
    expect(queries.at(-1)).toBe('ROLLBACK');
  });

  it('will not reuse a UUID or path retained by the deletion queue', async () => {
    __testMocks.clientQuery.mockImplementation(async (query: string) => {
      const text = normalizeQuery(query);

      if (text.includes('SELECT id FROM atlas_entries')) {
        return { rows: [{ id: entryId }], rowCount: 1 };
      }
      if (
        text.includes('FROM atlas_media_upload_intents') &&
        text.includes('WHERE media_id = $1')
      ) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('FROM atlas_media_deletion_outbox')) {
        return { rows: [{ id: '83539fdb-9785-41e1-a5d5-04ec402bc98a' }] };
      }
      return { rows: [], rowCount: 0 };
    });

    await expect(reserveAtlasMediaUploadVariant(intent)).rejects.toMatchObject<
      Partial<AtlasUploadIntentError>
    >({ code: 'invalid' });

    const tombstoneQuery = __testMocks.clientQuery.mock.calls
      .map(([query]) => normalizeQuery(query))
      .find((query) => query.includes('FROM atlas_media_deletion_outbox'));
    expect(tombstoneQuery).toContain('original_path IN ($2, $3)');
    expect(tombstoneQuery).toContain('thumbnail_path IN ($2, $3)');
    expect(
      __testMocks.clientQuery.mock.calls.some(([query]) =>
        normalizeQuery(query).includes(
          'INSERT INTO atlas_media_upload_intents',
        ),
      ),
    ).toBe(false);
  });

  it('will not reserve a UUID or either path owned by live media', async () => {
    __testMocks.clientQuery.mockImplementation(async (query: string) => {
      const text = normalizeQuery(query);

      if (text.includes('SELECT id FROM atlas_entries')) {
        return { rows: [{ id: entryId }], rowCount: 1 };
      }
      if (
        text.includes('FROM atlas_media_upload_intents') &&
        text.includes('WHERE media_id = $1')
      ) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('FROM atlas_media')) {
        return { rows: [{ id: mediaId }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    await expect(reserveAtlasMediaUploadVariant(intent)).rejects.toMatchObject<
      Partial<AtlasUploadIntentError>
    >({ code: 'invalid' });

    const liveMediaQuery = __testMocks.clientQuery.mock.calls
      .map(([query]) => normalizeQuery(query))
      .find(
        (query) =>
          query.includes('FROM atlas_media') &&
          !query.includes('atlas_media_upload_intents'),
      );
    expect(liveMediaQuery).toContain('WHERE id = $1');
    expect(liveMediaQuery).toContain('storage_path IN ($2, $3)');
    expect(liveMediaQuery).toContain('thumbnail_path IN ($2, $3)');
    expect(
      __testMocks.clientQuery.mock.calls.some(([query]) =>
        normalizeQuery(query).includes('FROM atlas_media_deletion_outbox'),
      ),
    ).toBe(false);
    expect(
      __testMocks.clientQuery.mock.calls.some(([query]) =>
        normalizeQuery(query).includes(
          'INSERT INTO atlas_media_upload_intents',
        ),
      ),
    ).toBe(false);
  });

  it('rejects a completion callback whose Blob path does not match its signed variant', async () => {
    await expect(
      markAtlasMediaUploadCompleted({
        tokenPayload: {
          userId,
          entryId,
          mediaId,
          pathname,
          thumbnailPathname,
          variant: 'original',
        },
        pathname: thumbnailPathname,
      }),
    ).rejects.toMatchObject<Partial<AtlasUploadIntentError>>({
      code: 'invalid',
    });
    expect(__testMocks.textQuery).not.toHaveBeenCalled();
  });

  it.each(['original', 'thumbnail'] as const)(
    'rejects an expired %s completion callback',
    async (variant) => {
      __testMocks.textQuery.mockResolvedValue({ rows: [], rowCount: 0 });

      await expect(
        markAtlasMediaUploadCompleted({
          tokenPayload: {
            userId,
            entryId,
            mediaId,
            pathname,
            thumbnailPathname,
            variant,
          },
          pathname: variant === 'original' ? pathname : thumbnailPathname,
        }),
      ).rejects.toMatchObject<Partial<AtlasUploadIntentError>>({
        code: 'invalid',
      });

      const callbackQuery = normalizeQuery(
        __testMocks.textQuery.mock.calls[0]?.[0],
      );
      expect(callbackQuery).toContain('expires_at > clock_timestamp()');
      expect(callbackQuery).toContain('consumed_at IS NULL');
    },
  );

  it('keeps an expired reservation terminal after a cleanup lease is released', async () => {
    const expired = new Date(Date.now() - 60_000);
    __testMocks.clientQuery.mockResolvedValueOnce({
      rows: [
        {
          media_id: mediaId,
          user_id: userId,
          entry_id: entryId,
          original_path: pathname,
          thumbnail_path: thumbnailPathname,
          expires_at: expired,
          consumed_at: null,
          cleanup_started_at: null,
        },
      ],
      rowCount: 1,
    });
    const client = (await __testMocks.connect()) as Parameters<
      typeof lockAtlasMediaUploadIntentForRegistration
    >[0];

    await expect(
      lockAtlasMediaUploadIntentForRegistration(client, intent),
    ).resolves.toBe(false);
    expect(
      normalizeQuery(__testMocks.clientQuery.mock.calls[0]?.[0]),
    ).toContain('expires_at > clock_timestamp()');

    __testMocks.clientQuery.mockResolvedValueOnce({ rows: [], rowCount: 0 });
    await expect(consumeAtlasMediaUploadIntent(client, intent)).resolves.toBe(
      false,
    );
    expect(
      normalizeQuery(__testMocks.clientQuery.mock.calls[1]?.[0]),
    ).toContain('expires_at > clock_timestamp()');
  });

  it('reserves abandoned pairs against the account storage budget', async () => {
    __testMocks.clientQuery.mockImplementation(async (query: string) => {
      const text = normalizeQuery(query);

      if (text.includes('SELECT id FROM atlas_entries')) {
        return { rows: [{ id: entryId }], rowCount: 1 };
      }
      if (
        text.includes('FROM atlas_media_upload_intents') &&
        text.includes('WHERE media_id = $1')
      ) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('AS reserved_entry_count')) {
        return {
          rows: [
            {
              registered_entry_count: 0,
              reserved_entry_count: 0,
              registered_user_bytes: 489 * 1024 * 1024,
              // A prior incomplete upload remains billable until cleanup.
              reserved_user_bytes: 12 * 1024 * 1024,
            },
          ],
          rowCount: 1,
        };
      }

      return { rows: [], rowCount: 0 };
    });

    await expect(reserveAtlasMediaUploadVariant(intent)).rejects.toMatchObject<
      Partial<AtlasUploadIntentError>
    >({ code: 'limit', message: 'Your atlas photo storage is full.' });
    expect(
      __testMocks.clientQuery.mock.calls.some(([query]) =>
        normalizeQuery(query).includes(
          'INSERT INTO atlas_media_upload_intents',
        ),
      ),
    ).toBe(false);
  });

  it('keeps trigger-queued deletion bytes reserved until Blob cleanup completes', async () => {
    __testMocks.clientQuery.mockImplementation(async (query: string) => {
      const text = normalizeQuery(query);

      if (text.includes('SELECT id FROM atlas_entries')) {
        return { rows: [{ id: entryId }], rowCount: 1 };
      }
      if (
        text.includes('FROM atlas_media_upload_intents') &&
        text.includes('WHERE media_id = $1')
      ) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('AS reserved_entry_count')) {
        expect(text).toContain('FROM atlas_media_deletion_outbox');
        expect(text).toContain('completed_at IS NULL');
        return {
          rows: [
            {
              registered_entry_count: 0,
              reserved_entry_count: 0,
              registered_user_bytes: 500 * 1024 * 1024,
              reserved_user_bytes: 0,
              queued_deletion_user_bytes: 2 * 1024 * 1024,
            },
          ],
          rowCount: 1,
        };
      }

      return { rows: [], rowCount: 0 };
    });

    await expect(reserveAtlasMediaUploadVariant(intent)).rejects.toMatchObject<
      Partial<AtlasUploadIntentError>
    >({ code: 'limit', message: 'Your atlas photo storage is full.' });
    expect(
      __testMocks.clientQuery.mock.calls.some(([query]) =>
        normalizeQuery(query).includes(
          'INSERT INTO atlas_media_upload_intents',
        ),
      ),
    ).toBe(false);
  });

  it('keeps a failed orphan cleanup reserved and retryable', async () => {
    const cleanupStartedAt = new Date('2026-08-17T12:00:00.000Z');
    const cleanupAttempts = 3;
    __testMocks.textQuery.mockResolvedValue({
      rows: [
        {
          media_id: mediaId,
          original_path: pathname,
          thumbnail_path: thumbnailPathname,
          cleanup_started_at: cleanupStartedAt,
          cleanup_attempts: cleanupAttempts,
        },
      ],
      rowCount: 1,
    });
    __testMocks.taggedQuery.mockImplementation(
      async (strings: TemplateStringsArray) => {
        const query = taggedQueryText(strings);
        if (query.includes('SELECT id FROM atlas_media')) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 1 };
      },
    );
    jest
      .mocked(deleteAtlasMediaObjects)
      .mockRejectedValueOnce(new Error('Blob unavailable'));

    await expect(cleanupExpiredAtlasMediaUploadIntents()).rejects.toThrow(
      '1 expired atlas upload intent cleanups failed.',
    );

    expect(normalizeQuery(__testMocks.textQuery.mock.calls[0]?.[0])).toContain(
      "cleanup_started_at = date_trunc('milliseconds', clock_timestamp())",
    );
    expect(normalizeQuery(__testMocks.textQuery.mock.calls[0]?.[0])).toContain(
      "expires_at < NOW() - ($1 * INTERVAL '1 minute')",
    );
    expect(__testMocks.textQuery.mock.calls[0]?.[1]).toEqual([5, 15, 50]);
    expect(deleteAtlasMediaObjects).toHaveBeenCalledWith([
      pathname,
      thumbnailPathname,
    ]);
    const taggedQueries = __testMocks.taggedQuery.mock.calls.map(([strings]) =>
      taggedQueryText(strings as TemplateStringsArray),
    );
    expect(
      taggedQueries.some((query) =>
        query.includes('SET cleanup_started_at = NULL'),
      ),
    ).toBe(true);
    const releaseCall = __testMocks.taggedQuery.mock.calls.find(([strings]) =>
      taggedQueryText(strings as TemplateStringsArray).includes(
        'SET cleanup_started_at = NULL',
      ),
    );
    expect(releaseCall?.slice(1)).toEqual([mediaId, cleanupAttempts]);
    expect(
      taggedQueries.some((query) =>
        query.includes('DELETE FROM atlas_media_upload_intents WHERE media_id'),
      ),
    ).toBe(false);
  });

  it('releases an expired reservation only after its exact Blob pair is deleted', async () => {
    const cleanupStartedAt = new Date('2026-08-17T12:00:00.000Z');
    const cleanupAttempts = 7;
    __testMocks.textQuery.mockResolvedValue({
      rows: [
        {
          media_id: mediaId,
          original_path: pathname,
          thumbnail_path: thumbnailPathname,
          cleanup_started_at: cleanupStartedAt,
          cleanup_attempts: cleanupAttempts,
        },
      ],
      rowCount: 1,
    });
    __testMocks.taggedQuery.mockImplementation(
      async (strings: TemplateStringsArray) => {
        const query = taggedQueryText(strings);
        if (query.includes('SELECT id FROM atlas_media')) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 1 };
      },
    );
    jest.mocked(deleteAtlasMediaObjects).mockResolvedValue(undefined);

    await expect(cleanupExpiredAtlasMediaUploadIntents()).resolves.toEqual({
      cleaned: 1,
    });

    const cleanupDeleteIndex = __testMocks.taggedQuery.mock.calls.findIndex(
      ([strings]) =>
        taggedQueryText(strings as TemplateStringsArray).includes(
          'DELETE FROM atlas_media_upload_intents WHERE media_id',
        ),
    );
    expect(cleanupDeleteIndex).toBeGreaterThanOrEqual(0);
    const cleanupDeleteCall =
      __testMocks.taggedQuery.mock.calls[cleanupDeleteIndex];
    expect(
      taggedQueryText(cleanupDeleteCall?.[0] as TemplateStringsArray),
    ).toContain('cleanup_attempts = ?');
    expect(cleanupDeleteCall?.slice(1)).toEqual([mediaId, cleanupAttempts]);
    expect(
      jest.mocked(deleteAtlasMediaObjects).mock.invocationCallOrder[0],
    ).toBeLessThan(
      __testMocks.taggedQuery.mock.invocationCallOrder[cleanupDeleteIndex],
    );
  });

  it('marks an expired reservation consumed only for its exact live media pair', async () => {
    const cleanupAttempts = 2;
    __testMocks.textQuery.mockResolvedValue({
      rows: [
        {
          media_id: mediaId,
          user_id: userId,
          entry_id: entryId,
          original_path: pathname,
          thumbnail_path: thumbnailPathname,
          reserved_bytes: 12_582_912,
          cleanup_started_at: new Date('2026-08-17T12:00:00.000Z'),
          cleanup_attempts: cleanupAttempts,
        },
      ],
      rowCount: 1,
    });
    __testMocks.taggedQuery.mockImplementation(
      async (strings: TemplateStringsArray) => {
        const query = taggedQueryText(strings);
        if (query.includes('FROM atlas_media')) {
          return {
            rows: [
              {
                id: mediaId,
                user_id: userId,
                entry_id: entryId,
                storage_path: pathname,
                thumbnail_path: thumbnailPathname,
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 1 };
      },
    );

    await expect(cleanupExpiredAtlasMediaUploadIntents()).resolves.toEqual({
      cleaned: 1,
    });

    expect(deleteAtlasMediaObjects).not.toHaveBeenCalled();
    const consumeCall = __testMocks.taggedQuery.mock.calls.find(([strings]) =>
      taggedQueryText(strings as TemplateStringsArray).includes(
        'SET consumed_at = COALESCE(consumed_at, NOW())',
      ),
    );
    expect(consumeCall).toBeDefined();
    expect(consumeCall?.slice(1)).toEqual([
      mediaId,
      userId,
      entryId,
      pathname,
      thumbnailPathname,
      cleanupAttempts,
    ]);
  });

  it('retains quota and retries when any live row conflicts by ID or path', async () => {
    const cleanupAttempts = 5;
    __testMocks.textQuery.mockResolvedValue({
      rows: [
        {
          media_id: mediaId,
          user_id: userId,
          entry_id: entryId,
          original_path: pathname,
          thumbnail_path: thumbnailPathname,
          reserved_bytes: 12_582_912,
          cleanup_started_at: new Date('2026-08-17T12:00:00.000Z'),
          cleanup_attempts: cleanupAttempts,
        },
      ],
      rowCount: 1,
    });
    __testMocks.taggedQuery.mockImplementation(
      async (strings: TemplateStringsArray) => {
        const query = taggedQueryText(strings);
        if (query.includes('FROM atlas_media')) {
          return {
            rows: [
              {
                id: '10887075-50fb-4419-8ee3-1b32c2ce6575',
                user_id: userId,
                entry_id: entryId,
                storage_path: pathname,
                thumbnail_path: `atlas/memories/${entryId}/10887075-50fb-4419-8ee3-1b32c2ce6575.thumbnail.webp`,
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 1 };
      },
    );

    await expect(cleanupExpiredAtlasMediaUploadIntents()).rejects.toThrow(
      '1 expired atlas upload intent cleanups failed.',
    );

    expect(deleteAtlasMediaObjects).not.toHaveBeenCalled();
    const queries = __testMocks.taggedQuery.mock.calls.map(([strings]) =>
      taggedQueryText(strings as TemplateStringsArray),
    );
    expect(
      queries.some((query) => query.includes('SET cleanup_started_at = NULL')),
    ).toBe(true);
    expect(
      queries.some((query) =>
        query.includes('SET consumed_at = COALESCE(consumed_at, NOW())'),
      ),
    ).toBe(false);
    expect(
      queries.some((query) =>
        query.includes('DELETE FROM atlas_media_upload_intents WHERE media_id'),
      ),
    ).toBe(false);
  });

  it('queues an immediate discard transactionally and schedules only after commit', async () => {
    __testMocks.clientQuery.mockImplementation(async (query: string) => {
      const text = normalizeQuery(query);
      if (
        text.includes('FROM atlas_media_upload_intents') &&
        text.includes('FOR UPDATE')
      ) {
        return {
          rows: [
            {
              media_id: mediaId,
              user_id: userId,
              entry_id: entryId,
              original_path: pathname,
              thumbnail_path: thumbnailPathname,
              reserved_bytes: 12_582_912,
              cleanup_started_at: null,
              cleanup_attempts: 0,
            },
          ],
          rowCount: 1,
        };
      }
      if (
        text.includes('SELECT id, user_id, entry_id, storage_path') &&
        text.includes('FROM atlas_media')
      ) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 1 };
    });

    await expect(discardAtlasMediaUploadIntent(intent)).resolves.toBe(true);

    expect(deleteAtlasMediaObjects).not.toHaveBeenCalled();
    expect(enqueueAtlasMediaDeletionWithinTransaction).toHaveBeenCalledWith(
      expect.objectContaining({ query: __testMocks.clientQuery }),
      {
        mediaId,
        entryId,
        userId,
        originalPath: pathname,
        thumbnailPath: thumbnailPathname,
        reservedBytes: 12_582_912,
        reason: 'cancelled_upload',
      },
    );
    const statements = __testMocks.clientQuery.mock.calls.map(([query]) =>
      normalizeQuery(query),
    );
    expect(statements[0]).toBe('BEGIN');
    expect(statements).toContain('COMMIT');
    expect(statements).not.toContain('ROLLBACK');
    const deleteStatement = statements.find((query) =>
      query.startsWith('DELETE FROM atlas_media_upload_intents'),
    );
    expect(deleteStatement).toContain('consumed_at IS NULL');
    expect(deleteStatement).toContain('cleanup_started_at IS NULL');
    expect(
      __testMocks.clientQuery.mock.invocationCallOrder.find(
        (_, index) => statements[index] === 'COMMIT',
      ),
    ).toBeLessThan(
      jest.mocked(scheduleAtlasMediaDeletion).mock.invocationCallOrder[0]!,
    );
    expect(scheduleAtlasMediaDeletion).toHaveBeenCalledTimes(1);
  });

  it('rolls back an immediate discard when durable enqueue fails', async () => {
    __testMocks.clientQuery.mockImplementation(async (query: string) => {
      const text = normalizeQuery(query);
      if (
        text.includes('FROM atlas_media_upload_intents') &&
        text.includes('FOR UPDATE')
      ) {
        return {
          rows: [
            {
              media_id: mediaId,
              user_id: userId,
              entry_id: entryId,
              original_path: pathname,
              thumbnail_path: thumbnailPathname,
              reserved_bytes: 12_582_912,
              cleanup_started_at: null,
              cleanup_attempts: 0,
            },
          ],
          rowCount: 1,
        };
      }
      if (text.includes('SELECT id, user_id, entry_id, storage_path')) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 1 };
    });
    jest
      .mocked(enqueueAtlasMediaDeletionWithinTransaction)
      .mockRejectedValueOnce(new Error('queue unavailable'));

    await expect(discardAtlasMediaUploadIntent(intent)).rejects.toThrow(
      'queue unavailable',
    );

    const statements = __testMocks.clientQuery.mock.calls.map(([query]) =>
      normalizeQuery(query),
    );
    expect(statements.at(-1)).toBe('ROLLBACK');
    expect(
      statements.some((query) =>
        query.startsWith('DELETE FROM atlas_media_upload_intents'),
      ),
    ).toBe(false);
    expect(deleteAtlasMediaObjects).not.toHaveBeenCalled();
    expect(scheduleAtlasMediaDeletion).not.toHaveBeenCalled();
  });
});
