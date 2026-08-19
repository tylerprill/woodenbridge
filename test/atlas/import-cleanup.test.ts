jest.mock('@vercel/postgres', () => {
  const taggedQuery = jest.fn();
  const textQuery = jest.fn();
  Object.assign(taggedQuery, { query: textQuery });
  return {
    db: { connect: jest.fn() },
    sql: taggedQuery,
    __testMocks: { taggedQuery, textQuery },
  };
});

jest.mock('@vercel/blob', () => ({ del: jest.fn() }));
jest.mock('@/app/lib/atlas/media-storage', () => ({
  getAtlasBlobToken: () => 'blob-test-token',
}));

import { del } from '@vercel/blob';
import { cleanupCancelledAtlasImportBatches } from '@/app/lib/atlas/import-cleanup';

const { __testMocks } = jest.requireMock('@vercel/postgres') as {
  __testMocks: { taggedQuery: jest.Mock; textQuery: jest.Mock };
};

function taggedQueryText(strings: TemplateStringsArray) {
  return strings.join(' ? ').replace(/\s+/g, ' ').trim();
}

describe('Atlas import cleanup fencing', () => {
  beforeEach(() => {
    __testMocks.taggedQuery.mockReset();
    __testMocks.textQuery.mockReset();
    jest.mocked(del).mockReset();
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
    expect(jest.mocked(del)).not.toHaveBeenCalled();
  });
});
