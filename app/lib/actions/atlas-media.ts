'use server';

import { BlobNotFoundError, del, get, head } from '@vercel/blob';
import { db, sql } from '@/app/lib/db';
import { revalidatePath } from 'next/cache';
import sharp, { type Metadata } from 'sharp';

import { requireVerifiedSession } from '@/app/lib/auth/session';
import type {
  AtlasActionResult,
  AtlasMedia,
  AtlasMediaDiscardInput,
  AtlasMediaRegistrationInput,
} from '@/app/lib/atlas/definitions';
import {
  ATLAS_MEDIA_MAX_BYTES,
  ATLAS_MEDIA_MAX_FILES,
  ATLAS_THUMBNAIL_MAX_BYTES,
  areAtlasMediaPathsPaired,
  atlasMediaDiscardSchema,
  atlasMediaRegistrationSchema,
  getAtlasMediaPathId,
  getAtlasThumbnailContentType,
  getAtlasThumbnailDimensions,
  isAllowedAtlasMediaType,
} from '@/app/lib/atlas/media-policy';
import { getAtlasBlobToken } from '@/app/lib/atlas/media-storage';
import { type AtlasMediaRow, toAtlasMedia } from '@/app/lib/atlas/rows';
import {
  consumeAtlasMediaUploadIntent,
  discardAtlasMediaUploadIntent,
  lockAtlasMediaUploadIntentForRegistration,
} from '@/app/lib/atlas/upload-intents';
import { atlasEntryIdSchema } from '@/app/lib/atlas/validation';
import {
  ATLAS_IMPORT_MAX_MEDIA_EDGE,
  ATLAS_IMPORT_MAX_PIXELS,
} from '@/app/lib/atlas/import-validation';

type ImportMediaPreflight = {
  id: string;
  import_item_id: string | null;
  import_batch_id: string | null;
  import_batch_status: string | null;
  expected_media_id: string | null;
  source_hash: string | null;
  source_width: number | null;
  source_height: number | null;
  media_width: number | null;
  media_height: number | null;
  prepared_byte_size: number | null;
  expected_thumbnail_byte_size: number | null;
  already_registered: boolean;
};

function hasPrivateImageMetadata(metadata: Metadata) {
  // ICC is a color-rendering profile, not photo provenance. Browser canvas
  // encoders attach a small standard sRGB profile to otherwise metadata-free
  // JPEG and WebP derivatives. EXIF, XMP, and IPTC are the containers that can
  // retain GPS, device, author, or editorial metadata and must remain absent.
  return Boolean(metadata.exif || metadata.xmp || metadata.iptc);
}

async function readPrivateBlob(pathname: string, token: string) {
  const result = await get(pathname, { access: 'private', token });
  if (!result || result.statusCode === 304) {
    throw new Error('Imported media could not be read.');
  }
  return Buffer.from(await new Response(result.stream).arrayBuffer());
}

async function validateImportedMedia({
  pathname,
  thumbnailPathname,
  width,
  height,
  blobSize,
  thumbnailSize,
  expected,
  token,
}: {
  pathname: string;
  thumbnailPathname: string;
  width: number;
  height: number;
  blobSize: number;
  thumbnailSize: number;
  expected: ImportMediaPreflight;
  token: string;
}) {
  if (
    expected.media_width !== width ||
    expected.media_height !== height ||
    expected.prepared_byte_size !== blobSize ||
    expected.expected_thumbnail_byte_size !== thumbnailSize ||
    !expected.source_width ||
    !expected.source_height ||
    expected.source_width * expected.source_height > ATLAS_IMPORT_MAX_PIXELS
  ) {
    return false;
  }

  const [masterBytes, thumbnailBytes] = await Promise.all([
    readPrivateBlob(pathname, token),
    readPrivateBlob(thumbnailPathname, token),
  ]);
  if (
    masterBytes.byteLength !== blobSize ||
    thumbnailBytes.byteLength !== thumbnailSize
  ) {
    return false;
  }

  const [master, thumbnail] = await Promise.all([
    sharp(masterBytes, {
      limitInputPixels: ATLAS_IMPORT_MAX_PIXELS,
    }).metadata(),
    sharp(thumbnailBytes, {
      limitInputPixels: ATLAS_IMPORT_MAX_PIXELS,
    }).metadata(),
  ]);
  const masterWidth = master.width ?? 0;
  const masterHeight = master.height ?? 0;
  const thumbnailWidth = thumbnail.width ?? 0;
  const thumbnailHeight = thumbnail.height ?? 0;
  const expectedThumbnail = getAtlasThumbnailDimensions(
    masterWidth,
    masterHeight,
  );
  const expectedThumbnailContentType =
    getAtlasThumbnailContentType(thumbnailPathname);
  const expectedThumbnailFormat =
    expectedThumbnailContentType === 'image/jpeg' ? 'jpeg' : 'webp';

  return (
    master.format === 'jpeg' &&
    masterWidth === width &&
    masterHeight === height &&
    Math.max(masterWidth, masterHeight) <= ATLAS_IMPORT_MAX_MEDIA_EDGE &&
    masterWidth * masterHeight <= ATLAS_IMPORT_MAX_PIXELS &&
    !hasPrivateImageMetadata(master) &&
    expectedThumbnailContentType !== null &&
    thumbnail.format === expectedThumbnailFormat &&
    Math.abs(thumbnailWidth - expectedThumbnail.width) <= 1 &&
    Math.abs(thumbnailHeight - expectedThumbnail.height) <= 1 &&
    Math.max(thumbnailWidth, thumbnailHeight) <= 1024 &&
    thumbnailWidth * thumbnailHeight <= ATLAS_IMPORT_MAX_PIXELS &&
    !hasPrivateImageMetadata(thumbnail)
  );
}

function failed(message = 'The photo could not be saved. Please try again.') {
  return { ok: false, error: 'failed', message } as const;
}

type ImportMediaPairStatus = {
  originalCommitted: boolean;
  thumbnailCommitted: boolean;
  registered: boolean;
};

async function importedBlobCommitted({
  pathname,
  expectedContentType,
  expectedSize,
  token,
}: {
  pathname: string;
  expectedContentType: string;
  expectedSize: number;
  token: string;
}) {
  try {
    const blob = await head(pathname, { token });
    if (
      blob.pathname !== pathname ||
      blob.contentType !== expectedContentType ||
      blob.size !== expectedSize
    ) {
      throw new Error('Committed import media did not match its preparation.');
    }
    return true;
  } catch (error) {
    if (error instanceof BlobNotFoundError) return false;
    throw error;
  }
}

/**
 * Recovers deterministic private Blob writes whose browser response was lost.
 * The probe is intentionally scoped to the signed-in user's expected import
 * item; it never accepts a caller-supplied arbitrary Blob pathname.
 */
export async function getAtlasImportMediaPairStatusAction(
  input: AtlasMediaRegistrationInput,
): Promise<AtlasActionResult<ImportMediaPairStatus>> {
  const session = await requireVerifiedSession();
  const parsed = atlasMediaRegistrationSchema.safeParse(input);

  if (
    !parsed.success ||
    !areAtlasMediaPathsPaired(
      parsed.data.pathname,
      parsed.data.thumbnailPathname,
      parsed.data.entryId,
    ) ||
    getAtlasMediaPathId(parsed.data.pathname) !== parsed.data.mediaId
  ) {
    return { ok: false, error: 'invalid', message: 'Invalid photo.' };
  }

  const mediaInput = parsed.data;
  const expectedThumbnailContentType = getAtlasThumbnailContentType(
    mediaInput.thumbnailPathname,
  );
  if (!expectedThumbnailContentType) {
    return { ok: false, error: 'invalid', message: 'Invalid photo.' };
  }
  try {
    const expected = await sql<{
      prepared_byte_size: number | null;
      thumbnail_byte_size: number | null;
      registered: boolean;
    }>`
      SELECT
        item.prepared_byte_size,
        item.thumbnail_byte_size,
        EXISTS (
          SELECT 1
          FROM atlas_media AS media
          WHERE media.id = ${mediaInput.mediaId}
            AND media.entry_id = item.entry_id
            AND media.user_id = item.user_id
            AND media.storage_path = ${mediaInput.pathname}
            AND media.thumbnail_path = ${mediaInput.thumbnailPathname}
        ) AS registered
      FROM atlas_import_items AS item
      INNER JOIN atlas_import_batches AS batch
        ON batch.id = item.batch_id AND batch.user_id = item.user_id
      INNER JOIN atlas_entries AS entry
        ON entry.id = item.entry_id AND entry.user_id = item.user_id
      WHERE item.entry_id = ${mediaInput.entryId}
        AND item.expected_media_id = ${mediaInput.mediaId}
        AND item.user_id = ${session.user.id}
        AND entry.deleted_at IS NULL
        AND batch.status IN ('uploading', 'ready', 'completed')
      LIMIT 1
    `;
    const row = expected.rows[0];
    if (!row) {
      return {
        ok: false,
        error: 'not-found',
        message: 'That import is unavailable.',
      };
    }
    if (row.registered) {
      return {
        ok: true,
        data: {
          originalCommitted: true,
          thumbnailCommitted: true,
          registered: true,
        },
      };
    }
    if (!row.prepared_byte_size || !row.thumbnail_byte_size) {
      return {
        ok: true,
        data: {
          originalCommitted: false,
          thumbnailCommitted: false,
          registered: false,
        },
      };
    }

    const token = getAtlasBlobToken();
    const [originalCommitted, thumbnailCommitted] = await Promise.all([
      importedBlobCommitted({
        pathname: mediaInput.pathname,
        expectedContentType: 'image/jpeg',
        expectedSize: row.prepared_byte_size,
        token,
      }),
      importedBlobCommitted({
        pathname: mediaInput.thumbnailPathname,
        expectedContentType: expectedThumbnailContentType,
        expectedSize: row.thumbnail_byte_size,
        token,
      }),
    ]);
    return {
      ok: true,
      data: { originalCommitted, thumbnailCommitted, registered: false },
    };
  } catch (error) {
    console.error('Atlas import media recovery probe failed:', error);
    return failed('The private upload status could not be checked. Try again.');
  }
}

export async function getAtlasEntryMediaAction(
  entryId: string,
): Promise<AtlasActionResult<AtlasMedia[]>> {
  const session = await requireVerifiedSession();
  const parsed = atlasEntryIdSchema.safeParse(entryId);
  if (!parsed.success) {
    return { ok: false, error: 'invalid', message: 'Invalid memory.' };
  }

  try {
    const media = await sql<AtlasMediaRow>`
      SELECT
        media.id,
        media.entry_id,
        media.storage_path,
        media.thumbnail_path,
        media.mime_type,
        media.width,
        media.height,
        media.byte_size,
        media.alt_text,
        media.sort_order,
        media.created_at
      FROM atlas_media AS media
      INNER JOIN atlas_entries AS entry ON entry.id = media.entry_id
      WHERE media.entry_id = ${parsed.data}
        AND media.user_id = ${session.user.id}
        AND entry.user_id = ${session.user.id}
        AND entry.deleted_at IS NULL
      ORDER BY media.sort_order, media.created_at
    `;

    return {
      ok: true,
      data: media.rows.map((row) => toAtlasMedia(row, session.user.id)),
    };
  } catch (error) {
    console.error('Atlas media lookup failed:', error);
    return failed('The photographs could not be opened. Please try again.');
  }
}

export async function registerAtlasMediaAction(
  input: AtlasMediaRegistrationInput,
): Promise<AtlasActionResult<AtlasMedia>> {
  const session = await requireVerifiedSession();
  const parsed = atlasMediaRegistrationSchema.safeParse(input);

  if (
    !parsed.success ||
    !areAtlasMediaPathsPaired(
      parsed.data.pathname,
      parsed.data.thumbnailPathname,
      parsed.data.entryId,
    ) ||
    getAtlasMediaPathId(parsed.data.pathname) !== parsed.data.mediaId
  ) {
    return { ok: false, error: 'invalid', message: 'Invalid photo.' };
  }

  const mediaInput = parsed.data;
  const token = getAtlasBlobToken();

  try {
    // Reject foreign or fabricated Blob paths before making storage requests.
    // The transaction below repeats and locks these checks to close races.
    const preflight = await sql<ImportMediaPreflight>`
      SELECT
        entry.id,
        import_item.id AS import_item_id,
        import_item.batch_id AS import_batch_id,
        import_batch.status AS import_batch_status,
        import_item.expected_media_id,
        import_item.source_hash,
        import_item.source_width,
        import_item.source_height,
        import_item.media_width,
        import_item.media_height,
        import_item.prepared_byte_size,
        import_item.thumbnail_byte_size AS expected_thumbnail_byte_size,
        EXISTS (
          SELECT 1
          FROM atlas_media AS registered_media
          WHERE registered_media.id = ${mediaInput.mediaId}
            AND registered_media.user_id = ${session.user.id}
            AND registered_media.entry_id = ${mediaInput.entryId}
            AND registered_media.storage_path = ${mediaInput.pathname}
            AND registered_media.thumbnail_path = ${mediaInput.thumbnailPathname}
        ) AS already_registered
      FROM atlas_entries AS entry
      LEFT JOIN atlas_import_items AS import_item
        ON import_item.entry_id = entry.id
        AND import_item.user_id = entry.user_id
      LEFT JOIN atlas_import_batches AS import_batch
        ON import_batch.id = import_item.batch_id
        AND import_batch.user_id = import_item.user_id
      WHERE entry.id = ${mediaInput.entryId}
        AND entry.user_id = ${session.user.id}
        AND entry.deleted_at IS NULL
        AND (
          import_item.id IS NULL
          OR (
            import_item.expected_media_id = ${mediaInput.mediaId}
            AND import_batch.status IN ('uploading', 'ready', 'completed')
          )
        )
        AND (
          EXISTS (
            SELECT 1
            FROM atlas_media_upload_intents AS intent
            WHERE intent.media_id = ${mediaInput.mediaId}
              AND intent.user_id = ${session.user.id}
              AND intent.entry_id = ${mediaInput.entryId}
              AND intent.original_path = ${mediaInput.pathname}
              AND intent.thumbnail_path = ${mediaInput.thumbnailPathname}
              AND intent.consumed_at IS NULL
              AND intent.cleanup_started_at IS NULL
          )
          OR EXISTS (
            SELECT 1
            FROM atlas_media AS media
            WHERE media.id = ${mediaInput.mediaId}
              AND media.user_id = ${session.user.id}
              AND media.entry_id = ${mediaInput.entryId}
              AND media.storage_path = ${mediaInput.pathname}
              AND media.thumbnail_path = ${mediaInput.thumbnailPathname}
          )
        )
      LIMIT 1
    `;
    const preflightRow = preflight.rows[0];
    if (!preflightRow) {
      return { ok: false, error: 'invalid', message: 'Invalid photo.' };
    }

    const [blob, thumbnail] = await Promise.all([
      head(mediaInput.pathname, { token }),
      head(mediaInput.thumbnailPathname, { token }),
    ]);
    const expectedThumbnailContentType = getAtlasThumbnailContentType(
      mediaInput.thumbnailPathname,
    );
    if (
      blob.pathname !== mediaInput.pathname ||
      !isAllowedAtlasMediaType(blob.contentType) ||
      blob.size <= 0 ||
      blob.size > ATLAS_MEDIA_MAX_BYTES ||
      thumbnail.pathname !== mediaInput.thumbnailPathname ||
      !expectedThumbnailContentType ||
      thumbnail.contentType !== expectedThumbnailContentType ||
      thumbnail.size <= 0 ||
      thumbnail.size > ATLAS_THUMBNAIL_MAX_BYTES
    ) {
      return { ok: false, error: 'invalid', message: 'Invalid photo.' };
    }
    if (
      preflightRow.import_item_id &&
      !preflightRow.already_registered &&
      (blob.contentType !== 'image/jpeg' ||
        !(await validateImportedMedia({
          pathname: mediaInput.pathname,
          thumbnailPathname: mediaInput.thumbnailPathname,
          width: mediaInput.width,
          height: mediaInput.height,
          blobSize: blob.size,
          thumbnailSize: thumbnail.size,
          expected: preflightRow,
          token,
        })))
    ) {
      return {
        ok: false,
        error: 'invalid',
        message: 'The imported photograph could not be verified.',
      };
    }

    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const importAssociation = await client.query<{ batch_id: string }>(
        `
          SELECT batch_id
          FROM atlas_import_items
          WHERE entry_id = $1 AND user_id = $2
          LIMIT 1
        `,
        [mediaInput.entryId, session.user.id],
      );
      const importBatchId = importAssociation.rows[0]?.batch_id ?? null;
      let importBatchStatus: string | null = null;
      let importItem: {
        id: string;
        batch_id: string;
        status: 'pending' | 'uploaded';
        expected_media_id: string;
        source_hash: string;
      } | null = null;

      if (importBatchId) {
        const importBatch = await client.query<{ status: string }>(
          `
            SELECT status
            FROM atlas_import_batches
            WHERE id = $1 AND user_id = $2
            LIMIT 1
            FOR UPDATE
          `,
          [importBatchId, session.user.id],
        );
        importBatchStatus = importBatch.rows[0]?.status ?? null;
        if (
          !importBatchStatus ||
          !['uploading', 'ready', 'completed'].includes(importBatchStatus)
        ) {
          await client.query('ROLLBACK');
          return { ok: false, error: 'invalid', message: 'Invalid photo.' };
        }

        const importItemResult = await client.query<{
          id: string;
          batch_id: string;
          status: 'pending' | 'uploaded';
          expected_media_id: string;
          source_hash: string;
        }>(
          `
            SELECT
              id,
              batch_id,
              status,
              expected_media_id,
              source_hash
            FROM atlas_import_items
            WHERE batch_id = $1
              AND entry_id = $2
              AND user_id = $3
              AND expected_media_id = $4
              AND source_width IS NOT NULL
              AND source_height IS NOT NULL
              AND media_width = $5
              AND media_height = $6
              AND prepared_byte_size = $7
              AND thumbnail_byte_size = $8
            LIMIT 1
            FOR UPDATE
          `,
          [
            importBatchId,
            mediaInput.entryId,
            session.user.id,
            mediaInput.mediaId,
            mediaInput.width,
            mediaInput.height,
            blob.size,
            thumbnail.size,
          ],
        );
        importItem = importItemResult.rows[0] ?? null;
        if (!importItem) {
          await client.query('ROLLBACK');
          return { ok: false, error: 'invalid', message: 'Invalid photo.' };
        }
      }

      const entry = await client.query<{
        title: string;
        place_label: string | null;
      }>(
        `
          SELECT title, place_label
          FROM atlas_entries
          WHERE id = $1
            AND user_id = $2
            AND deleted_at IS NULL
          FOR UPDATE
        `,
        [mediaInput.entryId, session.user.id],
      );

      if (!entry.rows[0]) {
        await client.query('ROLLBACK');
        return {
          ok: false,
          error: 'not-found',
          message: 'That memory no longer exists.',
        };
      }

      const existing = await client.query<AtlasMediaRow>(
        `
          SELECT
            id, entry_id, storage_path, thumbnail_path, mime_type, width,
            height, byte_size, alt_text, sort_order, created_at
          FROM atlas_media
          WHERE id = $1
            AND storage_path = $2
            AND thumbnail_path = $3
            AND entry_id = $4
            AND user_id = $5
          LIMIT 1
        `,
        [
          mediaInput.mediaId,
          mediaInput.pathname,
          mediaInput.thumbnailPathname,
          mediaInput.entryId,
          session.user.id,
        ],
      );

      if (existing.rows[0]) {
        if (importItem && importItem.status !== 'uploaded') {
          await client.query('ROLLBACK');
          return {
            ok: false,
            error: 'conflict',
            message: 'Retry this import.',
          };
        }
        await client.query('COMMIT');
        return {
          ok: true,
          data: toAtlasMedia(existing.rows[0], session.user.id),
        };
      }
      if (importItem && importBatchStatus !== 'uploading') {
        await client.query('ROLLBACK');
        return { ok: false, error: 'invalid', message: 'Invalid photo.' };
      }

      const uploadIntent = {
        userId: session.user.id,
        entryId: mediaInput.entryId,
        mediaId: mediaInput.mediaId,
        pathname: mediaInput.pathname,
        thumbnailPathname: mediaInput.thumbnailPathname,
      };
      const hasUploadIntent = await lockAtlasMediaUploadIntentForRegistration(
        client,
        uploadIntent,
      );
      if (!hasUploadIntent) {
        await client.query('ROLLBACK');
        return { ok: false, error: 'invalid', message: 'Invalid photo.' };
      }

      const count = await client.query<{ count: number | string }>(
        'SELECT COUNT(*)::int AS count FROM atlas_media WHERE entry_id = $1',
        [mediaInput.entryId],
      );
      const sortOrder = Number(count.rows[0]?.count ?? 0);

      if (sortOrder >= ATLAS_MEDIA_MAX_FILES) {
        await client.query('ROLLBACK');
        return {
          ok: false,
          error: 'invalid',
          message: `A memory can hold up to ${ATLAS_MEDIA_MAX_FILES} photos.`,
        };
      }

      const fallbackAlt =
        entry.rows[0].title.trim() ||
        entry.rows[0].place_label?.trim() ||
        'Atlas memory';
      const inserted = await client.query<AtlasMediaRow>(
        `
          INSERT INTO atlas_media (
            id,
            entry_id,
            user_id,
            storage_path,
            thumbnail_path,
            mime_type,
            width,
            height,
            byte_size,
            thumbnail_byte_size,
            source_hash,
            alt_text,
            sort_order
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
          )
          RETURNING
            id, entry_id, storage_path, thumbnail_path, mime_type, width,
            height, byte_size, alt_text, sort_order, created_at
        `,
        [
          mediaInput.mediaId,
          mediaInput.entryId,
          session.user.id,
          mediaInput.pathname,
          mediaInput.thumbnailPathname,
          blob.contentType,
          mediaInput.width,
          mediaInput.height,
          blob.size,
          thumbnail.size,
          importItem?.source_hash ?? null,
          mediaInput.altText || fallbackAlt,
          sortOrder,
        ],
      );
      const insertedRow = inserted.rows[0];
      if (!insertedRow) throw new Error('Media insert returned no row.');
      const consumed = await consumeAtlasMediaUploadIntent(
        client,
        uploadIntent,
      );
      if (!consumed) {
        await client.query('ROLLBACK');
        return { ok: false, error: 'invalid', message: 'Invalid photo.' };
      }
      if (importItem) {
        const uploadedItem = await client.query<{ id: string }>(
          `
            UPDATE atlas_import_items
            SET status = 'uploaded', uploaded_at = NOW(), updated_at = NOW()
            WHERE id = $1
              AND batch_id = $2
              AND user_id = $3
              AND expected_media_id = $4
              AND status = 'pending'
            RETURNING id
          `,
          [
            importItem.id,
            importItem.batch_id,
            session.user.id,
            mediaInput.mediaId,
          ],
        );
        if (!uploadedItem.rows[0]) {
          await client.query('ROLLBACK');
          return {
            ok: false,
            error: 'conflict',
            message: 'Retry this import.',
          };
        }
        await client.query(
          `
            UPDATE atlas_import_batches AS batch
            SET status = 'ready', updated_at = NOW()
            WHERE batch.id = $1
              AND batch.user_id = $2
              AND batch.status = 'uploading'
              AND NOT EXISTS (
                SELECT 1
                FROM atlas_import_items AS pending
                WHERE pending.batch_id = batch.id
                  AND pending.user_id = batch.user_id
                  AND pending.status <> 'uploaded'
              )
          `,
          [importItem.batch_id, session.user.id],
        );
      }
      await client.query('COMMIT');

      revalidatePath('/dashboard');
      revalidatePath('/dashboard/places');
      revalidatePath(`/dashboard/card/${mediaInput.entryId}`);
      return {
        ok: true,
        data: toAtlasMedia(insertedRow, session.user.id),
      };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Atlas media registration failed:', error);
    return failed();
  }
}

export async function discardAtlasMediaUploadAction(
  input: AtlasMediaDiscardInput,
): Promise<AtlasActionResult<{ discarded: true }>> {
  const session = await requireVerifiedSession();
  const parsed = atlasMediaDiscardSchema.safeParse(input);
  if (
    !parsed.success ||
    !areAtlasMediaPathsPaired(
      parsed.data.pathname,
      parsed.data.thumbnailPathname,
      parsed.data.entryId,
    ) ||
    getAtlasMediaPathId(parsed.data.pathname) !== parsed.data.mediaId
  ) {
    return { ok: false, error: 'invalid', message: 'Invalid photo.' };
  }

  const mediaInput = parsed.data;
  try {
    const ownership = await sql<{ id: string }>`
      SELECT id
      FROM atlas_entries
      WHERE id = ${mediaInput.entryId}
        AND user_id = ${session.user.id}
        AND deleted_at IS NULL
      LIMIT 1
    `;
    if (!ownership.rows[0]) {
      return {
        ok: false,
        error: 'not-found',
        message: 'That memory no longer exists.',
      };
    }

    const registered = await sql<{ id: string }>`
      SELECT id
      FROM atlas_media
      WHERE user_id = ${session.user.id}
        AND id = ${mediaInput.mediaId}
        AND storage_path = ${mediaInput.pathname}
        AND thumbnail_path = ${mediaInput.thumbnailPathname}
      LIMIT 1
    `;

    if (!registered.rows[0]) {
      await discardAtlasMediaUploadIntent({
        userId: session.user.id,
        entryId: mediaInput.entryId,
        mediaId: mediaInput.mediaId,
        pathname: mediaInput.pathname,
        thumbnailPathname: mediaInput.thumbnailPathname,
      });
    }

    return { ok: true, data: { discarded: true } };
  } catch (error) {
    console.error('Atlas media upload cleanup failed:', error);
    return failed('The incomplete upload could not be cleaned up.');
  }
}

export async function deleteAtlasMediaAction(
  mediaId: string,
): Promise<AtlasActionResult<{ id: string; entryId: string }>> {
  const session = await requireVerifiedSession();
  const parsed = atlasEntryIdSchema.safeParse(mediaId);
  if (!parsed.success) {
    return { ok: false, error: 'invalid', message: 'Invalid photo.' };
  }

  try {
    const media = await sql<{
      id: string;
      entry_id: string;
      storage_path: string;
      thumbnail_path: string | null;
    }>`
      SELECT
        media.id,
        media.entry_id,
        media.storage_path,
        media.thumbnail_path
      FROM atlas_media AS media
      INNER JOIN atlas_entries AS entry ON entry.id = media.entry_id
      WHERE media.id = ${parsed.data}
        AND media.user_id = ${session.user.id}
        AND entry.user_id = ${session.user.id}
        AND entry.deleted_at IS NULL
      LIMIT 1
    `;

    const row = media.rows[0];
    if (!row) {
      return {
        ok: false,
        error: 'not-found',
        message: 'That photo no longer exists.',
      };
    }

    await del(
      [row.storage_path, row.thumbnail_path].filter(
        (pathname): pathname is string => Boolean(pathname),
      ),
      { token: getAtlasBlobToken() },
    );
    const removed = await sql<{ id: string }>`
      DELETE FROM atlas_media
      WHERE id = ${row.id}
        AND user_id = ${session.user.id}
      RETURNING id
    `;

    if (!removed.rows[0]) return failed();

    revalidatePath('/dashboard');
    revalidatePath('/dashboard/places');
    revalidatePath(`/dashboard/card/${row.entry_id}`);
    return { ok: true, data: { id: row.id, entryId: row.entry_id } };
  } catch (error) {
    console.error('Atlas media deletion failed:', error);
    return failed('The photo could not be removed. Please try again.');
  }
}
