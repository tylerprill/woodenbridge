'use server';

import { del, head } from '@vercel/blob';
import { db, sql } from '@vercel/postgres';
import { revalidatePath } from 'next/cache';

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
  ATLAS_THUMBNAIL_MIME_TYPE,
  areAtlasMediaPathsPaired,
  atlasMediaDiscardSchema,
  atlasMediaRegistrationSchema,
  isAllowedAtlasMediaType,
} from '@/app/lib/atlas/media-policy';
import { getAtlasBlobToken } from '@/app/lib/atlas/media-storage';
import { type AtlasMediaRow, toAtlasMedia } from '@/app/lib/atlas/rows';
import { atlasEntryIdSchema } from '@/app/lib/atlas/validation';

function failed(message = 'The photo could not be saved. Please try again.') {
  return { ok: false, error: 'failed', message } as const;
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

    return { ok: true, data: media.rows.map((row) => toAtlasMedia(row)) };
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
    )
  ) {
    return { ok: false, error: 'invalid', message: 'Invalid photo.' };
  }

  const mediaInput = parsed.data;
  const token = getAtlasBlobToken();

  try {
    const [blob, thumbnail] = await Promise.all([
      head(mediaInput.pathname, { token }),
      head(mediaInput.thumbnailPathname, { token }),
    ]);
    if (
      blob.pathname !== mediaInput.pathname ||
      !isAllowedAtlasMediaType(blob.contentType) ||
      blob.size <= 0 ||
      blob.size > ATLAS_MEDIA_MAX_BYTES ||
      thumbnail.pathname !== mediaInput.thumbnailPathname ||
      thumbnail.contentType !== ATLAS_THUMBNAIL_MIME_TYPE ||
      thumbnail.size <= 0 ||
      thumbnail.size > ATLAS_THUMBNAIL_MAX_BYTES
    ) {
      return { ok: false, error: 'invalid', message: 'Invalid photo.' };
    }

    const client = await db.connect();
    try {
      await client.query('BEGIN');
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
            id, entry_id, thumbnail_path, mime_type, width, height, byte_size,
            alt_text, sort_order, created_at
          FROM atlas_media
          WHERE storage_path = $1
            AND entry_id = $2
            AND user_id = $3
          LIMIT 1
        `,
        [mediaInput.pathname, mediaInput.entryId, session.user.id],
      );

      if (existing.rows[0]) {
        await client.query('COMMIT');
        return { ok: true, data: toAtlasMedia(existing.rows[0]) };
      }

      const count = await client.query<{ count: number | string }>(
        'SELECT COUNT(*)::int AS count FROM atlas_media WHERE entry_id = $1',
        [mediaInput.entryId],
      );
      const sortOrder = Number(count.rows[0]?.count ?? 0);

      if (sortOrder >= ATLAS_MEDIA_MAX_FILES) {
        await client.query('ROLLBACK');
        await del([mediaInput.pathname, mediaInput.thumbnailPathname], {
          token,
        }).catch(() => undefined);
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
            entry_id,
            user_id,
            storage_path,
            thumbnail_path,
            mime_type,
            width,
            height,
            byte_size,
            alt_text,
            sort_order
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING
            id, entry_id, thumbnail_path, mime_type, width, height, byte_size,
            alt_text, sort_order, created_at
        `,
        [
          mediaInput.entryId,
          session.user.id,
          mediaInput.pathname,
          mediaInput.thumbnailPathname,
          blob.contentType,
          mediaInput.width,
          mediaInput.height,
          blob.size,
          mediaInput.altText || fallbackAlt,
          sortOrder,
        ],
      );
      await client.query('COMMIT');

      revalidatePath('/dashboard');
      revalidatePath('/dashboard/places');
      revalidatePath(`/dashboard/card/${mediaInput.entryId}`);
      return { ok: true, data: toAtlasMedia(inserted.rows[0]) };
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
    )
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
        AND (
          storage_path = ${mediaInput.pathname}
          OR thumbnail_path = ${mediaInput.thumbnailPathname}
        )
      LIMIT 1
    `;

    if (!registered.rows[0]) {
      await del([mediaInput.pathname, mediaInput.thumbnailPathname], {
        token: getAtlasBlobToken(),
      }).catch(() => undefined);
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
