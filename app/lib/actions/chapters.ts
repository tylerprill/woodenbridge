'use server';

import { db, type VercelPoolClient } from '@vercel/postgres';
import { revalidatePath } from 'next/cache';

import { requireVerifiedSession } from '@/app/lib/auth/session';
import type {
  AtlasChapterInput,
  AtlasChapterUpdateInput,
  ChapterActionResult,
} from '@/app/lib/chapters/definitions';
import {
  atlasChapterIdSchema,
  atlasChapterInputSchema,
  atlasChapterUpdateSchema,
} from '@/app/lib/chapters/validation';

type ChapterMutationData = { id: string; version: number };

function failed(message = 'We could not save that chapter. Please try again.') {
  return { ok: false, error: 'failed', message } as const;
}

async function ownsEveryEntry(
  client: VercelPoolClient,
  userId: string,
  entryIds: string[],
) {
  const result = await client.query<{ id: string }>(
    `
      SELECT id
      FROM atlas_entries
      WHERE user_id = $1
        AND id = ANY($2::uuid[])
        AND record_state = 'saved'
        AND deleted_at IS NULL
      FOR SHARE
    `,
    [userId, entryIds],
  );
  return result.rows.length === entryIds.length;
}

async function replaceChapterEntries(
  client: VercelPoolClient,
  chapterId: string,
  userId: string,
  entryIds: string[],
) {
  await client.query(
    'DELETE FROM atlas_chapter_entries WHERE chapter_id = $1',
    [chapterId],
  );
  await client.query(
    `
      INSERT INTO atlas_chapter_entries (chapter_id, entry_id, user_id, position)
      SELECT $1, entry_id, $2, (ordinality - 1)::smallint
      FROM unnest($3::uuid[]) WITH ORDINALITY AS selected(entry_id, ordinality)
    `,
    [chapterId, userId, entryIds],
  );
}

function revalidateChapter(chapterId: string) {
  revalidatePath('/dashboard/chapters');
  revalidatePath(`/dashboard/chapters/${chapterId}`);
  revalidatePath(`/dashboard/chapters/${chapterId}/edit`);
}

export async function createAtlasChapterAction(
  input: AtlasChapterInput,
): Promise<ChapterActionResult<ChapterMutationData>> {
  const session = await requireVerifiedSession();
  const parsed = atlasChapterInputSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid',
      message: parsed.error.issues[0]?.message ?? 'Check the chapter and try again.',
    };
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    if (!(await ownsEveryEntry(client, session.user.id, parsed.data.entryIds))) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        error: 'invalid',
        message: 'One of those memories is no longer available.',
      };
    }

    const inserted = await client.query<ChapterMutationData>(
      `
        INSERT INTO atlas_chapters (user_id, title, introduction)
        VALUES ($1, $2, $3)
        RETURNING id, version
      `,
      [session.user.id, parsed.data.title, parsed.data.introduction],
    );
    const chapter = inserted.rows[0];
    await replaceChapterEntries(
      client,
      chapter.id,
      session.user.id,
      parsed.data.entryIds,
    );
    await client.query('COMMIT');

    revalidateChapter(chapter.id);
    return { ok: true, data: chapter };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('Atlas chapter creation failed:', error);
    return failed();
  } finally {
    client.release();
  }
}

export async function updateAtlasChapterAction(
  input: AtlasChapterUpdateInput,
): Promise<ChapterActionResult<ChapterMutationData>> {
  const session = await requireVerifiedSession();
  const parsed = atlasChapterUpdateSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid',
      message: parsed.error.issues[0]?.message ?? 'Check the chapter and try again.',
    };
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query<{ version: number }>(
      `
        SELECT version
        FROM atlas_chapters
        WHERE id = $1 AND user_id = $2
        FOR UPDATE
      `,
      [parsed.data.id, session.user.id],
    );

    if (!current.rows[0]) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        error: 'not-found',
        message: 'That chapter no longer exists.',
      };
    }

    if (current.rows[0].version !== parsed.data.version) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        error: 'conflict',
        message: 'This chapter changed elsewhere. Refresh it and try again.',
      };
    }

    if (!(await ownsEveryEntry(client, session.user.id, parsed.data.entryIds))) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        error: 'invalid',
        message: 'One of those memories is no longer available.',
      };
    }

    const updated = await client.query<ChapterMutationData>(
      `
        UPDATE atlas_chapters
        SET
          title = $1,
          introduction = $2,
          version = version + 1,
          updated_at = NOW()
        WHERE id = $3 AND user_id = $4
        RETURNING id, version
      `,
      [
        parsed.data.title,
        parsed.data.introduction,
        parsed.data.id,
        session.user.id,
      ],
    );
    await replaceChapterEntries(
      client,
      parsed.data.id,
      session.user.id,
      parsed.data.entryIds,
    );
    await client.query('COMMIT');

    revalidateChapter(parsed.data.id);
    return { ok: true, data: updated.rows[0] };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('Atlas chapter update failed:', error);
    return failed();
  } finally {
    client.release();
  }
}

export async function deleteAtlasChapterAction(
  chapterId: string,
): Promise<ChapterActionResult<{ id: string }>> {
  const session = await requireVerifiedSession();
  const parsed = atlasChapterIdSchema.safeParse(chapterId);

  if (!parsed.success) {
    return { ok: false, error: 'invalid', message: 'Invalid chapter.' };
  }

  try {
    const client = await db.connect();
    try {
      const deleted = await client.query<{ id: string }>(
        `
          DELETE FROM atlas_chapters
          WHERE id = $1 AND user_id = $2
          RETURNING id
        `,
        [parsed.data, session.user.id],
      );

      if (!deleted.rows[0]) {
        return {
          ok: false,
          error: 'not-found',
          message: 'That chapter no longer exists.',
        };
      }

      revalidateChapter(parsed.data);
      return { ok: true, data: deleted.rows[0] };
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Atlas chapter deletion failed:', error);
    return failed('We could not delete that chapter. Please try again.');
  }
}
