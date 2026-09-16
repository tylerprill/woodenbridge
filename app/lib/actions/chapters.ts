'use server';

import { createHash } from 'node:crypto';
import { db, type VercelPoolClient } from '@/app/lib/db';
import { revalidatePath } from 'next/cache';

import { requireVerifiedSession } from '@/app/lib/auth/session';
import type {
  AtlasChapterDeleteInput,
  AtlasChapterInput,
  AtlasChapterMemoryInput,
  AtlasChapterUpdateInput,
  ChapterActionResult,
} from '@/app/lib/chapters/definitions';
import {
  atlasChapterDeleteSchema,
  atlasChapterInputSchema,
  atlasChapterUpdateSchema,
} from '@/app/lib/chapters/validation';
import { loadAtlasJourneySuggestions } from '@/app/lib/atlas/journeys/data';
import type { AtlasJourneySuggestion } from '@/app/lib/atlas/journeys/definitions';

type ChapterMutationData = { id: string; version: number; shareId: string };

type IdempotentChapterRow = ChapterMutationData & {
  clientRequestFingerprint: string;
};

type ValidatedJourneySuggestion = Pick<
  AtlasJourneySuggestion,
  'algorithmVersion' | 'key' | 'source'
>;

function failed(message = 'We could not save that journey. Please try again.') {
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
  memories: AtlasChapterMemoryInput[],
) {
  await client.query(
    'DELETE FROM atlas_chapter_entries WHERE chapter_id = $1',
    [chapterId],
  );
  await client.query(
    `
      INSERT INTO atlas_chapter_entries (
        chapter_id,
        entry_id,
        user_id,
        position,
        transition_note
      )
      SELECT
        $1,
        selected.entry_id,
        $2,
        (selected.ordinality - 1)::smallint,
        selected.transition_note
      FROM unnest($3::uuid[], $4::text[])
        WITH ORDINALITY AS selected(entry_id, transition_note, ordinality)
    `,
    [
      chapterId,
      userId,
      memories.map((memory) => memory.entryId),
      memories.map((memory) => memory.transitionNote),
    ],
  );
}

async function ownsCoverMedia(
  client: VercelPoolClient,
  userId: string,
  coverMediaId: string | null,
  entryIds: string[],
) {
  if (!coverMediaId) return true;
  const result = await client.query(
    `
      SELECT 1
      FROM atlas_media
      WHERE id = $1
        AND user_id = $2
        AND entry_id = ANY($3::uuid[])
      LIMIT 1
    `,
    [coverMediaId, userId, entryIds],
  );
  return Boolean(result.rows[0]);
}

function revalidateChapter(
  chapterId: string,
  ...shareIds: Array<string | null | undefined>
) {
  revalidatePath('/dashboard');
  revalidatePath('/dashboard/chapters');
  revalidatePath(`/dashboard/chapters/${chapterId}`);
  revalidatePath(`/dashboard/chapters/${chapterId}/edit`);
  for (const shareId of Array.from(
    new Set(shareIds.filter((id): id is string => Boolean(id))),
  )) {
    revalidatePath(`/shared/chapters/${shareId}`);
  }
}

function chapterCreateFingerprint(input: AtlasChapterInput) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        title: input.title,
        introduction: input.introduction,
        memories: input.memories,
        coverMediaId: input.coverMediaId,
        visibility: input.visibility,
        shareMap: input.shareMap,
        shareLocationPrecision: input.shareLocationPrecision,
        ...(input.journeySuggestion
          ? { journeySuggestion: input.journeySuggestion }
          : {}),
      }),
    )
    .digest('hex');
}

async function recordAcceptedJourneySuggestion(
  client: VercelPoolClient,
  userId: string,
  chapterId: string,
  suggestion: ValidatedJourneySuggestion,
) {
  await client.query(
    `
      INSERT INTO atlas_journey_suggestion_feedback (
        user_id,
        suggestion_key,
        algorithm_version,
        source,
        decision,
        chapter_id,
        decided_at
      )
      VALUES ($1, $2, $3, $4, 'accepted', $5, NOW())
      ON CONFLICT (user_id, suggestion_key) DO UPDATE
      SET
        algorithm_version = EXCLUDED.algorithm_version,
        source = EXCLUDED.source,
        decision = 'accepted',
        chapter_id = EXCLUDED.chapter_id,
        decided_at = NOW()
    `,
    [
      userId,
      suggestion.key,
      suggestion.algorithmVersion,
      suggestion.source,
      chapterId,
    ],
  );
}

function hasExactJourneyMembership(
  suggestedEntryIds: string[],
  chapterEntryIds: string[],
) {
  if (suggestedEntryIds.length !== chapterEntryIds.length) return false;
  const suggestedEntries = new Set(suggestedEntryIds);
  return (
    suggestedEntries.size === suggestedEntryIds.length &&
    chapterEntryIds.every((entryId) => suggestedEntries.has(entryId))
  );
}

async function validateJourneySuggestionAcceptance(
  userId: string,
  suggestion: NonNullable<AtlasChapterInput['journeySuggestion']>,
  chapterEntryIds: string[],
): Promise<ValidatedJourneySuggestion | null> {
  try {
    const currentSuggestions = await loadAtlasJourneySuggestions(userId, {
      applyFeedback: false,
    });
    const currentSuggestion = currentSuggestions.find(
      (candidate) =>
        candidate.key === suggestion.key &&
        candidate.source === suggestion.source &&
        hasExactJourneyMembership(candidate.entryIds, chapterEntryIds),
    );
    return currentSuggestion
      ? {
          algorithmVersion: currentSuggestion.algorithmVersion,
          key: currentSuggestion.key,
          source: currentSuggestion.source,
        }
      : null;
  } catch (error) {
    console.error('Atlas journey suggestion validation failed:', error);
    return null;
  }
}

async function findIdempotentChapter(
  client: VercelPoolClient,
  userId: string,
  clientRequestId: string,
) {
  const existing = await client.query<IdempotentChapterRow>(
    `
      SELECT
        id,
        version,
        share_id AS "shareId",
        client_request_fingerprint AS "clientRequestFingerprint"
      FROM atlas_chapters
      WHERE user_id = $1 AND client_request_id = $2
      FOR UPDATE
    `,
    [userId, clientRequestId],
  );
  return existing.rows[0] ?? null;
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
      message:
        parsed.error.issues[0]?.message ?? 'Check the journey and try again.',
    };
  }

  const entryIds = parsed.data.memories.map((memory) => memory.entryId);
  const validatedJourneySuggestion = parsed.data.journeySuggestion
    ? await validateJourneySuggestionAcceptance(
        session.user.id,
        parsed.data.journeySuggestion,
        entryIds,
      )
    : null;

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const clientRequestFingerprint = parsed.data.clientRequestId
      ? chapterCreateFingerprint(parsed.data)
      : null;
    if (parsed.data.clientRequestId && clientRequestFingerprint) {
      const existing = await findIdempotentChapter(
        client,
        session.user.id,
        parsed.data.clientRequestId,
      );
      if (existing) {
        if (
          existing.clientRequestFingerprint.trim() !== clientRequestFingerprint
        ) {
          await client.query('ROLLBACK');
          return {
            ok: false,
            error: 'conflict',
            message:
              'That save request was already used for a different journey. Refresh and try again.',
          };
        }
        await client.query('COMMIT');
        return {
          ok: true,
          data: {
            id: existing.id,
            version: existing.version,
            shareId: existing.shareId,
          },
        };
      }
    }

    if (!(await ownsEveryEntry(client, session.user.id, entryIds))) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        error: 'invalid',
        message: 'One of those memories is no longer available.',
      };
    }
    if (
      !(await ownsCoverMedia(
        client,
        session.user.id,
        parsed.data.coverMediaId,
        entryIds,
      ))
    ) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        error: 'invalid',
        message: 'Choose a cover from the memories in this journey.',
      };
    }

    const inserted = await client.query<ChapterMutationData>(
      `
        INSERT INTO atlas_chapters (
          user_id,
          title,
          introduction,
          cover_media_id,
          visibility,
          share_map,
          share_location_precision,
          client_request_id,
          client_request_fingerprint
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (user_id, client_request_id)
          WHERE client_request_id IS NOT NULL
          DO NOTHING
        RETURNING id, version, share_id AS "shareId"
      `,
      [
        session.user.id,
        parsed.data.title,
        parsed.data.introduction,
        parsed.data.coverMediaId,
        parsed.data.visibility,
        parsed.data.shareMap,
        parsed.data.shareLocationPrecision,
        parsed.data.clientRequestId ?? null,
        clientRequestFingerprint,
      ],
    );
    const chapter = inserted.rows[0];
    if (!chapter && parsed.data.clientRequestId && clientRequestFingerprint) {
      const existing = await findIdempotentChapter(
        client,
        session.user.id,
        parsed.data.clientRequestId,
      );
      if (
        !existing ||
        existing.clientRequestFingerprint.trim() !== clientRequestFingerprint
      ) {
        await client.query('ROLLBACK');
        return {
          ok: false,
          error: 'conflict',
          message:
            'That save request was already used for a different journey. Refresh and try again.',
        };
      }
      await client.query('COMMIT');
      return {
        ok: true,
        data: {
          id: existing.id,
          version: existing.version,
          shareId: existing.shareId,
        },
      };
    }
    if (!chapter) throw new Error('Chapter insert returned no row.');
    await replaceChapterEntries(
      client,
      chapter.id,
      session.user.id,
      parsed.data.memories,
    );
    if (validatedJourneySuggestion) {
      await recordAcceptedJourneySuggestion(
        client,
        session.user.id,
        chapter.id,
        validatedJourneySuggestion,
      );
    }
    await client.query('COMMIT');

    revalidateChapter(chapter.id, chapter.shareId);
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
      message:
        parsed.error.issues[0]?.message ?? 'Check the journey and try again.',
    };
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const current = await client.query<{
      version: number;
      visibility: 'private' | 'shared';
      share_id: string;
    }>(
      `
        SELECT version, visibility, share_id
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
        message: 'That journey no longer exists.',
      };
    }

    if (current.rows[0].version !== parsed.data.version) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        error: 'conflict',
        message: 'This journey changed elsewhere. Refresh it and try again.',
      };
    }

    const entryIds = parsed.data.memories.map((memory) => memory.entryId);
    if (!(await ownsEveryEntry(client, session.user.id, entryIds))) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        error: 'invalid',
        message: 'One of those memories is no longer available.',
      };
    }
    if (
      !(await ownsCoverMedia(
        client,
        session.user.id,
        parsed.data.coverMediaId,
        entryIds,
      ))
    ) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        error: 'invalid',
        message: 'Choose a cover from the memories in this journey.',
      };
    }

    const updated = await client.query<ChapterMutationData>(
      `
        UPDATE atlas_chapters
        SET
          title = $1,
          introduction = $2,
          cover_media_id = $3,
          visibility = $4::varchar,
          share_map = $5,
          share_location_precision = $6,
          share_id = CASE
            WHEN visibility = 'private' AND $4::varchar = 'shared' THEN gen_random_uuid()
            ELSE share_id
          END,
          version = version + 1,
          updated_at = NOW()
        WHERE id = $7 AND user_id = $8
        RETURNING id, version, share_id AS "shareId"
      `,
      [
        parsed.data.title,
        parsed.data.introduction,
        parsed.data.coverMediaId,
        parsed.data.visibility,
        parsed.data.shareMap,
        parsed.data.shareLocationPrecision,
        parsed.data.id,
        session.user.id,
      ],
    );
    await replaceChapterEntries(
      client,
      parsed.data.id,
      session.user.id,
      parsed.data.memories,
    );
    await client.query('COMMIT');

    revalidateChapter(
      parsed.data.id,
      current.rows[0].share_id,
      updated.rows[0].shareId,
    );
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
  input: AtlasChapterDeleteInput,
): Promise<ChapterActionResult<{ id: string }>> {
  const session = await requireVerifiedSession();
  const parsed = atlasChapterDeleteSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, error: 'invalid', message: 'Invalid journey.' };
  }

  try {
    const client = await db.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query<{
        shareId: string;
        version: number;
      }>(
        `
          SELECT version, share_id AS "shareId"
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
          message: 'That journey no longer exists.',
        };
      }

      if (current.rows[0].version !== parsed.data.version) {
        await client.query('ROLLBACK');
        return {
          ok: false,
          error: 'conflict',
          message:
            'This journey changed elsewhere. Refresh it before deleting.',
        };
      }

      const deleted = await client.query<{ id: string }>(
        `
          DELETE FROM atlas_chapters
          WHERE id = $1 AND user_id = $2
          RETURNING id
        `,
        [parsed.data.id, session.user.id],
      );

      if (!deleted.rows[0]) {
        await client.query('ROLLBACK');
        return {
          ok: false,
          error: 'not-found',
          message: 'That journey no longer exists.',
        };
      }

      await client.query('COMMIT');
      revalidateChapter(parsed.data.id, current.rows[0].shareId);
      return { ok: true, data: deleted.rows[0] };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Atlas chapter deletion failed:', error);
    return failed('We could not delete that journey. Please try again.');
  }
}
