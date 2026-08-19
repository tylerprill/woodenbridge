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

jest.mock('@vercel/blob', () => ({ del: jest.fn() }));
jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('@/app/lib/auth/session', () => ({
  requireVerifiedSession: jest.fn(),
}));
jest.mock('@/app/lib/atlas/media-storage', () => ({
  getAtlasBlobToken: () => 'blob-test-token',
}));

import { del } from '@vercel/blob';
import {
  archiveAtlasEntryAction,
  updateAtlasEntryAction,
} from '@/app/lib/actions/atlas';
import { requireVerifiedSession } from '@/app/lib/auth/session';

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
const entryId = 'f7c0bf19-59fc-49df-9bd7-ae405a69e49c';

function normalizeQuery(query: unknown) {
  return String(query).replace(/\s+/g, ' ').trim();
}

function installActiveImport(status = 'uploading') {
  __testMocks.clientQuery.mockImplementation(async (query: string) => {
    const text = normalizeQuery(query);
    if (text.includes('FROM atlas_import_items')) {
      return { rows: [{ batch_id: batchId }], rowCount: 1 };
    }
    if (text.includes('FROM atlas_import_batches')) {
      return { rows: [{ status }], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  });
}

describe('Atlas entry active-import mutation guard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(requireVerifiedSession).mockResolvedValue({
      user: { id: userId },
    } as Awaited<ReturnType<typeof requireVerifiedSession>>);
  });

  it('locks and rejects updates to entries in an unfinished import', async () => {
    installActiveImport();

    await expect(
      updateAtlasEntryAction({
        id: entryId,
        version: 1,
        title: 'Clouds over the pass',
        description: '',
        placeLabel: 'Twin Lakes, Colorado',
        visitedOn: '2023-06-18',
        journeyState: 'visited',
      }),
    ).resolves.toMatchObject({ ok: false, error: 'conflict' });

    const queries = __testMocks.clientQuery.mock.calls.map(([query]) =>
      normalizeQuery(query),
    );
    expect(
      queries.findIndex((query) => query.includes('atlas_import_items')),
    ).toBeLessThan(
      queries.findIndex((query) => query.includes('atlas_import_batches')),
    );
    expect(
      queries.some((query) => query.startsWith('UPDATE atlas_entries')),
    ).toBe(false);
    expect(queries).toContain('ROLLBACK');
  });

  it('rejects archive before deleting media for an unfinished import', async () => {
    installActiveImport('ready');

    await expect(archiveAtlasEntryAction(entryId)).resolves.toMatchObject({
      ok: false,
      error: 'conflict',
    });
    expect(del).not.toHaveBeenCalled();
    expect(
      __testMocks.clientQuery.mock.calls.some(([query]) =>
        normalizeQuery(query).includes('SELECT storage_path, thumbnail_path'),
      ),
    ).toBe(false);
  });
});
