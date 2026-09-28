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
  deleteAtlasMediaObjects: jest.fn(),
}));

import { deleteAtlasMediaObjects } from '@/app/lib/atlas/media-storage';
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
        occurredTime: null,
        occurredUtcOffsetMinutes: null,
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
    expect(deleteAtlasMediaObjects).not.toHaveBeenCalled();
    expect(
      __testMocks.clientQuery.mock.calls.some(([query]) =>
        normalizeQuery(query).includes('SELECT storage_path, thumbnail_path'),
      ),
    ).toBe(false);
  });

  it('persists local occurrence time and its photo offset in the owner-scoped update', async () => {
    __testMocks.clientQuery.mockImplementation(
      async (query: string, values?: unknown[]) => {
        const text = normalizeQuery(query);
        if (text.includes('FROM atlas_import_items')) {
          return { rows: [], rowCount: 0 };
        }
        if (text.includes('SELECT version FROM atlas_entries')) {
          return { rows: [{ version: 1 }], rowCount: 1 };
        }
        if (text.startsWith('UPDATE atlas_entries')) {
          return {
            rows: [
              {
                id: entryId,
                title: String(values?.[0]),
                description: String(values?.[1]),
                place_label: String(values?.[2]),
                place_name: null,
                place_locality: null,
                place_region: null,
                place_country: null,
                place_country_code: null,
                place_geocoder: null,
                place_geocoded_at: null,
                visited_on: values?.[3],
                occurred_time: `${values?.[4]}:00`,
                occurred_utc_offset_minutes: values?.[5],
                record_state: 'saved',
                journey_state: values?.[6],
                latitude: 39.082,
                longitude: -106.382,
                version: 2,
                created_at: '2026-04-20T00:00:00.000Z',
                updated_at: '2026-04-20T00:00:00.000Z',
              },
            ],
            rowCount: 1,
          };
        }
        return { rows: [], rowCount: 0 };
      },
    );

    const result = await updateAtlasEntryAction({
      id: entryId,
      version: 1,
      title: 'Clouds over the pass',
      description: '',
      placeLabel: 'Twin Lakes, Colorado',
      visitedOn: '2023-06-18',
      occurredTime: '06:42',
      occurredUtcOffsetMinutes: -360,
      journeyState: 'visited',
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        occurredTime: '06:42',
        occurredUtcOffsetMinutes: -360,
      },
    });
    const updateCall = __testMocks.clientQuery.mock.calls.find(([query]) =>
      normalizeQuery(query).startsWith('UPDATE atlas_entries'),
    );
    expect(normalizeQuery(updateCall?.[0])).toContain(
      'occurred_time = $5::time',
    );
    expect(updateCall?.[1]).toEqual([
      'Clouds over the pass',
      '',
      'Twin Lakes, Colorado',
      '2023-06-18',
      '06:42',
      -360,
      'visited',
      entryId,
      userId,
      1,
    ]);
  });
});
