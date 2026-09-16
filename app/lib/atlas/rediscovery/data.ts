import 'server-only';

import { requireVerifiedSession } from '@/app/lib/auth/session';
import { sql } from '@/app/lib/db';
import type { AtlasEntryPresentation } from '@/app/lib/atlas/definitions';
import {
  type AtlasEntryRow,
  type AtlasMediaRow,
  toAtlasMedia,
} from '@/app/lib/atlas/rows';
import { parseCalendarDate } from './dates';
import type { RediscoveredMemory, RediscoveryData } from './definitions';

const ANNIVERSARY_PAGE_SIZE = 24;
const RECENT_MEMORY_LIMIT = 6;

type RediscoveryRow = Omit<AtlasEntryRow, 'latitude' | 'longitude'> & {
  cover_media: AtlasMediaRow | null;
  journey: RediscoveredMemory['journey'];
};

function toIsoString(value: Date | string) {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function toCalendarDate(value: Date | string | null) {
  if (!value) return null;
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value).slice(0, 10);
}

function toRediscoveredMemory(
  row: RediscoveryRow,
  userId: string,
): RediscoveredMemory {
  // No coordinates, storage paths, account fields, or map preferences leave
  // this presentation-only data boundary.
  const entry: AtlasEntryPresentation = {
    id: row.id,
    title: row.title,
    description: row.description,
    placeLabel: row.place_label ?? '',
    placeName: row.place_name ?? null,
    placeLocality: row.place_locality ?? null,
    placeRegion: row.place_region ?? null,
    placeCountry: row.place_country ?? null,
    placeCountryCode: row.place_country_code?.trim() || null,
    placeGeocoder: row.place_geocoder ?? null,
    placeGeocodedAt: row.place_geocoded_at
      ? toIsoString(row.place_geocoded_at)
      : null,
    visitedOn: toCalendarDate(row.visited_on),
    recordState: row.record_state,
    journeyState: row.journey_state,
    version: row.version,
    createdAt: toIsoString(row.created_at),
    updatedAt: toIsoString(row.updated_at),
    media: row.cover_media?.thumbnail_path
      ? [toAtlasMedia(row.cover_media, userId)]
      : [],
  };
  return {
    entry,
    journey: row.journey
      ? { id: row.journey.id, title: row.journey.title }
      : null,
  };
}

export async function getRediscoveryData({
  date,
  page = 1,
}: {
  date: string;
  page?: number;
}): Promise<RediscoveryData> {
  // Authorize even invalid requests; the route is not the security boundary.
  const session = await requireVerifiedSession();
  const calendarDate = parseCalendarDate(date);
  if (!calendarDate) throw new RangeError('Invalid rediscovery date.');
  const userId = session.user.id;
  const month = Number(calendarDate.slice(5, 7));
  const day = Number(calendarDate.slice(8, 10));
  const yearStart = `${calendarDate.slice(0, 4)}-01-01`;

  const countResult = await sql<{ total: number | string }>`
    SELECT COUNT(*)::int AS total
    FROM atlas_entries AS entry
    WHERE entry.user_id = ${userId}
      AND entry.record_state = 'saved'
      AND entry.journey_state = 'visited'
      AND entry.deleted_at IS NULL
      AND entry.visited_on < ${yearStart}::date
      AND EXTRACT(MONTH FROM entry.visited_on) = ${month}
      AND EXTRACT(DAY FROM entry.visited_on) = ${day}
      AND NOT EXISTS (
        SELECT 1
        FROM atlas_import_items AS import_item
        INNER JOIN atlas_import_batches AS import_batch
          ON import_batch.id = import_item.batch_id
          AND import_batch.user_id = import_item.user_id
        WHERE import_item.entry_id = entry.id
          AND import_item.user_id = entry.user_id
          AND import_batch.status <> 'completed'
      )
  `;
  const anniversaryTotal = Number(countResult.rows[0]?.total ?? 0);
  const mode = anniversaryTotal > 0 ? 'anniversary' : 'recent';
  const pageSize =
    mode === 'anniversary' ? ANNIVERSARY_PAGE_SIZE : RECENT_MEMORY_LIMIT;
  const totalPages =
    mode === 'anniversary'
      ? Math.max(1, Math.ceil(anniversaryTotal / pageSize))
      : 1;
  const requestedPage = Number.isFinite(page)
    ? Math.max(1, Math.trunc(page))
    : 1;
  const currentPage = Math.min(requestedPage, totalPages);
  const offset = (currentPage - 1) * pageSize;

  const memoriesResult = await sql<RediscoveryRow>`
    WITH selected_entries AS (
      SELECT entry.id
      FROM atlas_entries AS entry
      WHERE entry.user_id = ${userId}
        AND entry.record_state = 'saved'
        AND entry.journey_state = 'visited'
        AND entry.deleted_at IS NULL
        AND entry.visited_on <= ${calendarDate}::date
        AND (
          ${mode}::text = 'recent'
          OR (
            entry.visited_on < ${yearStart}::date
            AND EXTRACT(MONTH FROM entry.visited_on) = ${month}
            AND EXTRACT(DAY FROM entry.visited_on) = ${day}
          )
        )
        AND NOT EXISTS (
          SELECT 1
          FROM atlas_import_items AS import_item
          INNER JOIN atlas_import_batches AS import_batch
            ON import_batch.id = import_item.batch_id
            AND import_batch.user_id = import_item.user_id
          WHERE import_item.entry_id = entry.id
            AND import_item.user_id = entry.user_id
            AND import_batch.status <> 'completed'
        )
      ORDER BY entry.visited_on DESC, entry.updated_at DESC, entry.id DESC
      LIMIT ${pageSize}
      OFFSET ${offset}
    )
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
      entry.visited_on::text AS visited_on,
      entry.record_state,
      entry.journey_state,
      entry.version,
      entry.created_at,
      entry.updated_at,
      row_to_json(cover_media) AS cover_media,
      row_to_json(journey) AS journey
    FROM selected_entries AS selected
    INNER JOIN atlas_entries AS entry
      ON entry.id = selected.id AND entry.user_id = ${userId}
    LEFT JOIN LATERAL (
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
      WHERE media.entry_id = entry.id AND media.user_id = ${userId}
        AND media.thumbnail_path IS NOT NULL
      ORDER BY media.sort_order, media.created_at, media.id
      LIMIT 1
    ) AS cover_media ON TRUE
    LEFT JOIN LATERAL (
      SELECT chapter.id, chapter.title
      FROM atlas_chapter_entries AS chapter_entry
      INNER JOIN atlas_chapters AS chapter
        ON chapter.id = chapter_entry.chapter_id
        AND chapter.user_id = chapter_entry.user_id
      WHERE chapter_entry.entry_id = entry.id
        AND chapter_entry.user_id = ${userId}
        AND chapter.user_id = ${userId}
      ORDER BY chapter.updated_at DESC, chapter.id DESC
      LIMIT 1
    ) AS journey ON TRUE
    ORDER BY entry.visited_on DESC, entry.updated_at DESC, entry.id DESC
  `;
  const memories = memoriesResult.rows.map((row) =>
    toRediscoveredMemory(row, userId),
  );

  return {
    date: calendarDate,
    mode,
    total: mode === 'anniversary' ? anniversaryTotal : memories.length,
    page: currentPage,
    pageSize,
    totalPages,
    memories,
  };
}
