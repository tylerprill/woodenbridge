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

jest.mock('@/app/lib/atlas/media-storage', () => ({
  deleteAtlasMediaObjects: jest.fn(),
}));

import { deleteAtlasMediaObjects } from '@/app/lib/atlas/media-storage';
import { cleanupCancelledAtlasImportBatches } from '@/app/lib/atlas/import-cleanup';

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
    jest.mocked(deleteAtlasMediaObjects).mockReset();
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
    expect(jest.mocked(deleteAtlasMediaObjects)).not.toHaveBeenCalled();
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
});
