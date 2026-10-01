import 'server-only';

import { db, sql } from '@/app/lib/db';
import { scheduleAtlasMediaDeletion } from './media-deletion-scheduler';
import { enqueueAtlasMediaDeletionWithinTransaction } from './media-deletion-outbox';

const CLEANUP_LEASE_MINUTES = 15;
const CLEANUP_BATCH_SIZE = 10;
const IMPORT_STALE_HOURS = 24;
// Retained temporarily so unfinished batches created before the importer was
// retired can release their private media safely.
const LEGACY_IMPORT_CLEANUP_FENCE_MINUTES = 31;

type CleanupClaim = {
  id: string;
  user_id: string;
  cleanup_started_at: Date;
  cleanup_attempts: number;
};

async function releaseImportCleanupLease(claim: CleanupClaim) {
  await sql`
    UPDATE atlas_import_batches
    SET cleanup_started_at = NULL, updated_at = NOW()
    WHERE id = ${claim.id}
      AND user_id = ${claim.user_id}
      AND cleanup_attempts = ${claim.cleanup_attempts}
      AND status = 'cancel_pending'
  `;
}

async function cleanupClaimedImportBatch(claim: CleanupClaim) {
  let queuedMedia = false;
  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const locked = await client.query<{ id: string }>(
        `
          SELECT id
          FROM atlas_import_batches
          WHERE id = $1
            AND user_id = $2
            AND status = 'cancel_pending'
            AND cleanup_not_before <= NOW()
            AND cleanup_attempts = $3
          FOR UPDATE
        `,
        [claim.id, claim.user_id, claim.cleanup_attempts],
      );
      if (!locked.rows[0]) {
        await client.query('ROLLBACK');
        return false;
      }
      const entries = await client.query<{ entry_id: string }>(
        `
          SELECT entry_id
          FROM atlas_import_items
          WHERE batch_id = $1 AND user_id = $2
        `,
        [claim.id, claim.user_id],
      );
      const entryIds = entries.rows.map((row) => row.entry_id);
      if (entryIds.length) {
        const intents = await client.query<{
          media_id: string;
          entry_id: string;
          original_path: string;
          thumbnail_path: string;
          reserved_bytes: number | string;
          has_exact_registered_match: boolean;
          has_registered_conflict: boolean;
        }>(
          `
            SELECT
              intent.media_id,
              intent.entry_id,
              intent.original_path,
              intent.thumbnail_path,
              intent.reserved_bytes,
              EXISTS (
                SELECT 1
                FROM atlas_media AS registered_media
                WHERE registered_media.id = intent.media_id
                  AND registered_media.entry_id = intent.entry_id
                  AND registered_media.user_id = intent.user_id
                  AND registered_media.storage_path = intent.original_path
                  AND registered_media.thumbnail_path = intent.thumbnail_path
              ) AS has_exact_registered_match,
              EXISTS (
                SELECT 1
                FROM atlas_media AS registered_media
                WHERE (
                    registered_media.id = intent.media_id
                    OR registered_media.storage_path IN (
                      intent.original_path,
                      intent.thumbnail_path
                    )
                    OR registered_media.thumbnail_path IN (
                      intent.original_path,
                      intent.thumbnail_path
                    )
                  )
                  AND NOT (
                    registered_media.id = intent.media_id
                    AND registered_media.entry_id = intent.entry_id
                    AND registered_media.user_id = intent.user_id
                    AND registered_media.storage_path = intent.original_path
                    AND registered_media.thumbnail_path = intent.thumbnail_path
                  )
              ) AS has_registered_conflict
            FROM atlas_media_upload_intents AS intent
            WHERE intent.user_id = $1
              AND intent.entry_id = ANY($2::uuid[])
            ORDER BY intent.media_id
            FOR UPDATE
          `,
          [claim.user_id, entryIds],
        );
        // Never discard the only durable record of an object pair when a
        // malformed legacy intent aliases just part of live media. Retain the
        // whole batch for operator repair instead of guessing which object is
        // safe to remove.
        if (intents.rows.some((intent) => intent.has_registered_conflict)) {
          throw new Error(
            'Atlas import cleanup found a conflicting live media identity.',
          );
        }
        for (const intent of intents.rows) {
          // Exact registered pairs are queued by the atlas_media DELETE
          // trigger below. Only unregistered reservations need an explicit
          // outbox row.
          if (intent.has_exact_registered_match) continue;
          await enqueueAtlasMediaDeletionWithinTransaction(client, {
            mediaId: intent.media_id,
            entryId: intent.entry_id,
            userId: claim.user_id,
            originalPath: intent.original_path,
            thumbnailPath: intent.thumbnail_path,
            reservedBytes: Number(intent.reserved_bytes),
            reason: 'cancelled_upload',
          });
          queuedMedia = true;
        }
        await client.query(
          `DELETE FROM atlas_media_upload_intents
           WHERE user_id = $1 AND entry_id = ANY($2::uuid[])`,
          [claim.user_id, entryIds],
        );
        await client.query(
          `DELETE FROM atlas_media
           WHERE user_id = $1 AND entry_id = ANY($2::uuid[])`,
          [claim.user_id, entryIds],
        );
        queuedMedia = true;
        await client.query(
          `DELETE FROM atlas_entries
           WHERE user_id = $1 AND id = ANY($2::uuid[])`,
          [claim.user_id, entryIds],
        );
      }
      await client.query(
        `DELETE FROM atlas_import_batches
         WHERE id = $1 AND user_id = $2 AND status = 'cancel_pending'`,
        [claim.id, claim.user_id],
      );
      await client.query('COMMIT');
      if (queuedMedia) scheduleAtlasMediaDeletion();
      return true;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    await releaseImportCleanupLease(claim).catch(() => undefined);
    throw error;
  }
}

async function claimImportBatchForCleanup() {
  return sql.query<CleanupClaim>(
    `
      WITH candidate AS (
        SELECT id
        FROM atlas_import_batches
        WHERE status = 'cancel_pending'
          AND cleanup_not_before <= NOW()
          AND (
            cleanup_started_at IS NULL
            OR cleanup_started_at < NOW() - ($1 * INTERVAL '1 minute')
          )
        ORDER BY cleanup_not_before, updated_at
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE atlas_import_batches AS batch
      SET cleanup_started_at = date_trunc('milliseconds', clock_timestamp()),
          cleanup_attempts = cleanup_attempts + 1,
          updated_at = NOW()
      FROM candidate
      WHERE batch.id = candidate.id
      RETURNING
        batch.id,
        batch.user_id,
        batch.cleanup_started_at,
        batch.cleanup_attempts
    `,
    [CLEANUP_LEASE_MINUTES],
  );
}

export async function cleanupCancelledAtlasImportBatches() {
  await sql`
    WITH cancelled AS (
      UPDATE atlas_import_batches
      SET
        status = 'cancel_pending',
        version = version + 1,
        cleanup_not_before = NOW() + (${LEGACY_IMPORT_CLEANUP_FENCE_MINUTES} * INTERVAL '1 minute'),
        updated_at = NOW()
      WHERE status IN ('uploading', 'ready')
        AND updated_at < NOW() - (${IMPORT_STALE_HOURS} * INTERVAL '1 hour')
      RETURNING id, user_id
    )
    UPDATE atlas_media AS media
    SET source_hash = NULL
    FROM atlas_import_items AS item
    INNER JOIN cancelled
      ON cancelled.id = item.batch_id
      AND cancelled.user_id = item.user_id
    WHERE media.id = item.expected_media_id
      AND media.entry_id = item.entry_id
      AND media.user_id = item.user_id
  `;

  let cleaned = 0;
  for (let index = 0; index < CLEANUP_BATCH_SIZE; index += 1) {
    const claimed = await claimImportBatchForCleanup();
    const row = claimed.rows[0];
    if (!row) break;
    if (await cleanupClaimedImportBatch(row)) cleaned += 1;
  }

  await Promise.all([
    sql`
      DELETE FROM atlas_import_geocode_cache
      WHERE expires_at < NOW() - INTERVAL '1 day'
    `,
    sql`
      DELETE FROM atlas_import_geocode_usage
      WHERE updated_at < NOW() - INTERVAL '2 hours'
    `,
  ]);
  return { cleaned };
}
