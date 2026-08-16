import 'server-only';

import { sql } from '@vercel/postgres';

import { requireVerifiedSession } from '@/app/lib/auth/session';
import type { AtlasEntry, AtlasMedia } from '@/app/lib/atlas/definitions';
import {
  type AtlasEntryRow,
  type AtlasMediaRow,
  toAtlasEntry,
  toAtlasMedia,
} from '@/app/lib/atlas/rows';
import type {
  AtlasChapter,
  AtlasChapterEditorData,
  AtlasChapterSummary,
} from './definitions';
import { atlasChapterIdSchema } from './validation';

type ChapterRow = {
  id: string;
  title: string;
  introduction: string;
  version: number;
  memory_count: number | string;
  start_date: Date | string | null;
  end_date: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

type ChapterCoverRow = AtlasMediaRow & { chapter_id: string };

function toIsoString(value: Date | string) {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function toDateString(value: Date | string | null) {
  if (!value) return null;
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value).slice(0, 10);
}

function attachMedia(entries: AtlasEntryRow[], mediaRows: AtlasMediaRow[]) {
  const mediaByEntry = new Map<string, AtlasMedia[]>();
  for (const row of mediaRows) {
    const media = toAtlasMedia(row);
    const current = mediaByEntry.get(media.entryId) ?? [];
    current.push(media);
    mediaByEntry.set(media.entryId, current);
  }

  return entries.map((row) =>
    toAtlasEntry(row, mediaByEntry.get(row.id) ?? []),
  );
}

function toChapterSummary(
  row: ChapterRow,
  coverMedia: AtlasMedia | null,
): AtlasChapterSummary {
  return {
    id: row.id,
    title: row.title,
    introduction: row.introduction,
    version: row.version,
    memoryCount: Number(row.memory_count),
    startDate: toDateString(row.start_date),
    endDate: toDateString(row.end_date),
    coverMedia,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

async function loadChapter(userId: string, chapterId: string) {
  const [chapterResult, entriesResult, mediaResult] = await Promise.all([
    sql<ChapterRow>`
      SELECT
        chapter.id,
        chapter.title,
        chapter.introduction,
        chapter.version,
        COUNT(entry.id)::int AS memory_count,
        MIN(entry.visited_on) AS start_date,
        MAX(entry.visited_on) AS end_date,
        chapter.created_at,
        chapter.updated_at
      FROM atlas_chapters AS chapter
      LEFT JOIN atlas_chapter_entries AS chapter_entry
        ON chapter_entry.chapter_id = chapter.id
      LEFT JOIN atlas_entries AS entry
        ON entry.id = chapter_entry.entry_id
        AND entry.user_id = chapter.user_id
        AND entry.record_state = 'saved'
        AND entry.deleted_at IS NULL
      WHERE chapter.id = ${chapterId}
        AND chapter.user_id = ${userId}
      GROUP BY chapter.id
      LIMIT 1
    `,
    sql<AtlasEntryRow>`
      SELECT
        entry.id,
        entry.title,
        entry.description,
        entry.place_label,
        entry.place_name,
        entry.place_locality,
        entry.place_region,
        entry.place_country,
        entry.place_country_code,
        entry.place_geocoder,
        entry.place_geocoded_at,
        entry.visited_on,
        entry.record_state,
        entry.journey_state,
        ST_Y(entry.location::geometry)::float8 AS latitude,
        ST_X(entry.location::geometry)::float8 AS longitude,
        entry.version,
        entry.created_at,
        entry.updated_at
      FROM atlas_chapter_entries AS chapter_entry
      INNER JOIN atlas_chapters AS chapter
        ON chapter.id = chapter_entry.chapter_id
      INNER JOIN atlas_entries AS entry
        ON entry.id = chapter_entry.entry_id
      WHERE chapter.id = ${chapterId}
        AND chapter.user_id = ${userId}
        AND entry.user_id = ${userId}
        AND entry.record_state = 'saved'
        AND entry.deleted_at IS NULL
      ORDER BY chapter_entry.position
    `,
    sql<AtlasMediaRow>`
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
      FROM atlas_chapter_entries AS chapter_entry
      INNER JOIN atlas_chapters AS chapter
        ON chapter.id = chapter_entry.chapter_id
      INNER JOIN atlas_entries AS entry
        ON entry.id = chapter_entry.entry_id
      INNER JOIN atlas_media AS media
        ON media.entry_id = entry.id
        AND media.user_id = ${userId}
      WHERE chapter.id = ${chapterId}
        AND chapter.user_id = ${userId}
        AND entry.user_id = ${userId}
        AND entry.record_state = 'saved'
        AND entry.deleted_at IS NULL
      ORDER BY chapter_entry.position, media.sort_order, media.created_at
    `,
  ]);

  const row = chapterResult.rows[0];
  if (!row) return null;

  const entries = attachMedia(entriesResult.rows, mediaResult.rows);
  const coverMedia = entries.find((entry) => entry.media.length)?.media[0] ?? null;

  return {
    ...toChapterSummary(row, coverMedia),
    entries,
  } satisfies AtlasChapter;
}

export async function getAtlasChapters(): Promise<AtlasChapterSummary[]> {
  const session = await requireVerifiedSession();
  const userId = session.user.id;
  const [chaptersResult, coverResult] = await Promise.all([
    sql<ChapterRow>`
      SELECT
        chapter.id,
        chapter.title,
        chapter.introduction,
        chapter.version,
        COUNT(entry.id)::int AS memory_count,
        MIN(entry.visited_on) AS start_date,
        MAX(entry.visited_on) AS end_date,
        chapter.created_at,
        chapter.updated_at
      FROM atlas_chapters AS chapter
      LEFT JOIN atlas_chapter_entries AS chapter_entry
        ON chapter_entry.chapter_id = chapter.id
      LEFT JOIN atlas_entries AS entry
        ON entry.id = chapter_entry.entry_id
        AND entry.user_id = chapter.user_id
        AND entry.record_state = 'saved'
        AND entry.deleted_at IS NULL
      WHERE chapter.user_id = ${userId}
      GROUP BY chapter.id
      ORDER BY chapter.updated_at DESC
    `,
    sql<ChapterCoverRow>`
      SELECT DISTINCT ON (chapter.id)
        chapter.id AS chapter_id,
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
      FROM atlas_chapters AS chapter
      INNER JOIN atlas_chapter_entries AS chapter_entry
        ON chapter_entry.chapter_id = chapter.id
      INNER JOIN atlas_entries AS entry
        ON entry.id = chapter_entry.entry_id
        AND entry.user_id = chapter.user_id
        AND entry.record_state = 'saved'
        AND entry.deleted_at IS NULL
      INNER JOIN atlas_media AS media
        ON media.entry_id = entry.id
        AND media.user_id = chapter.user_id
      WHERE chapter.user_id = ${userId}
      ORDER BY chapter.id, chapter_entry.position, media.sort_order, media.created_at
    `,
  ]);

  const coverByChapter = new Map(
    coverResult.rows.map((row) => [row.chapter_id, toAtlasMedia(row)]),
  );

  return chaptersResult.rows.map((row) =>
    toChapterSummary(row, coverByChapter.get(row.id) ?? null),
  );
}

export async function getAtlasChapter(chapterId: string) {
  const parsed = atlasChapterIdSchema.safeParse(chapterId);
  if (!parsed.success) return null;

  const session = await requireVerifiedSession();
  return loadChapter(session.user.id, parsed.data);
}

export async function getAtlasChapterEditorData(
  chapterId?: string,
): Promise<AtlasChapterEditorData> {
  const session = await requireVerifiedSession();
  const userId = session.user.id;
  const parsedId = chapterId
    ? atlasChapterIdSchema.safeParse(chapterId)
    : null;

  if (chapterId && !parsedId?.success) {
    return { chapter: null, availableEntries: [] };
  }

  const [chapter, entriesResult] = await Promise.all([
    parsedId?.success ? loadChapter(userId, parsedId.data) : Promise.resolve(null),
    sql<AtlasEntryRow>`
      SELECT
        id,
        title,
        description,
        place_label,
        place_name,
        place_locality,
        place_region,
        place_country,
        place_country_code,
        place_geocoder,
        place_geocoded_at,
        visited_on,
        record_state,
        journey_state,
        ST_Y(location::geometry)::float8 AS latitude,
        ST_X(location::geometry)::float8 AS longitude,
        version,
        created_at,
        updated_at
      FROM atlas_entries
      WHERE user_id = ${userId}
        AND record_state = 'saved'
        AND deleted_at IS NULL
      ORDER BY visited_on DESC NULLS LAST, updated_at DESC
      LIMIT 500
    `,
  ]);

  return {
    chapter,
    availableEntries: entriesResult.rows.map((row) => toAtlasEntry(row)),
  };
}
