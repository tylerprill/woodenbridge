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
jest.mock('@/app/lib/atlas/media-deletion-scheduler', () => ({
  scheduleAtlasMediaDeletion: jest.fn(),
}));

import {
  archiveAtlasEntryAction,
  updateAtlasEntryAction,
} from '@/app/lib/actions/atlas';
import { scheduleAtlasMediaDeletion } from '@/app/lib/atlas/media-deletion-scheduler';
import { requireVerifiedSession } from '@/app/lib/auth/session';
import { revalidatePath } from 'next/cache';

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
const journeyId = '78daf767-13e6-4f2f-a7bf-8a087824c005';
const shareId = '742dbb48-7be8-4d8f-b8b4-1f8d82725025';
const segmentId = 'e8ef6529-4961-4847-8272-e0da4aebf38b';
const newSegmentId = 'c47412f0-b990-421d-9321-693f153bd2d1';

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
    expect(scheduleAtlasMediaDeletion).not.toHaveBeenCalled();
    expect(
      __testMocks.clientQuery.mock.calls.some(([query]) =>
        normalizeQuery(query).includes('SELECT storage_path, thumbnail_path'),
      ),
    ).toBe(false);
  });

  it('commits the trigger-backed media delete before scheduling Blob cleanup', async () => {
    __testMocks.clientQuery.mockImplementation(async (query: string) => {
      const text = normalizeQuery(query);
      if (text.includes('FROM atlas_import_items')) {
        return { rows: [], rowCount: 0 };
      }
      if (text.startsWith('SELECT id FROM atlas_entries')) {
        return { rows: [{ id: entryId }], rowCount: 1 };
      }
      if (text.startsWith('DELETE FROM atlas_media')) {
        return { rows: [], rowCount: 2 };
      }
      if (text.startsWith('UPDATE atlas_entries')) {
        return { rows: [{ id: entryId }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    await expect(archiveAtlasEntryAction(entryId)).resolves.toEqual({
      ok: true,
      data: { id: entryId },
    });

    const statements = __testMocks.clientQuery.mock.calls.map(([query]) =>
      normalizeQuery(query),
    );
    const mediaDeleteIndex = statements.findIndex((query) =>
      query.startsWith('DELETE FROM atlas_media'),
    );
    const archiveIndex = statements.findIndex((query) =>
      query.startsWith('UPDATE atlas_entries'),
    );
    const commitIndex = statements.indexOf('COMMIT');
    expect(mediaDeleteIndex).toBeGreaterThan(statements.indexOf('BEGIN'));
    expect(archiveIndex).toBeGreaterThan(mediaDeleteIndex);
    expect(commitIndex).toBeGreaterThan(archiveIndex);
    expect(scheduleAtlasMediaDeletion).toHaveBeenCalledTimes(1);
    expect(
      __testMocks.clientQuery.mock.invocationCallOrder[commitIndex],
    ).toBeLessThan(
      jest.mocked(scheduleAtlasMediaDeletion).mock.invocationCallOrder[0],
    );
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

  it('saves a Memory and appends it to the locked owner Journey atomically', async () => {
    __testMocks.clientQuery.mockImplementation(
      async (query: string, values?: unknown[]) => {
        const text = normalizeQuery(query);
        if (text.includes('FROM atlas_import_items')) {
          return { rows: [], rowCount: 0 };
        }
        if (text.includes('SELECT version FROM atlas_entries')) {
          return { rows: [{ version: 1 }], rowCount: 1 };
        }
        if (
          text.includes('FROM atlas_chapters') &&
          text.includes('FOR UPDATE')
        ) {
          return { rows: [{ id: journeyId, shareId }], rowCount: 1 };
        }
        if (text.includes('COUNT(*)::int AS "memoryCount"')) {
          return {
            rows: [{ memoryCount: 2, alreadyIncluded: false }],
            rowCount: 1,
          };
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
                occurred_time: null,
                occurred_utc_offset_minutes: null,
                record_state: 'saved',
                journey_state: values?.[6],
                latitude: 44.9,
                longitude: -86,
                version: 2,
                created_at: '2026-09-28T00:00:00.000Z',
                updated_at: '2026-09-28T00:00:00.000Z',
              },
            ],
            rowCount: 1,
          };
        }
        if (text.startsWith('INSERT INTO atlas_chapter_entries')) {
          return { rows: [{ entryId }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    );

    await expect(
      updateAtlasEntryAction({
        id: entryId,
        version: 1,
        title: 'Lunch beside the lake',
        description: '',
        placeLabel: 'Lake Michigan',
        visitedOn: '2026-09-28',
        occurredTime: null,
        occurredUtcOffsetMinutes: null,
        journeyState: 'visited',
        appendToJourneyId: journeyId,
      }),
    ).resolves.toMatchObject({
      ok: true,
      data: { id: entryId, recordState: 'saved', version: 2 },
    });

    const queries = __testMocks.clientQuery.mock.calls.map(([query]) =>
      normalizeQuery(query),
    );
    expect(
      queries.findIndex((query) => query.startsWith('UPDATE atlas_entries')),
    ).toBeLessThan(
      queries.findIndex((query) =>
        query.startsWith('INSERT INTO atlas_chapter_entries'),
      ),
    );
    expect(
      queries.some((query) => query.startsWith('UPDATE atlas_chapters')),
    ).toBe(true);
    expect(queries).toContain('COMMIT');
    expect(revalidatePath).toHaveBeenCalledWith(
      `/dashboard/chapters/${journeyId}`,
    );
    expect(revalidatePath).toHaveBeenCalledWith(`/shared/chapters/${shareId}`);
  });

  it('creates a new Segment only inside the successful Memory transaction', async () => {
    __testMocks.clientQuery.mockImplementation(
      async (query: string, values?: unknown[]) => {
        const text = normalizeQuery(query);
        if (text.includes('FROM atlas_import_items')) {
          return { rows: [], rowCount: 0 };
        }
        if (text.includes('SELECT version FROM atlas_entries')) {
          return { rows: [{ version: 1 }], rowCount: 1 };
        }
        if (
          text.includes('FROM atlas_chapters') &&
          text.includes('FOR UPDATE')
        ) {
          return { rows: [{ id: journeyId, shareId }], rowCount: 1 };
        }
        if (text.includes('COUNT(*)::int AS "memoryCount"')) {
          return {
            rows: [
              {
                memoryCount: 3,
                alreadyIncluded: false,
                segmentCount: 2,
              },
            ],
            rowCount: 1,
          };
        }
        if (text.startsWith('UPDATE atlas_entries')) {
          return {
            rows: [
              {
                id: entryId,
                title: String(values?.[0]),
                description: '',
                place_label: 'Lake Michigan',
                place_name: null,
                place_locality: null,
                place_region: null,
                place_country: null,
                place_country_code: null,
                place_geocoder: null,
                place_geocoded_at: null,
                visited_on: '2026-09-29',
                occurred_time: null,
                occurred_utc_offset_minutes: null,
                record_state: 'saved',
                journey_state: 'visited',
                latitude: 44.9,
                longitude: -86,
                version: 2,
                created_at: '2026-09-28T00:00:00.000Z',
                updated_at: '2026-09-28T00:00:00.000Z',
              },
            ],
            rowCount: 1,
          };
        }
        if (text.startsWith('INSERT INTO atlas_chapter_segments')) {
          expect(values).toEqual([journeyId, userId, 'Day 2 · The coast']);
          return { rows: [{ id: newSegmentId }], rowCount: 1 };
        }
        if (text.includes('AS "insertAfter"')) {
          return {
            rows: [{ insertAfter: -1, maxPosition: 2 }],
            rowCount: 1,
          };
        }
        if (text.startsWith('INSERT INTO atlas_chapter_entries')) {
          expect(values).toEqual([journeyId, entryId, userId, 3, newSegmentId]);
          return { rows: [{ entryId }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      },
    );

    await expect(
      updateAtlasEntryAction({
        id: entryId,
        version: 1,
        title: 'Morning on the coast',
        description: '',
        placeLabel: 'Lake Michigan',
        visitedOn: '2026-09-29',
        occurredTime: null,
        occurredUtcOffsetMinutes: null,
        journeyState: 'visited',
        appendToJourneyId: journeyId,
        appendToNewJourneySegmentTitle: 'Day 2 · The coast',
      }),
    ).resolves.toMatchObject({ ok: true });

    const queries = __testMocks.clientQuery.mock.calls.map(([query]) =>
      normalizeQuery(query),
    );
    expect(
      queries.findIndex((query) =>
        query.startsWith('INSERT INTO atlas_chapter_segments'),
      ),
    ).toBeLessThan(
      queries.findIndex((query) =>
        query.startsWith('INSERT INTO atlas_chapter_entries'),
      ),
    );
    expect(queries).toContain('COMMIT');
  });

  it('inserts into an older Segment without scrambling later stop positions', async () => {
    __testMocks.clientQuery.mockImplementation(
      async (query: string, values?: unknown[]) => {
        const text = normalizeQuery(query);
        if (text.includes('FROM atlas_import_items')) {
          return { rows: [], rowCount: 0 };
        }
        if (text.includes('SELECT version FROM atlas_entries')) {
          return { rows: [{ version: 1 }], rowCount: 1 };
        }
        if (
          text.includes('FROM atlas_chapters') &&
          text.includes('FOR UPDATE')
        ) {
          return { rows: [{ id: journeyId, shareId }], rowCount: 1 };
        }
        if (text.startsWith('SELECT id FROM atlas_chapter_segments')) {
          return { rows: [{ id: segmentId }], rowCount: 1 };
        }
        if (text.includes('COUNT(*)::int AS "memoryCount"')) {
          return {
            rows: [
              {
                memoryCount: 5,
                alreadyIncluded: false,
                segmentCount: 3,
              },
            ],
            rowCount: 1,
          };
        }
        if (text.startsWith('UPDATE atlas_entries')) {
          return {
            rows: [
              {
                id: entryId,
                title: String(values?.[0]),
                description: '',
                place_label: 'Lake Michigan',
                place_name: null,
                place_locality: null,
                place_region: null,
                place_country: null,
                place_country_code: null,
                place_geocoder: null,
                place_geocoded_at: null,
                visited_on: '2026-09-28',
                occurred_time: null,
                occurred_utc_offset_minutes: null,
                record_state: 'saved',
                journey_state: 'visited',
                latitude: 44.9,
                longitude: -86,
                version: 2,
                created_at: '2026-09-28T00:00:00.000Z',
                updated_at: '2026-09-28T00:00:00.000Z',
              },
            ],
            rowCount: 1,
          };
        }
        if (text.includes('AS "insertAfter"')) {
          return {
            rows: [{ insertAfter: 1, maxPosition: 4 }],
            rowCount: 1,
          };
        }
        if (text.startsWith('INSERT INTO atlas_chapter_entries')) {
          expect(values).toEqual([journeyId, entryId, userId, 2, segmentId]);
          return { rows: [{ entryId }], rowCount: 1 };
        }
        return { rows: [], rowCount: 1 };
      },
    );

    await expect(
      updateAtlasEntryAction({
        id: entryId,
        version: 1,
        title: 'Another stop on day one',
        description: '',
        placeLabel: 'Lake Michigan',
        visitedOn: '2026-09-28',
        occurredTime: null,
        occurredUtcOffsetMinutes: null,
        journeyState: 'visited',
        appendToJourneyId: journeyId,
        appendToJourneySegmentId: segmentId,
      }),
    ).resolves.toMatchObject({ ok: true });

    const shiftCalls = __testMocks.clientQuery.mock.calls.filter(([query]) =>
      normalizeQuery(query).startsWith('UPDATE atlas_chapter_entries'),
    );
    expect(shiftCalls).toHaveLength(2);
    expect(shiftCalls[0]?.[1]).toEqual([journeyId, userId, 1, 51]);
    expect(shiftCalls[1]?.[1]).toEqual([journeyId, userId, 1, 51]);
  });

  it.each([
    {
      name: 'is no longer available',
      journeyRows: [],
      membershipRows: [],
      error: 'not-found',
    },
    {
      name: 'already contains the maximum number of Memories',
      journeyRows: [{ id: journeyId, shareId }],
      membershipRows: [{ memoryCount: 50, alreadyIncluded: false }],
      error: 'invalid',
    },
  ])('rolls back when the Journey $name', async (scenario) => {
    __testMocks.clientQuery.mockImplementation(async (query: string) => {
      const text = normalizeQuery(query);
      if (text.includes('FROM atlas_import_items')) {
        return { rows: [], rowCount: 0 };
      }
      if (text.includes('SELECT version FROM atlas_entries')) {
        return { rows: [{ version: 1 }], rowCount: 1 };
      }
      if (text.includes('FROM atlas_chapters') && text.includes('FOR UPDATE')) {
        return {
          rows: scenario.journeyRows,
          rowCount: scenario.journeyRows.length,
        };
      }
      if (text.includes('COUNT(*)::int AS "memoryCount"')) {
        return { rows: scenario.membershipRows, rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    await expect(
      updateAtlasEntryAction({
        id: entryId,
        version: 1,
        title: 'Lunch beside the lake',
        description: '',
        placeLabel: 'Lake Michigan',
        visitedOn: '2026-09-28',
        occurredTime: null,
        occurredUtcOffsetMinutes: null,
        journeyState: 'visited',
        appendToJourneyId: journeyId,
      }),
    ).resolves.toMatchObject({ ok: false, error: scenario.error });

    const queries = __testMocks.clientQuery.mock.calls.map(([query]) =>
      normalizeQuery(query),
    );
    expect(queries).toContain('ROLLBACK');
    expect(
      queries.some((query) => query.startsWith('UPDATE atlas_entries')),
    ).toBe(false);
    expect(
      queries.some((query) =>
        query.startsWith('INSERT INTO atlas_chapter_entries'),
      ),
    ).toBe(false);
  });
});
