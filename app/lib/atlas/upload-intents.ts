import 'server-only';

import { del } from '@vercel/blob';
import { db, sql, type VercelPoolClient } from '@/app/lib/db';
import { z } from 'zod';

import {
  ATLAS_MEDIA_MAX_FILES,
  ATLAS_MEDIA_PAIR_RESERVED_BYTES,
  ATLAS_MEDIA_USER_STORAGE_MAX_BYTES,
} from '@/app/lib/atlas/media-policy';
import { getAtlasBlobToken } from '@/app/lib/atlas/media-storage';

const UPLOAD_INTENT_TTL_MS = 30 * 60 * 1000;
const UPLOAD_TOKEN_TTL_MS = 10 * 60 * 1000;
const CLEANUP_LEASE_MINUTES = 15;
const CLEANUP_BATCH_SIZE = 50;

export const atlasUploadTokenPayloadSchema = z.object({
  userId: z.string().uuid(),
  entryId: z.string().uuid(),
  mediaId: z.string().uuid(),
  pathname: z.string().min(1).max(512),
  thumbnailPathname: z.string().min(1).max(512),
  variant: z.enum(['original', 'thumbnail']),
});

export type AtlasUploadVariant = 'original' | 'thumbnail';

export type AtlasUploadIntentIdentity = {
  userId: string;
  entryId: string;
  mediaId: string;
  pathname: string;
  thumbnailPathname: string;
};

type UploadIntentRow = {
  media_id: string;
  user_id: string;
  entry_id: string;
  original_path: string;
  thumbnail_path: string;
  expires_at: Date;
  consumed_at: Date | null;
  cleanup_started_at: Date | null;
};

type CleanupIntentRow = Pick<
  UploadIntentRow,
  'media_id' | 'original_path' | 'thumbnail_path'
> & { cleanup_started_at: Date };

export class AtlasUploadIntentError extends Error {
  constructor(
    readonly code: 'invalid' | 'limit' | 'not-found',
    message: string,
  ) {
    super(message);
    this.name = 'AtlasUploadIntentError';
  }
}

function pathsMatch(row: UploadIntentRow, intent: AtlasUploadIntentIdentity) {
  return (
    row.user_id === intent.userId &&
    row.entry_id === intent.entryId &&
    row.original_path === intent.pathname &&
    row.thumbnail_path === intent.thumbnailPathname
  );
}

async function markVariantAuthorized(
  client: VercelPoolClient,
  mediaId: string,
  variant: AtlasUploadVariant,
) {
  if (variant === 'original') {
    await client.query(
      `
        UPDATE atlas_media_upload_intents
        SET original_authorized_at = COALESCE(original_authorized_at, NOW()),
            updated_at = NOW()
        WHERE media_id = $1
      `,
      [mediaId],
    );
    return;
  }

  await client.query(
    `
      UPDATE atlas_media_upload_intents
      SET thumbnail_authorized_at = COALESCE(thumbnail_authorized_at, NOW()),
          updated_at = NOW()
      WHERE media_id = $1
    `,
    [mediaId],
  );
}

export async function reserveAtlasMediaUploadVariant(
  intent: AtlasUploadIntentIdentity & { variant: AtlasUploadVariant },
) {
  const client = await db.connect();
  const expiresAt = new Date(Date.now() + UPLOAD_INTENT_TTL_MS);

  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`,
      // The account-wide lock makes the storage quota race-free even when a
      // user starts uploads for several memories at the same time. The entry
      // row lock below separately serializes registration and per-entry slots.
      [`atlas-upload:${intent.userId}`],
    );

    const importAssociation = await client.query<{ batch_id: string }>(
      `
        SELECT batch_id
        FROM atlas_import_items
        WHERE entry_id = $1 AND user_id = $2
        LIMIT 1
      `,
      [intent.entryId, intent.userId],
    );
    const importBatchId = importAssociation.rows[0]?.batch_id ?? null;
    if (importBatchId) {
      const importBatch = await client.query<{ status: string }>(
        `
          SELECT status
          FROM atlas_import_batches
          WHERE id = $1 AND user_id = $2
          LIMIT 1
          FOR UPDATE
        `,
        [importBatchId, intent.userId],
      );
      if (importBatch.rows[0]?.status !== 'uploading') {
        throw new AtlasUploadIntentError(
          'not-found',
          'That memory cannot accept a photo.',
        );
      }

      const importItem = await client.query<{ id: string }>(
        `
          SELECT id
          FROM atlas_import_items
          WHERE batch_id = $1
            AND entry_id = $2
            AND user_id = $3
            AND expected_media_id = $4
            AND status = 'pending'
            AND source_width IS NOT NULL
            AND source_height IS NOT NULL
            AND media_width IS NOT NULL
            AND media_height IS NOT NULL
            AND prepared_byte_size IS NOT NULL
            AND thumbnail_byte_size IS NOT NULL
          LIMIT 1
          FOR UPDATE
        `,
        [importBatchId, intent.entryId, intent.userId, intent.mediaId],
      );
      if (!importItem.rows[0]) {
        throw new AtlasUploadIntentError(
          'not-found',
          'That memory cannot accept a photo.',
        );
      }
    }

    const entry = await client.query<{ id: string }>(
      `
        SELECT id
        FROM atlas_entries
        WHERE id = $1
          AND user_id = $2
          AND deleted_at IS NULL
        LIMIT 1
        FOR UPDATE
      `,
      [intent.entryId, intent.userId],
    );

    if (!entry.rows[0]) {
      throw new AtlasUploadIntentError(
        'not-found',
        'That memory cannot accept a photo.',
      );
    }

    const existing = await client.query<UploadIntentRow>(
      `
        SELECT
          media_id,
          user_id,
          entry_id,
          original_path,
          thumbnail_path,
          expires_at,
          consumed_at,
          cleanup_started_at
        FROM atlas_media_upload_intents
        WHERE media_id = $1
        LIMIT 1
        FOR UPDATE
      `,
      [intent.mediaId],
    );
    const existingIntent = existing.rows[0];

    if (existingIntent) {
      if (
        !pathsMatch(existingIntent, intent) ||
        existingIntent.consumed_at ||
        existingIntent.cleanup_started_at ||
        existingIntent.expires_at <= new Date()
      ) {
        throw new AtlasUploadIntentError(
          'invalid',
          'This photo upload is no longer available.',
        );
      }

      await markVariantAuthorized(client, intent.mediaId, intent.variant);
      await client.query('COMMIT');
      return {
        validUntil: Math.min(
          existingIntent.expires_at.getTime(),
          Date.now() + UPLOAD_TOKEN_TTL_MS,
        ),
      };
    }

    const quota = await client.query<{
      registered_entry_count: number | string;
      reserved_entry_count: number | string;
      registered_user_bytes: number | string;
      reserved_user_bytes: number | string;
    }>(
      `
        SELECT
          (
            SELECT COUNT(*)::int
            FROM atlas_media
            WHERE entry_id = $1
          ) AS registered_entry_count,
          (
            SELECT COUNT(*)::int
            FROM atlas_media_upload_intents
            WHERE entry_id = $1 AND consumed_at IS NULL
          ) AS reserved_entry_count,
          (
            SELECT COALESCE(SUM(byte_size + thumbnail_byte_size), 0)::bigint
            FROM atlas_media
            WHERE user_id = $2
          ) AS registered_user_bytes,
          (
            SELECT COALESCE(SUM(reserved_bytes), 0)::bigint
            FROM atlas_media_upload_intents
            WHERE user_id = $2 AND consumed_at IS NULL
          ) AS reserved_user_bytes
      `,
      [intent.entryId, intent.userId],
    );
    const usage = quota.rows[0];
    const entrySlots =
      Number(usage?.registered_entry_count ?? 0) +
      Number(usage?.reserved_entry_count ?? 0);
    const userBytes =
      Number(usage?.registered_user_bytes ?? 0) +
      Number(usage?.reserved_user_bytes ?? 0);

    if (entrySlots >= ATLAS_MEDIA_MAX_FILES) {
      throw new AtlasUploadIntentError(
        'limit',
        `A memory can hold up to ${ATLAS_MEDIA_MAX_FILES} photos.`,
      );
    }

    if (
      userBytes + ATLAS_MEDIA_PAIR_RESERVED_BYTES >
      ATLAS_MEDIA_USER_STORAGE_MAX_BYTES
    ) {
      throw new AtlasUploadIntentError(
        'limit',
        'Your atlas photo storage is full.',
      );
    }

    await client.query(
      `
        INSERT INTO atlas_media_upload_intents (
          media_id,
          user_id,
          entry_id,
          original_path,
          thumbnail_path,
          reserved_bytes,
          expires_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `,
      [
        intent.mediaId,
        intent.userId,
        intent.entryId,
        intent.pathname,
        intent.thumbnailPathname,
        ATLAS_MEDIA_PAIR_RESERVED_BYTES,
        expiresAt,
      ],
    );
    await markVariantAuthorized(client, intent.mediaId, intent.variant);
    await client.query('COMMIT');

    return {
      validUntil: Math.min(
        expiresAt.getTime(),
        Date.now() + UPLOAD_TOKEN_TTL_MS,
      ),
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function markAtlasMediaUploadCompleted({
  tokenPayload,
  pathname,
}: {
  tokenPayload: unknown;
  pathname: string;
}) {
  const parsed = atlasUploadTokenPayloadSchema.safeParse(tokenPayload);
  if (!parsed.success) {
    throw new AtlasUploadIntentError('invalid', 'Invalid upload callback.');
  }

  const payload = parsed.data;
  const expectedPath =
    payload.variant === 'original'
      ? payload.pathname
      : payload.thumbnailPathname;
  if (pathname !== expectedPath) {
    throw new AtlasUploadIntentError('invalid', 'Invalid upload callback.');
  }

  const values = [
    payload.mediaId,
    payload.userId,
    payload.entryId,
    payload.pathname,
    payload.thumbnailPathname,
  ];
  const result =
    payload.variant === 'original'
      ? await sql.query(
          `
            UPDATE atlas_media_upload_intents
            SET original_uploaded_at = COALESCE(original_uploaded_at, NOW()),
                updated_at = NOW()
            WHERE media_id = $1
              AND user_id = $2
              AND entry_id = $3
              AND original_path = $4
              AND thumbnail_path = $5
              AND cleanup_started_at IS NULL
            RETURNING media_id
          `,
          values,
        )
      : await sql.query(
          `
            UPDATE atlas_media_upload_intents
            SET thumbnail_uploaded_at = COALESCE(thumbnail_uploaded_at, NOW()),
                updated_at = NOW()
            WHERE media_id = $1
              AND user_id = $2
              AND entry_id = $3
              AND original_path = $4
              AND thumbnail_path = $5
              AND cleanup_started_at IS NULL
            RETURNING media_id
          `,
          values,
        );

  if (result.rowCount !== 1) {
    throw new AtlasUploadIntentError('invalid', 'Invalid upload callback.');
  }
}

export async function lockAtlasMediaUploadIntentForRegistration(
  client: VercelPoolClient,
  intent: AtlasUploadIntentIdentity,
) {
  const result = await client.query<UploadIntentRow>(
    `
      SELECT
        media_id,
        user_id,
        entry_id,
        original_path,
        thumbnail_path,
        expires_at,
        consumed_at,
        cleanup_started_at
      FROM atlas_media_upload_intents
      WHERE media_id = $1
      LIMIT 1
      FOR UPDATE
    `,
    [intent.mediaId],
  );
  const row = result.rows[0];

  return Boolean(
    row &&
    pathsMatch(row, intent) &&
    !row.consumed_at &&
    !row.cleanup_started_at,
  );
}

export async function consumeAtlasMediaUploadIntent(
  client: VercelPoolClient,
  intent: AtlasUploadIntentIdentity,
) {
  const result = await client.query(
    `
      UPDATE atlas_media_upload_intents
      SET consumed_at = NOW(), updated_at = NOW()
      WHERE media_id = $1
        AND user_id = $2
        AND entry_id = $3
        AND original_path = $4
        AND thumbnail_path = $5
        AND consumed_at IS NULL
        AND cleanup_started_at IS NULL
      RETURNING media_id
    `,
    [
      intent.mediaId,
      intent.userId,
      intent.entryId,
      intent.pathname,
      intent.thumbnailPathname,
    ],
  );
  return result.rowCount === 1;
}

async function releaseCleanupLease(row: CleanupIntentRow) {
  await sql`
    UPDATE atlas_media_upload_intents
    SET cleanup_started_at = NULL, updated_at = NOW()
    WHERE media_id = ${row.media_id}
      AND cleanup_started_at = ${row.cleanup_started_at.toISOString()}
      AND consumed_at IS NULL
  `;
}

async function deleteClaimedIntentBlobs(row: CleanupIntentRow) {
  const registered = await sql<{ id: string }>`
    SELECT id
    FROM atlas_media
    WHERE id = ${row.media_id}
      OR storage_path = ${row.original_path}
      OR thumbnail_path = ${row.thumbnail_path}
    LIMIT 1
  `;

  if (registered.rows[0]) {
    await sql`
      UPDATE atlas_media_upload_intents
      SET consumed_at = COALESCE(consumed_at, NOW()),
          cleanup_started_at = NULL,
          updated_at = NOW()
      WHERE media_id = ${row.media_id}
    `;
    return;
  }

  try {
    await del([row.original_path, row.thumbnail_path], {
      token: getAtlasBlobToken(),
    });
    await sql`
      DELETE FROM atlas_media_upload_intents
      WHERE media_id = ${row.media_id}
        AND cleanup_started_at = ${row.cleanup_started_at.toISOString()}
        AND consumed_at IS NULL
    `;
  } catch (error) {
    await releaseCleanupLease(row);
    throw error;
  }
}

export async function cleanupExpiredAtlasMediaUploadIntents() {
  const claimed = await sql.query<CleanupIntentRow>(
    `
      WITH candidates AS (
        SELECT media_id
        FROM atlas_media_upload_intents
        WHERE consumed_at IS NULL
          AND expires_at < NOW()
          AND (
            cleanup_started_at IS NULL
            OR cleanup_started_at < NOW() - ($1 * INTERVAL '1 minute')
          )
        ORDER BY expires_at
        LIMIT $2
        FOR UPDATE SKIP LOCKED
      )
      UPDATE atlas_media_upload_intents AS intent
      SET cleanup_started_at = NOW(),
          cleanup_attempts = cleanup_attempts + 1,
          updated_at = NOW()
      FROM candidates
      WHERE intent.media_id = candidates.media_id
      RETURNING
        intent.media_id,
        intent.original_path,
        intent.thumbnail_path,
        intent.cleanup_started_at
    `,
    [CLEANUP_LEASE_MINUTES, CLEANUP_BATCH_SIZE],
  );

  const results = await Promise.allSettled(
    claimed.rows.map(deleteClaimedIntentBlobs),
  );
  const failures = results.filter((result) => result.status === 'rejected');

  await sql`
    DELETE FROM atlas_media_upload_intents
    WHERE consumed_at < NOW() - INTERVAL '1 day'
  `;

  if (failures.length) {
    throw new Error(
      `${failures.length} expired atlas upload intent cleanups failed.`,
    );
  }

  return { cleaned: results.length };
}

export async function discardAtlasMediaUploadIntent(
  intent: AtlasUploadIntentIdentity,
) {
  const claimed = await sql<CleanupIntentRow>`
    UPDATE atlas_media_upload_intents
    SET cleanup_started_at = NOW(),
        cleanup_attempts = cleanup_attempts + 1,
        updated_at = NOW()
    WHERE media_id = ${intent.mediaId}
      AND user_id = ${intent.userId}
      AND entry_id = ${intent.entryId}
      AND original_path = ${intent.pathname}
      AND thumbnail_path = ${intent.thumbnailPathname}
      AND consumed_at IS NULL
      AND cleanup_started_at IS NULL
    RETURNING media_id, original_path, thumbnail_path, cleanup_started_at
  `;
  const row = claimed.rows[0];
  if (!row) return false;

  await deleteClaimedIntentBlobs(row);
  return true;
}
