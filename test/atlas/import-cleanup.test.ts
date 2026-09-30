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
    __testMocks: { clientQuery, connect, release, taggedQuery, textQuery },
  };
});

jest.mock('@/app/lib/atlas/media-deletion-outbox', () => ({
  enqueueAtlasMediaDeletionWithinTransaction: jest.fn(async () => 'job-id'),
}));
jest.mock('@/app/lib/atlas/media-deletion-scheduler', () => ({
  scheduleAtlasMediaDeletion: jest.fn(),
}));

import { cleanupCancelledAtlasImportBatches } from '@/app/lib/atlas/import-cleanup';
import { enqueueAtlasMediaDeletionWithinTransaction } from '@/app/lib/atlas/media-deletion-outbox';
import { scheduleAtlasMediaDeletion } from '@/app/lib/atlas/media-deletion-scheduler';

const { __testMocks } = jest.requireMock('@vercel/postgres') as {
  __testMocks: {
    clientQuery: jest.Mock;
    connect: jest.Mock;
    release: jest.Mock;
    taggedQuery: jest.Mock;
    textQuery: jest.Mock;
  };
};

function taggedQueryText(strings: TemplateStringsArray) {
  return strings.join(' ? ').replace(/\s+/g, ' ').trim();
}

describe('Atlas import cleanup fencing', () => {
  beforeEach(() => {
    __testMocks.clientQuery.mockReset();
    __testMocks.connect.mockClear();
    __testMocks.release.mockReset();
    __testMocks.taggedQuery.mockReset();
    __testMocks.textQuery.mockReset();
    jest.mocked(enqueueAtlasMediaDeletionWithinTransaction).mockClear();
    jest.mocked(scheduleAtlasMediaDeletion).mockClear();
    __testMocks.taggedQuery.mockResolvedValue({ rows: [], rowCount: 0 });
    __testMocks.textQuery.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it('fences stale imports for 31 minutes and claims only elapsed fences', async () => {
    await expect(cleanupCancelledAtlasImportBatches()).resolves.toEqual({
      cleaned: 0,
    });

    const maintenanceQueries = __testMocks.taggedQuery.mock.calls.map(
      ([strings]) => taggedQueryText(strings as TemplateStringsArray),
    );
    expect(maintenanceQueries[0]).toContain("status IN ('uploading', 'ready')");
    expect(maintenanceQueries[0]).toContain(
      "cleanup_not_before = NOW() + ( ? * INTERVAL '1 minute')",
    );
    expect(__testMocks.taggedQuery.mock.calls[0]?.[1]).toBe(31);

    const claimQuery = String(__testMocks.textQuery.mock.calls[0]?.[0]).replace(
      /\s+/g,
      ' ',
    );
    expect(claimQuery).toContain('cleanup_not_before <= NOW()');
    expect(claimQuery).toContain(
      "cleanup_started_at = date_trunc('milliseconds', clock_timestamp())",
    );
    expect(enqueueAtlasMediaDeletionWithinTransaction).not.toHaveBeenCalled();
  });

  it('uses the monotonic cleanup attempt as the destructive-work lease token', async () => {
    const claim = {
      id: '66c441b0-e873-4dbd-b92b-191c7dd66cb7',
      user_id: '2e60b4c7-a402-44f9-a664-dd02349479e0',
      cleanup_started_at: new Date('2026-08-17T12:00:00.123Z'),
      cleanup_attempts: 4,
    };
    __testMocks.textQuery
      .mockResolvedValueOnce({ rows: [claim], rowCount: 1 })
      .mockResolvedValue({ rows: [], rowCount: 0 });
    __testMocks.clientQuery.mockImplementation(async (query: string) => {
      const normalized = query.replace(/\s+/g, ' ').trim();
      if (normalized.startsWith('SELECT id FROM atlas_import_batches')) {
        return { rows: [{ id: claim.id }], rowCount: 1 };
      }
      if (normalized.startsWith('SELECT entry_id FROM atlas_import_items')) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 1 };
    });

    await expect(cleanupCancelledAtlasImportBatches()).resolves.toEqual({
      cleaned: 1,
    });

    const lockCall = __testMocks.clientQuery.mock.calls.find(([query]) =>
      String(query).includes('FROM atlas_import_batches'),
    );
    expect(String(lockCall?.[0]).replace(/\s+/g, ' ')).toContain(
      'cleanup_attempts = $3',
    );
    expect(lockCall?.[1]).toEqual([
      claim.id,
      claim.user_id,
      claim.cleanup_attempts,
    ]);
    expect(__testMocks.release).toHaveBeenCalledTimes(1);
  });

  it('queues only unregistered import reservations before removing database rows', async () => {
    const claim = {
      id: '66c441b0-e873-4dbd-b92b-191c7dd66cb7',
      user_id: '2e60b4c7-a402-44f9-a664-dd02349479e0',
      cleanup_started_at: new Date('2026-08-17T12:00:00.123Z'),
      cleanup_attempts: 4,
    };
    const registeredEntryId = '179017f5-4af8-4c74-86ba-fb5a6bd41f3d';
    const orphanEntryId = '7ab90826-bc13-4acd-9736-4c47049c8397';
    const orphanMediaId = 'd8e32923-fadc-432e-9662-b39ab59242df';
    const originalPath = `atlas/memories/${orphanEntryId}/${orphanMediaId}.jpg`;
    const thumbnailPath = `atlas/memories/${orphanEntryId}/${orphanMediaId}.thumbnail.webp`;
    __testMocks.textQuery
      .mockResolvedValueOnce({ rows: [claim], rowCount: 1 })
      .mockResolvedValue({ rows: [], rowCount: 0 });
    __testMocks.clientQuery.mockImplementation(async (query: string) => {
      const normalized = query.replace(/\s+/g, ' ').trim();
      if (normalized.startsWith('SELECT id FROM atlas_import_batches')) {
        return { rows: [{ id: claim.id }], rowCount: 1 };
      }
      if (normalized.startsWith('SELECT entry_id FROM atlas_import_items')) {
        return {
          rows: [{ entry_id: registeredEntryId }, { entry_id: orphanEntryId }],
          rowCount: 2,
        };
      }
      if (normalized.includes('FROM atlas_media_upload_intents')) {
        return {
          rows: [
            {
              media_id: orphanMediaId,
              entry_id: orphanEntryId,
              original_path: originalPath,
              thumbnail_path: thumbnailPath,
              reserved_bytes: 12_582_912,
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 1 };
    });

    await expect(cleanupCancelledAtlasImportBatches()).resolves.toEqual({
      cleaned: 1,
    });

    const intentQuery = __testMocks.clientQuery.mock.calls.find(([query]) =>
      String(query).includes('FROM atlas_media_upload_intents'),
    );
    expect(String(intentQuery?.[0]).replace(/\s+/g, ' ')).toContain(
      'AS has_exact_registered_match',
    );
    expect(String(intentQuery?.[0]).replace(/\s+/g, ' ')).toContain(
      'AS has_registered_conflict',
    );
    expect(enqueueAtlasMediaDeletionWithinTransaction).toHaveBeenCalledTimes(1);
    expect(enqueueAtlasMediaDeletionWithinTransaction).toHaveBeenCalledWith(
      expect.anything(),
      {
        mediaId: orphanMediaId,
        entryId: orphanEntryId,
        userId: claim.user_id,
        originalPath,
        thumbnailPath,
        reservedBytes: 12_582_912,
        reason: 'cancelled_upload',
      },
    );
    expect(scheduleAtlasMediaDeletion).toHaveBeenCalledTimes(1);
    const statements = __testMocks.clientQuery.mock.calls.map(([query]) =>
      String(query).replace(/\s+/g, ' ').trim(),
    );
    expect(
      statements.findIndex((query) =>
        query.startsWith('DELETE FROM atlas_media_upload_intents'),
      ),
    ).toBeGreaterThan(
      statements.findIndex((query) =>
        query.includes('FROM atlas_media_upload_intents'),
      ),
    );
  });

  it('retains a conflicting intent and the whole batch for safe operator repair', async () => {
    const claim = {
      id: '66c441b0-e873-4dbd-b92b-191c7dd66cb7',
      user_id: '2e60b4c7-a402-44f9-a664-dd02349479e0',
      cleanup_started_at: new Date('2026-08-17T12:00:00.123Z'),
      cleanup_attempts: 5,
    };
    const entryId = '179017f5-4af8-4c74-86ba-fb5a6bd41f3d';
    const mediaId = 'd8e32923-fadc-432e-9662-b39ab59242df';
    __testMocks.textQuery.mockResolvedValueOnce({
      rows: [claim],
      rowCount: 1,
    });
    __testMocks.clientQuery.mockImplementation(async (query: string) => {
      const normalized = query.replace(/\s+/g, ' ').trim();
      if (normalized.startsWith('SELECT id FROM atlas_import_batches')) {
        return { rows: [{ id: claim.id }], rowCount: 1 };
      }
      if (normalized.startsWith('SELECT entry_id FROM atlas_import_items')) {
        return { rows: [{ entry_id: entryId }], rowCount: 1 };
      }
      if (normalized.includes('FROM atlas_media_upload_intents AS intent')) {
        return {
          rows: [
            {
              media_id: mediaId,
              entry_id: entryId,
              original_path: `atlas/memories/${entryId}/${mediaId}.jpg`,
              thumbnail_path: `atlas/memories/${entryId}/${mediaId}.thumbnail.webp`,
              reserved_bytes: 12_582_912,
              has_exact_registered_match: false,
              has_registered_conflict: true,
            },
          ],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 1 };
    });

    await expect(cleanupCancelledAtlasImportBatches()).rejects.toThrow(
      'conflicting live media identity',
    );

    expect(enqueueAtlasMediaDeletionWithinTransaction).not.toHaveBeenCalled();
    expect(scheduleAtlasMediaDeletion).not.toHaveBeenCalled();
    const statements = __testMocks.clientQuery.mock.calls.map(([query]) =>
      String(query).replace(/\s+/g, ' ').trim(),
    );
    expect(statements).toContain('ROLLBACK');
    expect(
      statements.some((query) =>
        query.startsWith('DELETE FROM atlas_media_upload_intents'),
      ),
    ).toBe(false);
    expect(
      __testMocks.taggedQuery.mock.calls.some(([strings]) =>
        taggedQueryText(strings as TemplateStringsArray).includes(
          'SET cleanup_started_at = NULL',
        ),
      ),
    ).toBe(true);
  });
});
