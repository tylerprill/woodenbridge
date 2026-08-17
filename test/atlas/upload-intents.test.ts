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

jest.mock('@vercel/blob', () => ({ del: jest.fn() }));
jest.mock('@/app/lib/atlas/media-storage', () => ({
  getAtlasBlobToken: () => 'blob-test-token',
}));

import { del } from '@vercel/blob';

import {
  AtlasUploadIntentError,
  cleanupExpiredAtlasMediaUploadIntents,
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
    jest.mocked(del).mockReset();
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
    __testMocks.textQuery.mockResolvedValue({
      rows: [
        {
          media_id: mediaId,
          original_path: pathname,
          thumbnail_path: thumbnailPathname,
          cleanup_started_at: cleanupStartedAt,
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
    jest.mocked(del).mockRejectedValueOnce(new Error('Blob unavailable'));

    await expect(cleanupExpiredAtlasMediaUploadIntents()).rejects.toThrow(
      '1 expired atlas upload intent cleanups failed.',
    );

    expect(del).toHaveBeenCalledWith([pathname, thumbnailPathname], {
      token: 'blob-test-token',
    });
    const taggedQueries = __testMocks.taggedQuery.mock.calls.map(([strings]) =>
      taggedQueryText(strings as TemplateStringsArray),
    );
    expect(
      taggedQueries.some((query) =>
        query.includes('SET cleanup_started_at = NULL'),
      ),
    ).toBe(true);
    expect(
      taggedQueries.some((query) =>
        query.includes('DELETE FROM atlas_media_upload_intents WHERE media_id'),
      ),
    ).toBe(false);
  });

  it('releases an expired reservation only after its exact Blob pair is deleted', async () => {
    const cleanupStartedAt = new Date('2026-08-17T12:00:00.000Z');
    __testMocks.textQuery.mockResolvedValue({
      rows: [
        {
          media_id: mediaId,
          original_path: pathname,
          thumbnail_path: thumbnailPathname,
          cleanup_started_at: cleanupStartedAt,
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
    jest.mocked(del).mockResolvedValue(undefined);

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
    expect(jest.mocked(del).mock.invocationCallOrder[0]).toBeLessThan(
      __testMocks.taggedQuery.mock.invocationCallOrder[cleanupDeleteIndex],
    );
  });
});
