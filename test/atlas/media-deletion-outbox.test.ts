import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

jest.mock('@/app/lib/db', () => {
  const clientQuery = jest.fn();
  const release = jest.fn();
  const connect = jest.fn(async () => ({ query: clientQuery, release }));
  const databaseQuery = jest.fn();
  return {
    db: { connect, query: databaseQuery },
    __testMocks: { clientQuery, connect, databaseQuery, release },
  };
});

jest.mock('@/app/lib/atlas/media-storage', () => ({
  deleteAtlasMediaObjects: jest.fn(),
}));

import {
  ATLAS_MEDIA_DELETION_FENCE_SECONDS,
  atlasMediaDeletionRetryDelaySeconds,
  deleteRetainedAtlasMediaDeletions,
  enqueueAtlasMediaDeletionWithinTransaction,
  getAtlasMediaDeletionOutboxHealth,
  processAtlasMediaDeletionOutbox,
} from '@/app/lib/atlas/media-deletion-outbox';
import { deleteAtlasMediaObjects } from '@/app/lib/atlas/media-storage';

const { __testMocks } = jest.requireMock('@/app/lib/db') as {
  __testMocks: {
    clientQuery: jest.Mock;
    connect: jest.Mock;
    databaseQuery: jest.Mock;
    release: jest.Mock;
  };
};

const mediaId = 'd8e32923-fadc-432e-9662-b39ab59242df';
const entryId = '7ab90826-bc13-4acd-9736-4c47049c8397';
const userId = '2e60b4c7-a402-44f9-a664-dd02349479e0';
const originalPath = `atlas/memories/${entryId}/${mediaId}.jpg`;
const thumbnailPath = `atlas/memories/${entryId}/${mediaId}.thumbnail.webp`;

function claimedDeletion(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bf364108-f72e-4dd0-82e7-1cfced11a0ca',
    media_id: mediaId,
    entry_id: entryId,
    original_path: originalPath,
    thumbnail_path: thumbnailPath,
    reserved_bytes: '1280',
    attempt_count: 1,
    ...overrides,
  };
}

function installClaim(rows: ReturnType<typeof claimedDeletion>[]) {
  __testMocks.clientQuery.mockImplementation(async (query: string) => {
    const normalized = String(query).replace(/\s+/g, ' ').trim();
    if (normalized.startsWith('WITH claimable AS')) {
      return { rows, rowCount: rows.length };
    }
    return { rows: [], rowCount: 0 };
  });
}

describe('Atlas media deletion outbox', () => {
  let warnSpy: jest.SpiedFunction<typeof console.warn>;

  beforeEach(() => {
    jest.clearAllMocks();
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    installClaim([]);
    __testMocks.databaseQuery.mockResolvedValue({
      rows: [{ id: 'job-id' }],
      rowCount: 1,
    });
    jest.mocked(deleteAtlasMediaObjects).mockResolvedValue(undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('transactionally enqueues an unregistered immutable object pair', async () => {
    const query = jest.fn().mockResolvedValue({
      rows: [{ id: 'job-id' }],
      rowCount: 1,
    });
    const client = { query } as never;

    await expect(
      enqueueAtlasMediaDeletionWithinTransaction(client, {
        mediaId,
        entryId,
        userId,
        originalPath,
        thumbnailPath,
        reservedBytes: 12_582_912,
        reason: 'cancelled_upload',
      }),
    ).resolves.toBe('job-id');

    const [statement, values] = query.mock.calls[0];
    expect(String(statement).replace(/\s+/g, ' ')).toContain(
      'INSERT INTO atlas_media_deletion_outbox',
    );
    expect(String(statement).replace(/\s+/g, ' ')).toContain(
      'ON CONFLICT (media_id) DO UPDATE',
    );
    expect(values).toEqual([
      mediaId,
      entryId,
      userId,
      originalPath,
      thumbnailPath,
      12_582_912,
      'cancelled_upload',
      900,
    ]);
    expect(ATLAS_MEDIA_DELETION_FENCE_SECONDS).toBe(15 * 60);
    expect(String(statement).replace(/\s+/g, ' ')).toContain(
      "NOW() + ($8 * INTERVAL '1 second')",
    );
  });

  it('refuses a conflicting identity instead of losing cleanup work', async () => {
    const client = {
      query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    } as never;

    await expect(
      enqueueAtlasMediaDeletionWithinTransaction(client, {
        mediaId,
        entryId,
        userId,
        originalPath,
        thumbnailPath,
        reservedBytes: 1,
        reason: 'cancelled_upload',
      }),
    ).rejects.toThrow('Conflicting Atlas media deletion identity.');
  });

  it('claims with an expiring fenced lease and completes only after Blob deletion', async () => {
    installClaim([claimedDeletion()]);

    await expect(processAtlasMediaDeletionOutbox()).resolves.toEqual({
      claimed: 1,
      completed: 1,
      deadLettered: 0,
      failed: 0,
    });

    const claimStatement = __testMocks.clientQuery.mock.calls
      .map(([query]) => String(query).replace(/\s+/g, ' ').trim())
      .find((query) => query.startsWith('WITH claimable AS'));
    expect(claimStatement).toContain('FOR UPDATE SKIP LOCKED');
    expect(claimStatement).toContain(
      '(leased_until IS NULL OR leased_until <= NOW())',
    );
    expect(deleteAtlasMediaObjects).toHaveBeenCalledWith([
      originalPath,
      thumbnailPath,
    ]);
    const completionCall = __testMocks.databaseQuery.mock.calls.find(
      ([query]) => String(query).includes('completed_at = NOW()'),
    );
    expect(completionCall).toBeDefined();
    expect(completionCall?.[1]?.[0]).toBe(claimedDeletion().id);
    expect(typeof completionCall?.[1]?.[1]).toBe('string');
    expect(
      jest.mocked(deleteAtlasMediaObjects).mock.invocationCallOrder[0],
    ).toBeLessThan(__testMocks.databaseQuery.mock.invocationCallOrder[0]);
  });

  it('deletes a safe legacy object pair even when its UUID differs from the association ID', async () => {
    const legacyObjectId = '5a5f5722-c061-44b9-b6de-c99410bf9c4d';
    const legacyOriginal = `atlas/memories/${entryId}/${legacyObjectId}.jpg`;
    const legacyThumbnail = `atlas/memories/${entryId}/${legacyObjectId}.thumbnail.webp`;
    installClaim([
      claimedDeletion({
        original_path: legacyOriginal,
        thumbnail_path: legacyThumbnail,
      }),
    ]);

    await expect(processAtlasMediaDeletionOutbox()).resolves.toEqual({
      claimed: 1,
      completed: 1,
      deadLettered: 0,
      failed: 0,
    });
    expect(deleteAtlasMediaObjects).toHaveBeenCalledWith([
      legacyOriginal,
      legacyThumbnail,
    ]);
  });

  it('releases the lease and backs off indefinitely after a transient failure', async () => {
    installClaim([claimedDeletion({ attempt_count: 19 })]);
    jest
      .mocked(deleteAtlasMediaObjects)
      .mockRejectedValueOnce(new Error('Blob unavailable'));

    await expect(processAtlasMediaDeletionOutbox()).resolves.toEqual({
      claimed: 1,
      completed: 0,
      deadLettered: 0,
      failed: 1,
    });

    const failureCall = __testMocks.databaseQuery.mock.calls.find(([query]) =>
      String(query).includes("'storage_delete_failed'"),
    );
    expect(failureCall).toBeUndefined();
    const updateCall = __testMocks.databaseQuery.mock.calls.find(([query]) =>
      String(query).includes('last_error_code = $4'),
    );
    expect(updateCall?.[1]).toEqual([
      claimedDeletion().id,
      expect.any(String),
      86_400,
      'storage_delete_failed',
      false,
    ]);
  });

  it('dead-letters a malformed path without sending it to Blob storage', async () => {
    installClaim([
      claimedDeletion({
        original_path: 'atlas/memories/not-the-entry/private.jpg',
      }),
    ]);

    await expect(processAtlasMediaDeletionOutbox()).resolves.toEqual({
      claimed: 1,
      completed: 0,
      deadLettered: 1,
      failed: 0,
    });

    expect(deleteAtlasMediaObjects).not.toHaveBeenCalled();
    const updateCall = __testMocks.databaseQuery.mock.calls.find(([query]) =>
      String(query).includes('last_error_code = $4'),
    );
    expect(updateCall?.[1]).toEqual([
      claimedDeletion().id,
      expect.any(String),
      60,
      'invalid_path',
      true,
    ]);
  });

  it('dead-letters an out-of-policy legacy size without sending it to Blob storage', async () => {
    installClaim([
      claimedDeletion({
        reserved_bytes: String(24 * 1024 * 1024 + 1),
      }),
    ]);

    await expect(processAtlasMediaDeletionOutbox()).resolves.toEqual({
      claimed: 1,
      completed: 0,
      deadLettered: 1,
      failed: 0,
    });

    expect(deleteAtlasMediaObjects).not.toHaveBeenCalled();
    const updateCall = __testMocks.databaseQuery.mock.calls.find(([query]) =>
      String(query).includes('last_error_code = $4'),
    );
    expect(updateCall?.[1]).toEqual([
      claimedDeletion().id,
      expect.any(String),
      60,
      'invalid_reserved_bytes',
      true,
    ]);
  });

  it('uses capped retry delays without a transient-attempt ceiling', () => {
    expect(
      [1, 2, 3, 4, 5, 6, 7, 500].map(atlasMediaDeletionRetryDelaySeconds),
    ).toEqual([60, 300, 900, 3600, 14_400, 43_200, 86_400, 86_400]);
  });

  it('reports health and retains completed rows for 90 days', async () => {
    __testMocks.databaseQuery
      .mockResolvedValueOnce({
        rows: [
          {
            pending: '3',
            dead_lettered: '1',
            oldest_pending_at: new Date('2026-09-01T12:00:00.000Z'),
          },
        ],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 2 });

    await expect(getAtlasMediaDeletionOutboxHealth()).resolves.toEqual({
      pending: 3,
      deadLettered: 1,
      oldestPendingAt: '2026-09-01T12:00:00.000Z',
    });
    await deleteRetainedAtlasMediaDeletions();

    expect(
      String(__testMocks.databaseQuery.mock.calls[1]?.[0]).replace(/\s+/g, ' '),
    ).toContain("completed_at < NOW() - INTERVAL '90 days'");
  });

  it('defines a trigger-backed queue that quarantines untrusted legacy payloads for worker validation', async () => {
    const migration = await readFile(
      resolve('migrations/028_atlas_media_deletion_outbox.sql'),
      'utf8',
    );

    expect(migration).toContain('BEFORE DELETE ON public.atlas_media');
    expect(migration).toContain(
      'EXECUTE FUNCTION public.enqueue_atlas_media_deletion()',
    );
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.enqueue_atlas_media_deletion()',
    );
    expect(migration).toContain('SET search_path = pg_catalog, public');
    expect(migration).toContain(
      'INSERT INTO public.atlas_media_deletion_outbox',
    );
    expect(migration).toContain('OLD.storage_path');
    expect(migration).toContain('OLD.thumbnail_path');
    expect(migration).toContain('atlas_media_deletion_outbox_lease_pair');
    expect(migration).toContain('atlas_media_deletion_outbox_terminal_state');
    expect(migration).toContain(
      'Payload columns intentionally have no path or byte-policy CHECKs',
    );
    expect(migration).not.toContain(
      'atlas_media_deletion_outbox_original_path_valid',
    );
    expect(migration).not.toContain(
      'atlas_media_deletion_outbox_thumbnail_path_valid',
    );
    expect(migration).not.toContain('atlas_media_deletion_outbox_paths_paired');
    expect(migration).not.toContain(
      'atlas_media_deletion_outbox_reserved_bytes',
    );
    expect(migration).not.toContain("media_id::TEXT || '.jpg'");
    expect(migration).not.toContain("ELSE ''");
    expect(migration).toContain('ON CONFLICT (media_id) DO UPDATE');
    expect(migration).toContain(
      "available_at TIMESTAMPTZ NOT NULL DEFAULT (\n    NOW() + INTERVAL '15 minutes'",
    );
    expect(migration).toContain("available_at = NOW() + INTERVAL '15 minutes'");
    expect(migration).not.toMatch(
      /REFERENCES\s+(?:users|atlas_entries|atlas_media)/i,
    );
  });
});
