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

import { deleteAtlasMediaObjects } from '@/app/lib/atlas/media-storage';

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
  });

  it('refuses to issue a Blob token after an import leaves uploading state', async () => {
    __testMocks.clientQuery.mockImplementation(async (query: string) => {
      const text = normalizeQuery(query);
      if (text.includes('SELECT batch_id FROM atlas_import_items')) {
        return { rows: [{ batch_id: '3fe3cf16-c676-42cf-b3e6-87158c836fd9' }] };
      }
      if (text.includes('SELECT status FROM atlas_import_batches')) {
        return { rows: [{ status: 'cancel_pending' }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

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

  it('locks an active import batch before its item and entry', async () => {
    __testMocks.clientQuery.mockImplementation(async (query: string) => {
      const text = normalizeQuery(query);
      if (text.includes('SELECT batch_id FROM atlas_import_items')) {
        return { rows: [{ batch_id: '3fe3cf16-c676-42cf-b3e6-87158c836fd9' }] };
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

  it('uses a precision-safe monotonic lease when discarding an orphan reservation', async () => {
    const cleanupStartedAt = new Date('2026-08-17T12:00:00.123Z');
    const cleanupAttempts = 1;
    __testMocks.taggedQuery.mockImplementation(
      async (strings: TemplateStringsArray) => {
        const query = taggedQueryText(strings);
        if (query.startsWith('UPDATE atlas_media_upload_intents')) {
          return {
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
          };
        }
        if (query.includes('SELECT id FROM atlas_media')) {
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 1 };
      },
    );
    jest.mocked(deleteAtlasMediaObjects).mockResolvedValue(undefined);

    await expect(discardAtlasMediaUploadIntent(intent)).resolves.toBe(true);

    const claimQuery = taggedQueryText(
      __testMocks.taggedQuery.mock.calls[0]?.[0] as TemplateStringsArray,
    );
    expect(claimQuery).toContain(
      "cleanup_started_at = date_trunc('milliseconds', clock_timestamp())",
    );
    expect(deleteAtlasMediaObjects).toHaveBeenCalledWith([
      pathname,
      thumbnailPathname,
    ]);
    expect(
      __testMocks.taggedQuery.mock.calls.some(([strings]) =>
        taggedQueryText(strings as TemplateStringsArray).includes(
          'DELETE FROM atlas_media_upload_intents WHERE media_id',
        ),
      ),
    ).toBe(true);
    const deleteCall = __testMocks.taggedQuery.mock.calls.find(([strings]) =>
      taggedQueryText(strings as TemplateStringsArray).includes(
        'DELETE FROM atlas_media_upload_intents WHERE media_id',
      ),
    );
    expect(deleteCall?.slice(1)).toEqual([mediaId, cleanupAttempts]);
  });
});
