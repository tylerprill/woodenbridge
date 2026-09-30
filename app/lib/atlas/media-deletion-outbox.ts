import 'server-only';

import { randomUUID } from 'node:crypto';

import { db, type VercelPoolClient } from '@/app/lib/db';

import { areAtlasMediaPathsPaired, isAtlasMediaPath } from './media-policy';
import { deleteAtlasMediaObjects } from './media-storage';

const DELETION_LEASE_SECONDS = 2 * 60;
const DEFAULT_BATCH_SIZE = 8;
const MAX_BATCH_SIZE = 20;
const DELETION_CONCURRENCY = 4;
const MAX_DELETION_RESERVED_BYTES = 24 * 1024 * 1024;
// Presigned PUTs are valid for at most 10 minutes. Delay every first deletion
// attempt for another five-minute in-flight grace so a request that started
// before cancellation cannot recreate an object after cleanup has run.
export const ATLAS_MEDIA_DELETION_FENCE_SECONDS = 15 * 60;

export type AtlasMediaDeletionReason = 'registered_media' | 'cancelled_upload';

export type EnqueueAtlasMediaDeletionInput = {
  mediaId: string;
  entryId: string;
  userId: string;
  originalPath: string;
  thumbnailPath: string;
  reservedBytes: number;
  reason: AtlasMediaDeletionReason;
};

type ClaimedDeletion = {
  id: string;
  media_id: string;
  entry_id: string;
  original_path: string;
  thumbnail_path: string | null;
  reserved_bytes: number | string;
  attempt_count: number;
};

export type AtlasMediaDeletionSummary = {
  claimed: number;
  completed: number;
  deadLettered: number;
  failed: number;
};

export type AtlasMediaDeletionOutboxHealth = {
  deadLettered: number;
  oldestPendingAt: string | null;
  pending: number;
};

function normalizedBatchSize(batchSize: number | undefined) {
  if (!Number.isFinite(batchSize)) return DEFAULT_BATCH_SIZE;
  return Math.max(1, Math.min(Math.trunc(batchSize!), MAX_BATCH_SIZE));
}

function invalidDeletionPayloadCode(
  deletion: ClaimedDeletion,
): 'invalid_path' | 'invalid_reserved_bytes' | null {
  if (!isAtlasMediaPath(deletion.original_path, deletion.entry_id)) {
    return 'invalid_path';
  }

  if (
    deletion.thumbnail_path !== null &&
    !areAtlasMediaPathsPaired(
      deletion.original_path,
      deletion.thumbnail_path,
      deletion.entry_id,
    )
  ) {
    return 'invalid_path';
  }

  const reservedBytes = Number(deletion.reserved_bytes);
  if (
    !Number.isSafeInteger(reservedBytes) ||
    reservedBytes < 1 ||
    reservedBytes > MAX_DELETION_RESERVED_BYTES
  ) {
    return 'invalid_reserved_bytes';
  }

  return null;
}

/**
 * Enqueues an object pair on the caller's open transaction. Registered media
 * normally enters through the database DELETE trigger; this helper is for
 * unregistered upload reservations removed by legacy import cleanup.
 */
export async function enqueueAtlasMediaDeletionWithinTransaction(
  client: VercelPoolClient,
  input: EnqueueAtlasMediaDeletionInput,
) {
  const result = await client.query<{ id: string }>(
    `
      INSERT INTO atlas_media_deletion_outbox (
        media_id,
        entry_id,
        user_id,
        original_path,
        thumbnail_path,
        reserved_bytes,
        reason,
        available_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() + ($8 * INTERVAL '1 second'))
      ON CONFLICT (media_id) DO UPDATE
      SET
        reserved_bytes = GREATEST(
          atlas_media_deletion_outbox.reserved_bytes,
          EXCLUDED.reserved_bytes
        ),
        reason = EXCLUDED.reason,
        attempt_count = 0,
        available_at = NOW() + ($8 * INTERVAL '1 second'),
        lease_token = NULL,
        leased_until = NULL,
        last_attempt_at = NULL,
        last_error_code = NULL,
        completed_at = NULL,
        dead_at = NULL,
        updated_at = NOW()
      WHERE
        atlas_media_deletion_outbox.entry_id = EXCLUDED.entry_id
        AND atlas_media_deletion_outbox.user_id = EXCLUDED.user_id
        AND atlas_media_deletion_outbox.original_path = EXCLUDED.original_path
        AND atlas_media_deletion_outbox.thumbnail_path IS NOT DISTINCT FROM
          EXCLUDED.thumbnail_path
      RETURNING id
    `,
    [
      input.mediaId,
      input.entryId,
      input.userId,
      input.originalPath,
      input.thumbnailPath,
      input.reservedBytes,
      input.reason,
      ATLAS_MEDIA_DELETION_FENCE_SECONDS,
    ],
  );

  const id = result.rows[0]?.id;
  if (!id) {
    throw new Error('Conflicting Atlas media deletion identity.');
  }
  return id;
}

async function claimAtlasMediaDeletions(batchSize?: number) {
  const client = await db.connect();
  const leaseToken = randomUUID();
  const limit = normalizedBatchSize(batchSize);

  try {
    await client.query('BEGIN');
    const result = await client.query<ClaimedDeletion>(
      `
        WITH claimable AS (
          SELECT id
          FROM atlas_media_deletion_outbox
          WHERE completed_at IS NULL
            AND dead_at IS NULL
            AND available_at <= NOW()
            AND (leased_until IS NULL OR leased_until <= NOW())
          ORDER BY available_at, created_at, id
          LIMIT $1
          FOR UPDATE SKIP LOCKED
        )
        UPDATE atlas_media_deletion_outbox AS deletion
        SET
          attempt_count = deletion.attempt_count + 1,
          lease_token = $2,
          leased_until = NOW() + ($3 * INTERVAL '1 second'),
          last_attempt_at = NOW(),
          last_error_code = NULL,
          updated_at = NOW()
        FROM claimable
        WHERE deletion.id = claimable.id
        RETURNING
          deletion.id,
          deletion.media_id,
          deletion.entry_id,
          deletion.original_path,
          deletion.thumbnail_path,
          deletion.reserved_bytes,
          deletion.attempt_count
      `,
      [limit, leaseToken, DELETION_LEASE_SECONDS],
    );
    await client.query('COMMIT');
    return { deletions: result.rows, leaseToken };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function markAtlasMediaDeletionCompleted(
  deletionId: string,
  leaseToken: string,
) {
  const result = await db.query<{ id: string }>(
    `
      UPDATE atlas_media_deletion_outbox
      SET
        completed_at = NOW(),
        lease_token = NULL,
        leased_until = NULL,
        last_error_code = NULL,
        updated_at = NOW()
      WHERE id = $1
        AND lease_token = $2
        AND completed_at IS NULL
        AND dead_at IS NULL
      RETURNING id
    `,
    [deletionId, leaseToken],
  );

  if (!result.rows[0]) {
    throw new Error('Atlas media deletion lease was lost.');
  }
}

export function atlasMediaDeletionRetryDelaySeconds(attemptCount: number) {
  if (attemptCount <= 1) return 60;
  if (attemptCount === 2) return 5 * 60;
  if (attemptCount === 3) return 15 * 60;
  if (attemptCount === 4) return 60 * 60;
  if (attemptCount === 5) return 4 * 60 * 60;
  if (attemptCount === 6) return 12 * 60 * 60;
  return 24 * 60 * 60;
}

async function markAtlasMediaDeletionFailed(
  deletion: ClaimedDeletion,
  leaseToken: string,
  errorCode:
    'invalid_path' | 'invalid_reserved_bytes' | 'storage_delete_failed',
  permanent: boolean,
) {
  const delaySeconds = atlasMediaDeletionRetryDelaySeconds(
    deletion.attempt_count,
  );
  const result = await db.query<{ id: string }>(
    `
      UPDATE atlas_media_deletion_outbox
      SET
        available_at = NOW() + ($3 * INTERVAL '1 second'),
        lease_token = NULL,
        leased_until = NULL,
        last_error_code = $4,
        dead_at = CASE WHEN $5::boolean THEN NOW() ELSE NULL END,
        updated_at = NOW()
      WHERE id = $1
        AND lease_token = $2
        AND completed_at IS NULL
        AND dead_at IS NULL
      RETURNING id
    `,
    [deletion.id, leaseToken, delaySeconds, errorCode, permanent],
  );

  if (!result.rows[0]) {
    throw new Error('Atlas media deletion failure lease was lost.');
  }
}

async function processClaimedDeletion(
  deletion: ClaimedDeletion,
  leaseToken: string,
) {
  const invalidPayloadCode = invalidDeletionPayloadCode(deletion);
  if (invalidPayloadCode) {
    await markAtlasMediaDeletionFailed(
      deletion,
      leaseToken,
      invalidPayloadCode,
      true,
    );
    return 'dead' as const;
  }

  try {
    await deleteAtlasMediaObjects(
      [deletion.original_path, deletion.thumbnail_path].filter(
        (pathname): pathname is string => Boolean(pathname),
      ),
    );
    await markAtlasMediaDeletionCompleted(deletion.id, leaseToken);
    return 'completed' as const;
  } catch {
    await markAtlasMediaDeletionFailed(
      deletion,
      leaseToken,
      'storage_delete_failed',
      false,
    );
    return 'failed' as const;
  }
}

/**
 * Claims a bounded batch and removes private objects outside the claim
 * transaction. Deletion is idempotent, so a lease that expires after Blob
 * removal but before completion can be replayed safely.
 */
export async function processAtlasMediaDeletionOutbox(options?: {
  batchSize?: number;
}): Promise<AtlasMediaDeletionSummary> {
  const { deletions, leaseToken } = await claimAtlasMediaDeletions(
    options?.batchSize,
  );
  const summary: AtlasMediaDeletionSummary = {
    claimed: deletions.length,
    completed: 0,
    deadLettered: 0,
    failed: 0,
  };

  for (
    let offset = 0;
    offset < deletions.length;
    offset += DELETION_CONCURRENCY
  ) {
    const results = await Promise.all(
      deletions
        .slice(offset, offset + DELETION_CONCURRENCY)
        .map((deletion) => processClaimedDeletion(deletion, leaseToken)),
    );
    for (const result of results) {
      if (result === 'completed') summary.completed += 1;
      if (result === 'failed') summary.failed += 1;
      if (result === 'dead') summary.deadLettered += 1;
    }
  }

  if (summary.failed || summary.deadLettered) {
    console.warn(
      JSON.stringify({ event: 'atlas_media.deletion_failure', ...summary }),
    );
  }

  return summary;
}

export async function drainAtlasMediaDeletionOutbox(options?: {
  batchSize?: number;
  maxBatches?: number;
}): Promise<AtlasMediaDeletionSummary> {
  const batchSize = normalizedBatchSize(options?.batchSize);
  const requestedMaxBatches = Number.isFinite(options?.maxBatches)
    ? Math.trunc(options!.maxBatches!)
    : 3;
  const maxBatches = Math.max(1, Math.min(requestedMaxBatches, 4));
  const aggregate: AtlasMediaDeletionSummary = {
    claimed: 0,
    completed: 0,
    deadLettered: 0,
    failed: 0,
  };

  for (let batch = 0; batch < maxBatches; batch += 1) {
    const result = await processAtlasMediaDeletionOutbox({ batchSize });
    aggregate.claimed += result.claimed;
    aggregate.completed += result.completed;
    aggregate.deadLettered += result.deadLettered;
    aggregate.failed += result.failed;

    if (
      result.failed > 0 ||
      result.deadLettered > 0 ||
      result.claimed < batchSize
    ) {
      break;
    }
  }

  return aggregate;
}

export async function deleteRetainedAtlasMediaDeletions() {
  await db.query(
    `
      DELETE FROM atlas_media_deletion_outbox
      WHERE completed_at < NOW() - INTERVAL '90 days'
    `,
  );
}

export async function getAtlasMediaDeletionOutboxHealth(): Promise<AtlasMediaDeletionOutboxHealth> {
  const result = await db.query<{
    dead_lettered: string;
    oldest_pending_at: Date | null;
    pending: string;
  }>(
    `
      SELECT
        COUNT(*) FILTER (
          WHERE completed_at IS NULL AND dead_at IS NULL
        )::text AS pending,
        COUNT(*) FILTER (WHERE dead_at IS NOT NULL)::text AS dead_lettered,
        MIN(created_at) FILTER (
          WHERE completed_at IS NULL AND dead_at IS NULL
        ) AS oldest_pending_at
      FROM atlas_media_deletion_outbox
    `,
  );
  const health = result.rows[0];

  return {
    pending: Number(health?.pending ?? 0),
    deadLettered: Number(health?.dead_lettered ?? 0),
    oldestPendingAt: health?.oldest_pending_at?.toISOString() ?? null,
  };
}
