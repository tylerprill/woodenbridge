jest.mock('@vercel/postgres', () => {
  const clientQuery = jest.fn();
  const release = jest.fn();
  const connect = jest.fn(async () => ({ query: clientQuery, release }));
  const taggedQuery = jest.fn();
  Object.assign(taggedQuery, { query: jest.fn() });
  return {
    db: { connect },
    sql: taggedQuery,
    __testMocks: { clientQuery, connect, release, taggedQuery },
  };
});

jest.mock('next/cache', () => ({ revalidatePath: jest.fn() }));
jest.mock('@/app/lib/auth/session', () => ({
  requireVerifiedSession: jest.fn(),
}));
jest.mock('@/app/lib/atlas/media-deletion-scheduler', () => ({
  scheduleAtlasMediaDeletion: jest.fn(),
}));

import { deleteAtlasMediaAction } from '@/app/lib/actions/atlas-media';
import { requireVerifiedSession } from '@/app/lib/auth/session';
import { scheduleAtlasMediaDeletion } from '@/app/lib/atlas/media-deletion-scheduler';

const { __testMocks } = jest.requireMock('@vercel/postgres') as {
  __testMocks: {
    clientQuery: jest.Mock;
    connect: jest.Mock;
    release: jest.Mock;
    taggedQuery: jest.Mock;
  };
};

const userId = '2e60b4c7-a402-44f9-a664-dd02349479e0';
const entryId = '7ab90826-bc13-4acd-9736-4c47049c8397';
const mediaId = 'd8e32923-fadc-432e-9662-b39ab59242df';

function normalizeQuery(query: unknown) {
  return String(query).replace(/\s+/g, ' ').trim();
}

describe('registered Atlas media deletion', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(requireVerifiedSession).mockResolvedValue({
      user: { id: userId },
    } as Awaited<ReturnType<typeof requireVerifiedSession>>);
  });

  it('commits the trigger-backed association delete before scheduling Blob cleanup', async () => {
    __testMocks.clientQuery.mockImplementation(async (query: string) => {
      const statement = normalizeQuery(query);
      if (statement.startsWith('SELECT entry_id FROM atlas_media')) {
        return { rows: [{ entry_id: entryId }], rowCount: 1 };
      }
      if (statement.startsWith('SELECT id FROM atlas_entries')) {
        return { rows: [{ id: entryId }], rowCount: 1 };
      }
      if (statement.startsWith('DELETE FROM atlas_media')) {
        return { rows: [{ id: mediaId, entry_id: entryId }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    });

    await expect(deleteAtlasMediaAction(mediaId)).resolves.toEqual({
      ok: true,
      data: { id: mediaId, entryId },
    });

    const statements = __testMocks.clientQuery.mock.calls.map(([query]) =>
      normalizeQuery(query),
    );
    const deleteIndex = statements.findIndex((query) =>
      query.startsWith('DELETE FROM atlas_media'),
    );
    const commitIndex = statements.indexOf('COMMIT');
    expect(deleteIndex).toBeGreaterThan(statements.indexOf('BEGIN'));
    expect(commitIndex).toBeGreaterThan(deleteIndex);
    expect(scheduleAtlasMediaDeletion).toHaveBeenCalledTimes(1);
    expect(
      __testMocks.clientQuery.mock.invocationCallOrder[commitIndex],
    ).toBeLessThan(
      jest.mocked(scheduleAtlasMediaDeletion).mock.invocationCallOrder[0],
    );
    expect(__testMocks.release).toHaveBeenCalledTimes(1);
  });

  it('rolls back without scheduling cleanup when the database delete fails', async () => {
    __testMocks.clientQuery.mockImplementation(async (query: string) => {
      const statement = normalizeQuery(query);
      if (statement.startsWith('SELECT entry_id FROM atlas_media')) {
        return { rows: [{ entry_id: entryId }], rowCount: 1 };
      }
      if (statement.startsWith('SELECT id FROM atlas_entries')) {
        return { rows: [{ id: entryId }], rowCount: 1 };
      }
      if (statement.startsWith('DELETE FROM atlas_media')) {
        throw new Error('trigger enqueue failed');
      }
      return { rows: [], rowCount: 0 };
    });

    await expect(deleteAtlasMediaAction(mediaId)).resolves.toMatchObject({
      ok: false,
      error: 'failed',
    });

    expect(
      __testMocks.clientQuery.mock.calls.map(([query]) =>
        normalizeQuery(query),
      ),
    ).toContain('ROLLBACK');
    expect(scheduleAtlasMediaDeletion).not.toHaveBeenCalled();
    expect(__testMocks.release).toHaveBeenCalledTimes(1);
  });
});
