import 'server-only';

import { del } from '@vercel/blob';

import { db, sql } from '@/app/lib/db';
import { getAtlasBlobToken } from './media-storage';
import { ATLAS_IMPORT_CLEANUP_FENCE_MINUTES } from './import-validation';

const CLEANUP_LEASE_MINUTES = 15;
const CLEANUP_BATCH_SIZE = 10;
const IMPORT_STALE_HOURS = 24;

type CleanupClaim = {
  id: string;
  user_id: string;
  cleanup_started_at: Date;
};

async function releaseImportCleanupLease(claim: CleanupClaim) {
  await sql`
    UPDATE atlas_import_batches
    SET cleanup_started_at = NULL, updated_at = NOW()
    WHERE id = ${claim.id}
      AND user_id = ${claim.user_id}
      AND cleanup_started_at = ${claim.cleanup_started_at.toISOString()}
      AND status = 'cancel_pending'
  `;
}

async function cleanupClaimedImportBatch(claim: CleanupClaim) {
  const pathResult = await sql<{ pathname: string }>`
    SELECT media.storage_path AS pathname
    FROM atlas_import_items AS item
    INNER JOIN atlas_media AS media
      ON media.entry_id = item.entry_id AND media.user_id = item.user_id
    WHERE item.batch_id = ${claim.id} AND item.user_id = ${claim.user_id}
    UNION
    SELECT media.thumbnail_path AS pathname
    FROM atlas_import_items AS item
    INNER JOIN atlas_media AS media
      ON media.entry_id = item.entry_id AND media.user_id = item.user_id
    WHERE item.batch_id = ${claim.id}
      AND item.user_id = ${claim.user_id}
      AND media.thumbnail_path IS NOT NULL
    UNION
    SELECT intent.original_path AS pathname
    FROM atlas_import_items AS item
    INNER JOIN atlas_media_upload_intents AS intent
      ON intent.entry_id = item.entry_id AND intent.user_id = item.user_id
    WHERE item.batch_id = ${claim.id} AND item.user_id = ${claim.user_id}
    UNION
    SELECT intent.thumbnail_path AS pathname
    FROM atlas_import_items AS item
    INNER JOIN atlas_media_upload_intents AS intent
      ON intent.entry_id = item.entry_id AND intent.user_id = item.user_id
    WHERE item.batch_id = ${claim.id} AND item.user_id = ${claim.user_id}
  `;
  const paths = Array.from(new Set(pathResult.rows.map((row) => row.pathname)));

  try {
    if (paths.length) await del(paths, { token: getAtlasBlobToken() });

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
            AND cleanup_started_at = $3
          FOR UPDATE
        `,
        [claim.id, claim.user_id, claim.cleanup_started_at],
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
      SET cleanup_started_at = NOW(),
          cleanup_attempts = cleanup_attempts + 1,
          updated_at = NOW()
      FROM candidate
      WHERE batch.id = candidate.id
      RETURNING batch.id, batch.user_id, batch.cleanup_started_at
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
        cleanup_not_before = NOW() + (${ATLAS_IMPORT_CLEANUP_FENCE_MINUTES} * INTERVAL '1 minute'),
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
