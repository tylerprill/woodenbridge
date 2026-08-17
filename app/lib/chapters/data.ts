import 'server-only';

import { sql } from '@vercel/postgres';
import { cache } from 'react';

import { requireVerifiedSession } from '@/app/lib/auth/session';
import type { AtlasMedia } from '@/app/lib/atlas/definitions';
import { createAuthenticatedAtlasMediaUrls } from '@/app/lib/atlas/media-grant';
import {
  type AtlasEntryRow,
  type AtlasMediaRow,
  toAtlasEntry,
  toAtlasMedia,
} from '@/app/lib/atlas/rows';
import type {
  AtlasChapter,
  AtlasChapterEntry,
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
  cover_media_id: string | null;
  visibility: AtlasChapterSummary['visibility'];
  share_id: string;
  share_map: boolean;
  share_location_precision: AtlasChapterSummary['shareLocationPrecision'];
  created_at: Date | string;
  updated_at: Date | string;
};

type ChapterCoverRow = AtlasMediaRow & { chapter_id: string };

type ChapterEditorRow = {
  id: string;
  title: string;
  introduction: string;
  version: number;
  cover_media_id: string | null;
  visibility: AtlasChapterSummary['visibility'];
  share_id: string;
  share_map: boolean;
  share_location_precision: AtlasChapterSummary['shareLocationPrecision'];
  memories: Array<{ entryId: string; transitionNote: string }>;
};

type ChapterEntryRow = AtlasEntryRow & { transition_note: string };

type ChapterMemoryOptionRow = {
  id: string;
  title: string;
  place_label: string | null;
  place_name: string | null;
  visited_on: Date | string | null;
  journey_state: AtlasEntryRow['journey_state'];
  media_id: string | null;
  storage_path: string | null;
  thumbnail_path: string | null;
  mime_type: string | null;
};

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

function attachMedia(
  entries: ChapterEntryRow[],
  mediaRows: AtlasMediaRow[],
  userId: string | null,
): AtlasChapterEntry[] {
  const mediaByEntry = new Map<string, AtlasMedia[]>();
  for (const row of mediaRows) {
    const media = toAtlasMedia(row, userId ?? undefined);
    const current = mediaByEntry.get(media.entryId) ?? [];
    current.push(media);
    mediaByEntry.set(media.entryId, current);
  }

  return entries.map((row) => ({
    ...toAtlasEntry(row, mediaByEntry.get(row.id) ?? []),
    transitionNote: row.transition_note,
  }));
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
    coverMediaId: row.cover_media_id,
    visibility: row.visibility,
    shareId: row.share_id,
    shareMap: row.share_map,
    shareLocationPrecision: row.share_location_precision,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
  };
}

async function loadChapter({
  userId,
  chapterId,
  shareId,
}: {
  userId: string | null;
  chapterId: string | null;
  shareId: string | null;
}) {
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
        chapter.cover_media_id,
        chapter.visibility,
        chapter.share_id,
        chapter.share_map,
        chapter.share_location_precision,
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
      WHERE (
        (chapter.id = ${chapterId}::uuid AND chapter.user_id = ${userId}::uuid)
        OR (chapter.share_id = ${shareId}::uuid AND chapter.visibility = 'shared')
      )
      GROUP BY chapter.id
      LIMIT 1
    `,
    sql<ChapterEntryRow>`
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
        entry.updated_at,
        chapter_entry.transition_note
      FROM atlas_chapter_entries AS chapter_entry
      INNER JOIN atlas_chapters AS chapter
        ON chapter.id = chapter_entry.chapter_id
      INNER JOIN atlas_entries AS entry
        ON entry.id = chapter_entry.entry_id
      WHERE (
        (chapter.id = ${chapterId}::uuid AND chapter.user_id = ${userId}::uuid)
        OR (chapter.share_id = ${shareId}::uuid AND chapter.visibility = 'shared')
      )
        AND entry.user_id = chapter.user_id
        AND entry.record_state = 'saved'
        AND entry.deleted_at IS NULL
      ORDER BY chapter_entry.position
    `,
    sql<AtlasMediaRow>`
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
      FROM atlas_chapter_entries AS chapter_entry
      INNER JOIN atlas_chapters AS chapter
        ON chapter.id = chapter_entry.chapter_id
      INNER JOIN atlas_entries AS entry
        ON entry.id = chapter_entry.entry_id
      INNER JOIN atlas_media AS media
        ON media.entry_id = entry.id
        AND media.user_id = chapter.user_id
      WHERE (
        (chapter.id = ${chapterId}::uuid AND chapter.user_id = ${userId}::uuid)
        OR (chapter.share_id = ${shareId}::uuid AND chapter.visibility = 'shared')
      )
        AND entry.user_id = chapter.user_id
        AND entry.record_state = 'saved'
        AND entry.deleted_at IS NULL
      ORDER BY chapter_entry.position, media.sort_order, media.created_at
    `,
  ]);

  const row = chapterResult.rows[0];
  if (!row) return null;

  const entries = attachMedia(entriesResult.rows, mediaResult.rows, userId);
  const coverMedia =
    (row.cover_media_id
      ? entries
          .flatMap((entry) => entry.media)
          .find((media) => media.id === row.cover_media_id)
      : null) ??
    entries.find((entry) => entry.media.length)?.media[0] ??
    null;

  return {
    ...toChapterSummary(row, coverMedia),
    entries,
  } satisfies AtlasChapter;
}

export async function getAtlasChapters({
  page,
  pageSize = 18,
}: {
  page: number;
  pageSize?: number;
}) {
  const session = await requireVerifiedSession();
  const userId = session.user.id;
  const limit = Math.min(Math.max(Math.trunc(pageSize), 1), 60);
  const currentPage = Math.max(Math.trunc(page) || 1, 1);
  const offset = (currentPage - 1) * limit;
  const [chaptersResult, coverResult, countResult] = await Promise.all([
    sql<ChapterRow>`
      SELECT
        chapter.id,
        chapter.title,
        chapter.introduction,
        chapter.version,
        COUNT(entry.id)::int AS memory_count,
        MIN(entry.visited_on) AS start_date,
        MAX(entry.visited_on) AS end_date,
        chapter.cover_media_id,
        chapter.visibility,
        chapter.share_id,
        chapter.share_map,
        chapter.share_location_precision,
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
      LIMIT ${limit}
      OFFSET ${offset}
    `,
    sql<ChapterCoverRow>`
      WITH selected_chapters AS (
        SELECT id
        FROM atlas_chapters
        WHERE user_id = ${userId}
        ORDER BY updated_at DESC
        LIMIT ${limit}
        OFFSET ${offset}
      )
      SELECT DISTINCT ON (chapter.id)
        chapter.id AS chapter_id,
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
      FROM atlas_chapters AS chapter
      INNER JOIN selected_chapters AS selected
        ON selected.id = chapter.id
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
      ORDER BY
        chapter.id,
        (media.id = chapter.cover_media_id) DESC,
        chapter_entry.position,
        media.sort_order,
        media.created_at
    `,
    sql<{ total: number | string }>`
      SELECT COUNT(*)::int AS total
      FROM atlas_chapters
      WHERE user_id = ${userId}
    `,
  ]);

  const coverByChapter = new Map(
    coverResult.rows.map((row) => [row.chapter_id, toAtlasMedia(row, userId)]),
  );

  const total = Number(countResult.rows[0]?.total ?? 0);
  return {
    chapters: chaptersResult.rows.map((row) =>
      toChapterSummary(row, coverByChapter.get(row.id) ?? null),
    ),
    total,
    page: currentPage,
    pageSize: limit,
    offset,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

export async function getAtlasChapter(chapterId: string) {
  const parsed = atlasChapterIdSchema.safeParse(chapterId);
  if (!parsed.success) return null;

  const session = await requireVerifiedSession();
  return loadChapter({
    userId: session.user.id,
    chapterId: parsed.data,
    shareId: null,
  });
}

export const getSharedAtlasChapter = cache(async (shareId: string) => {
  const parsed = atlasChapterIdSchema.safeParse(shareId);
  if (!parsed.success) return null;

  const chapter = await loadChapter({
    userId: null,
    chapterId: null,
    shareId: parsed.data,
  });
  if (!chapter) return null;

  const withShareAccess = (url: string) =>
    `${url}${url.includes('?') ? '&' : '?'}share=${chapter.shareId}`;
  const entries = chapter.entries.map((entry) => ({
    ...entry,
    latitude:
      chapter.shareLocationPrecision === 'exact'
        ? entry.latitude
        : Number(entry.latitude.toFixed(1)),
    longitude:
      chapter.shareLocationPrecision === 'exact'
        ? entry.longitude
        : Number(entry.longitude.toFixed(1)),
    media: entry.media.map((media) => ({
      ...media,
      deliveryUrl: withShareAccess(media.deliveryUrl),
      thumbnailUrl: withShareAccess(media.thumbnailUrl),
    })),
  }));
  const coverMedia = chapter.coverMedia
    ? (entries
        .flatMap((entry) => entry.media)
        .find((media) => media.id === chapter.coverMedia?.id) ?? null)
    : null;

  return { ...chapter, entries, coverMedia } satisfies AtlasChapter;
});

export async function getAtlasChapterEditorData(
  chapterId?: string,
): Promise<AtlasChapterEditorData> {
  const session = await requireVerifiedSession();
  const userId = session.user.id;
  const parsedId = chapterId ? atlasChapterIdSchema.safeParse(chapterId) : null;

  if (chapterId && !parsedId?.success) {
    return { chapter: null, availableEntries: [] };
  }
  const editorChapterId = parsedId?.success ? parsedId.data : null;

  const [chapter, entriesResult] = await Promise.all([
    editorChapterId
      ? sql<ChapterEditorRow>`
          SELECT
            chapter.id,
            chapter.title,
            chapter.introduction,
            chapter.version,
            chapter.cover_media_id,
            chapter.visibility,
            chapter.share_id,
            chapter.share_map,
            chapter.share_location_precision,
            COALESCE(
              JSONB_AGG(
                JSONB_BUILD_OBJECT(
                  'entryId', chapter_entry.entry_id,
                  'transitionNote', chapter_entry.transition_note
                )
                ORDER BY chapter_entry.position
              )
                FILTER (WHERE chapter_entry.entry_id IS NOT NULL),
              '[]'::jsonb
            ) AS memories
          FROM atlas_chapters AS chapter
          LEFT JOIN atlas_chapter_entries AS chapter_entry
            ON chapter_entry.chapter_id = chapter.id
            AND chapter_entry.user_id = ${userId}
          WHERE chapter.id = ${editorChapterId}
            AND chapter.user_id = ${userId}
          GROUP BY chapter.id
          LIMIT 1
        `.then((result) => {
          const row = result.rows[0];
          return row
            ? {
                id: row.id,
                title: row.title,
                introduction: row.introduction,
                version: row.version,
                coverMediaId: row.cover_media_id,
                visibility: row.visibility,
                shareId: row.share_id,
                shareMap: row.share_map,
                shareLocationPrecision: row.share_location_precision,
                memories: row.memories,
              }
            : null;
        })
      : Promise.resolve(null),
    sql<ChapterMemoryOptionRow>`
      WITH recent_entries AS (
        SELECT id
        FROM atlas_entries
        WHERE user_id = ${userId}
          AND record_state = 'saved'
          AND deleted_at IS NULL
        ORDER BY visited_on DESC NULLS LAST, updated_at DESC
        LIMIT 500
      ),
      selected_entries AS (
        SELECT chapter_entry.entry_id AS id
        FROM atlas_chapter_entries AS chapter_entry
        INNER JOIN atlas_chapters AS chapter
          ON chapter.id = chapter_entry.chapter_id
        WHERE chapter.id = ${editorChapterId}::uuid
          AND chapter.user_id = ${userId}
          AND chapter_entry.user_id = ${userId}
      )
      SELECT
        entry.id,
        entry.title,
        entry.place_label,
        entry.place_name,
        entry.visited_on,
        entry.journey_state,
        cover_media.id AS media_id,
        cover_media.storage_path,
        cover_media.thumbnail_path,
        cover_media.mime_type
      FROM atlas_entries AS entry
      LEFT JOIN LATERAL (
        SELECT
          media.id,
          media.storage_path,
          media.thumbnail_path,
          media.mime_type
        FROM atlas_media AS media
        WHERE media.entry_id = entry.id
          AND media.user_id = ${userId}
        ORDER BY media.sort_order, media.created_at
        LIMIT 1
      ) AS cover_media ON TRUE
      WHERE entry.user_id = ${userId}
        AND entry.record_state = 'saved'
        AND entry.deleted_at IS NULL
        AND (
          entry.id IN (SELECT id FROM recent_entries)
          OR entry.id IN (SELECT id FROM selected_entries)
        )
      ORDER BY entry.visited_on DESC NULLS LAST, entry.updated_at DESC
    `,
  ]);

  return {
    chapter,
    availableEntries: entriesResult.rows.map((row) => {
      const mediaUrls =
        row.media_id && row.storage_path && row.mime_type
          ? createAuthenticatedAtlasMediaUrls(
              {
                id: row.media_id,
                entryId: row.id,
                storagePath: row.storage_path,
                thumbnailPath: row.thumbnail_path,
                mimeType: row.mime_type,
              },
              userId,
            )
          : null;

      return {
        id: row.id,
        title: row.title,
        placeLabel: row.place_label ?? '',
        placeName: row.place_name,
        visitedOn: toDateString(row.visited_on),
        journeyState: row.journey_state,
        coverMediaId: row.media_id,
        thumbnailUrl: mediaUrls?.thumbnailUrl ?? null,
      };
    }),
  };
}
