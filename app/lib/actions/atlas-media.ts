'use server';

import { del, head } from '@vercel/blob';
import { db, sql } from '@vercel/postgres';
import { revalidatePath } from 'next/cache';

import { requireVerifiedSession } from '@/app/lib/auth/session';
import type {
  AtlasActionResult,
  AtlasMedia,
  AtlasMediaRegistrationInput,
} from '@/app/lib/atlas/definitions';
import {
  ATLAS_MEDIA_MAX_BYTES,
  ATLAS_MEDIA_MAX_FILES,
  atlasMediaRegistrationSchema,
  isAllowedAtlasMediaType,
  isAtlasMediaPath,
} from '@/app/lib/atlas/media-policy';
import { getAtlasBlobToken } from '@/app/lib/atlas/media-storage';
import { type AtlasMediaRow, toAtlasMedia } from '@/app/lib/atlas/rows';
import { atlasEntryIdSchema } from '@/app/lib/atlas/validation';

function failed(message = 'The photo could not be saved. Please try again.') {
  return { ok: false, error: 'failed', message } as const;
}

export async function registerAtlasMediaAction(
  input: AtlasMediaRegistrationInput,
): Promise<AtlasActionResult<AtlasMedia>> {
  const session = await requireVerifiedSession();
  const parsed = atlasMediaRegistrationSchema.safeParse(input);

  if (
    !parsed.success ||
    !isAtlasMediaPath(parsed.data.pathname, parsed.data.entryId)
  ) {
    return { ok: false, error: 'invalid', message: 'Invalid photo.' };
  }

  const mediaInput = parsed.data;
  const token = getAtlasBlobToken();

  try {
    const blob = await head(mediaInput.pathname, { token });
    if (
      blob.pathname !== mediaInput.pathname ||
      !isAllowedAtlasMediaType(blob.contentType) ||
      blob.size <= 0 ||
      blob.size > ATLAS_MEDIA_MAX_BYTES
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
            id, entry_id, mime_type, width, height, byte_size,
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
        await del(mediaInput.pathname, { token }).catch(() => undefined);
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
            mime_type,
            width,
            height,
            byte_size,
            alt_text,
            sort_order
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING
            id, entry_id, mime_type, width, height, byte_size,
            alt_text, sort_order, created_at
        `,
        [
          mediaInput.entryId,
          session.user.id,
          mediaInput.pathname,
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
      revalidatePath('/dashboard/users');
      revalidatePath('/dashboard/journal');
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
    }>`
      SELECT media.id, media.entry_id, media.storage_path
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

    await del(row.storage_path, { token: getAtlasBlobToken() });
    const removed = await sql<{ id: string }>`
      DELETE FROM atlas_media
      WHERE id = ${row.id}
        AND user_id = ${session.user.id}
      RETURNING id
    `;

    if (!removed.rows[0]) return failed();

    revalidatePath('/dashboard');
    revalidatePath('/dashboard/users');
    revalidatePath('/dashboard/journal');
    return { ok: true, data: { id: row.id, entryId: row.entry_id } };
  } catch (error) {
    console.error('Atlas media deletion failed:', error);
    return failed('The photo could not be removed. Please try again.');
  }
}
