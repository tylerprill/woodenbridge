import 'server-only';

import { sql } from '@vercel/postgres';

import { requireVerifiedSession } from '@/app/lib/auth/session';
import type { AtlasData, AtlasEntry, JourneyState } from './definitions';
import {
  type AtlasEntryRow,
  type AtlasMediaRow,
  type AtlasViewRow,
  toAtlasEntry,
  toAtlasMedia,
  toAtlasView,
} from './rows';
import { atlasEntryIdSchema } from './validation';

const MAX_ATLAS_ENTRIES = 5000;

function safeLimit(limit: number) {
  return Math.min(Math.max(Math.trunc(limit), 1), MAX_ATLAS_ENTRIES);
}

function attachMedia(
  entries: AtlasEntryRow[],
  mediaRows: AtlasMediaRow[],
  userId: string,
): AtlasEntry[] {
  const mediaByEntry = new Map<string, ReturnType<typeof toAtlasMedia>[]>();
  for (const row of mediaRows) {
    const media = toAtlasMedia(row, userId);
    const current = mediaByEntry.get(media.entryId) ?? [];
    current.push(media);
    mediaByEntry.set(media.entryId, current);
  }

  return entries.map((entry) =>
    toAtlasEntry(entry, mediaByEntry.get(entry.id) ?? []),
  );
}

async function loadSavedEntries(userId: string, requestedLimit: number) {
  const limit = safeLimit(requestedLimit);
  const [entriesResult, mediaResult] = await Promise.all([
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
      ORDER BY updated_at DESC
      LIMIT ${limit}
    `,
    sql<AtlasMediaRow>`
      WITH selected_entries AS (
        SELECT id
        FROM atlas_entries
        WHERE user_id = ${userId}
          AND record_state = 'saved'
          AND deleted_at IS NULL
        ORDER BY updated_at DESC
        LIMIT ${limit}
      )
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
      INNER JOIN selected_entries AS entry ON entry.id = media.entry_id
      WHERE media.user_id = ${userId}
      ORDER BY media.entry_id, media.sort_order, media.created_at
    `,
  ]);

  return attachMedia(entriesResult.rows, mediaResult.rows, userId);
}

export async function getAtlasData(): Promise<AtlasData> {
  const session = await requireVerifiedSession();
  const userId = session.user.id;

  // The map needs coordinates and memory text, not every photo byte or media
  // record. Photos are loaded only when a drawer opens; card surfaces use the
  // focused saved-entry queries below.
  const [entriesResult, viewResult] = await Promise.all([
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
        AND record_state IN ('draft', 'saved')
        AND deleted_at IS NULL
      ORDER BY updated_at DESC
      LIMIT 5000
    `,
    sql<AtlasViewRow>`
      SELECT latitude, longitude, zoom, bearing, pitch
      FROM atlas_preferences
      WHERE user_id = ${userId}
      LIMIT 1
    `,
  ]);

  return {
    entries: entriesResult.rows.map((entry) => toAtlasEntry(entry)),
    view: toAtlasView(viewResult.rows[0]),
  };
}

export type AtlasCollectionFilter = 'all' | 'visited' | 'ahead';

export async function getAtlasCollectionData({
  filter,
  page,
  pageSize = 24,
}: {
  filter: AtlasCollectionFilter;
  page: number;
  pageSize?: number;
}) {
  const session = await requireVerifiedSession();
  const userId = session.user.id;
  const limit = Math.min(Math.max(Math.trunc(pageSize), 1), 60);
  const currentPage = Math.max(Math.trunc(page) || 1, 1);
  const offset = (currentPage - 1) * limit;
  const journeyState: JourneyState | null =
    filter === 'visited'
      ? 'visited'
      : filter === 'ahead'
        ? 'want_to_visit'
        : null;

  const [entriesResult, mediaResult, countsResult] = await Promise.all([
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
        AND (
          ${journeyState}::atlas_journey_state IS NULL
          OR journey_state = ${journeyState}::atlas_journey_state
        )
      ORDER BY updated_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `,
    sql<AtlasMediaRow>`
      WITH selected_entries AS (
        SELECT id
        FROM atlas_entries
        WHERE user_id = ${userId}
          AND record_state = 'saved'
          AND deleted_at IS NULL
          AND (
            ${journeyState}::atlas_journey_state IS NULL
            OR journey_state = ${journeyState}::atlas_journey_state
          )
        ORDER BY updated_at DESC
        LIMIT ${limit}
        OFFSET ${offset}
      )
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
      INNER JOIN selected_entries AS entry ON entry.id = media.entry_id
      WHERE media.user_id = ${userId}
      ORDER BY media.entry_id, media.sort_order, media.created_at
    `,
    sql<{
      total: number | string;
      visited: number | string;
      future: number | string;
    }>`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE journey_state = 'visited')::int AS visited,
        COUNT(*) FILTER (WHERE journey_state = 'want_to_visit')::int AS future
      FROM atlas_entries
      WHERE user_id = ${userId}
        AND record_state = 'saved'
        AND deleted_at IS NULL
    `,
  ]);
  const row = countsResult.rows[0];
  const counts = {
    total: Number(row?.total ?? 0),
    visited: Number(row?.visited ?? 0),
    future: Number(row?.future ?? 0),
  };
  const filteredTotal =
    filter === 'visited'
      ? counts.visited
      : filter === 'ahead'
        ? counts.future
        : counts.total;

  return {
    entries: attachMedia(entriesResult.rows, mediaResult.rows, userId),
    counts,
    page: currentPage,
    pageSize: limit,
    offset,
    totalPages: Math.max(1, Math.ceil(filteredTotal / limit)),
  };
}

export async function getAtlasJournalData() {
  const session = await requireVerifiedSession();
  const userId = session.user.id;
  const [entries, countsResult] = await Promise.all([
    loadSavedEntries(userId, 6),
    sql<{
      total: number | string;
      visited: number | string;
      future: number | string;
    }>`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE journey_state = 'visited')::int AS visited,
        COUNT(*) FILTER (WHERE journey_state = 'want_to_visit')::int AS future
      FROM atlas_entries
      WHERE user_id = ${userId}
        AND record_state = 'saved'
        AND deleted_at IS NULL
    `,
  ]);
  const counts = countsResult.rows[0];

  return {
    entries,
    counts: {
      total: Number(counts?.total ?? 0),
      visited: Number(counts?.visited ?? 0),
      future: Number(counts?.future ?? 0),
    },
  };
}

export async function getSavedAtlasEntry(entryId: string) {
  const parsed = atlasEntryIdSchema.safeParse(entryId);
  if (!parsed.success) return null;

  const session = await requireVerifiedSession();
  const userId = session.user.id;
  const [entryResult, mediaResult] = await Promise.all([
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
      WHERE id = ${parsed.data}
        AND user_id = ${userId}
        AND record_state = 'saved'
        AND deleted_at IS NULL
      LIMIT 1
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
      FROM atlas_media AS media
      INNER JOIN atlas_entries AS entry ON entry.id = media.entry_id
      WHERE media.entry_id = ${parsed.data}
        AND media.user_id = ${userId}
        AND entry.user_id = ${userId}
        AND entry.record_state = 'saved'
        AND entry.deleted_at IS NULL
      ORDER BY media.sort_order, media.created_at
    `,
  ]);

  const entry = entryResult.rows[0];
  if (!entry) return null;
  return toAtlasEntry(
    entry,
    mediaResult.rows.map((media) => toAtlasMedia(media, userId)),
  );
}
