import 'server-only';

import { sql } from '@/app/lib/db';
import { createAuthenticatedAtlasMediaUrls } from '@/app/lib/atlas/media-grant';

import type {
  AtlasJourneyDetail,
  AtlasJourneyDetailStop,
  AtlasJourneyIndex,
  AtlasJourneyListOptions,
  AtlasJourneyStop,
  AtlasJourneySummary,
  AtlasJourneySuggestion,
  AtlasJourneySuggestionSource,
} from './definitions';
import {
  ATLAS_JOURNEY_SUGGESTION_ALGORITHM_VERSION,
  ATLAS_JOURNEY_SUGGESTION_CANDIDATE_LIMIT,
  buildHistoricalJourneySuggestions,
  buildImportJourneySuggestions,
  selectAtlasJourneySuggestions,
  type AtlasJourneyImportSuggestionCandidate,
  type AtlasJourneySuggestionCandidate,
} from './suggestions';
import { atlasJourneyListOptionsSchema } from './validation';

type JourneyIndexRow = {
  chapter_id: string;
  chapter_title: string;
  chapter_version: number;
  chapter_updated_at: Date | string;
  entry_id: string | null;
  position: number | null;
  entry_title: string | null;
  place_label: string | null;
  place_name: string | null;
  visited_on: Date | string | null;
  latitude: number | string | null;
  longitude: number | string | null;
};

type JourneyDetailRow = JourneyIndexRow & {
  chapter_introduction: string;
  entry_description: string | null;
  transition_note: string | null;
  media_id: string | null;
  storage_path: string | null;
  thumbnail_path: string | null;
  mime_type: string | null;
  alt_text: string | null;
};

type SuggestionEntryRow = {
  entry_id: string;
  entry_version: number;
  entry_title: string;
  place_label: string | null;
  place_name: string | null;
  place_locality: string | null;
  place_region: string | null;
  place_country: string | null;
  visited_on: Date | string | null;
  latitude: number | string;
  longitude: number | string;
};

type ImportSuggestionRow = SuggestionEntryRow & {
  batch_id: string;
  completed_at: Date | string;
  item_count: number;
  position: number;
};

type SuggestionFeedbackRow = {
  suggestion_key: string;
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

function rowToStop(row: JourneyIndexRow): AtlasJourneyStop | null {
  if (
    !row.entry_id ||
    row.position === null ||
    row.entry_title === null ||
    row.latitude === null ||
    row.longitude === null
  ) {
    return null;
  }

  const latitude = Number(row.latitude);
  const longitude = Number(row.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;

  return {
    entryId: row.entry_id,
    position: row.position,
    title: row.entry_title,
    placeLabel: row.place_label ?? '',
    placeName: row.place_name ?? null,
    visitedOn: toDateString(row.visited_on),
    latitude,
    longitude,
  };
}

function stopDateRange(stops: AtlasJourneyStop[]) {
  const dates = stops
    .map((stop) => stop.visitedOn)
    .filter((value): value is string => Boolean(value))
    .sort();
  return {
    startDate: dates[0] ?? null,
    endDate: dates.at(-1) ?? null,
  };
}

export function mapAtlasJourneyIndexRows(rows: JourneyIndexRow[]) {
  const journeys = new Map<string, AtlasJourneySummary>();

  for (const row of rows) {
    let journey = journeys.get(row.chapter_id);
    if (!journey) {
      journey = {
        id: row.chapter_id,
        title: row.chapter_title,
        version: row.chapter_version,
        updatedAt: toIsoString(row.chapter_updated_at),
        startDate: null,
        endDate: null,
        memoryCount: 0,
        drawable: false,
        stops: [],
      };
      journeys.set(row.chapter_id, journey);
    }

    const stop = rowToStop(row);
    if (stop) journey.stops.push(stop);
  }

  const mappedJourneys = Array.from(journeys.values());
  for (const journey of mappedJourneys) {
    journey.stops.sort(
      (first, second) =>
        first.position - second.position ||
        first.entryId.localeCompare(second.entryId),
    );
    const range = stopDateRange(journey.stops);
    journey.startDate = range.startDate;
    journey.endDate = range.endDate;
    journey.memoryCount = journey.stops.length;
    journey.drawable = journey.stops.length >= 2;
  }

  return mappedJourneys;
}

export async function loadAtlasJourneyIndex(
  userId: string,
  options: AtlasJourneyListOptions = {},
): Promise<AtlasJourneyIndex> {
  const parsed = atlasJourneyListOptionsSchema.parse(options);
  const search = parsed.search ?? null;
  const selectedJourneyId = parsed.selectedJourneyId ?? null;

  const journeyRowsPromise = sql<JourneyIndexRow>`
    WITH recent_chapters AS (
      SELECT chapter.id
      FROM atlas_chapters AS chapter
      WHERE chapter.user_id = ${userId}
        AND (
          ${search}::text IS NULL
          OR chapter.title ILIKE '%' || ${search}::text || '%'
          OR EXISTS (
            SELECT 1
            FROM atlas_chapter_entries AS searchable_chapter_entry
            INNER JOIN atlas_entries AS searchable_entry
              ON searchable_entry.id = searchable_chapter_entry.entry_id
              AND searchable_entry.user_id = searchable_chapter_entry.user_id
            WHERE searchable_chapter_entry.chapter_id = chapter.id
              AND searchable_chapter_entry.user_id = ${userId}
              AND searchable_entry.record_state = 'saved'
              AND searchable_entry.deleted_at IS NULL
              AND (
                searchable_entry.title ILIKE '%' || ${search}::text || '%'
                OR searchable_entry.place_label ILIKE '%' || ${search}::text || '%'
              )
          )
        )
      ORDER BY chapter.updated_at DESC, chapter.id
      LIMIT ${parsed.limit}
    ),
    requested_chapters AS (
      SELECT id FROM recent_chapters
      UNION
      SELECT chapter.id
      FROM atlas_chapters AS chapter
      WHERE chapter.id = ${selectedJourneyId}::uuid
        AND chapter.user_id = ${userId}
    )
    SELECT
      chapter.id AS chapter_id,
      chapter.title AS chapter_title,
      chapter.version AS chapter_version,
      chapter.updated_at AS chapter_updated_at,
      entry.id AS entry_id,
      chapter_entry.position,
      entry.title AS entry_title,
      entry.place_label,
      entry.place_name,
      entry.visited_on,
      ST_Y(entry.location::geometry)::float8 AS latitude,
      ST_X(entry.location::geometry)::float8 AS longitude
    FROM requested_chapters
    INNER JOIN atlas_chapters AS chapter
      ON chapter.id = requested_chapters.id
      AND chapter.user_id = ${userId}
    LEFT JOIN atlas_chapter_entries AS chapter_entry
      ON chapter_entry.chapter_id = chapter.id
      AND chapter_entry.user_id = ${userId}
    LEFT JOIN atlas_entries AS entry
      ON entry.id = chapter_entry.entry_id
      AND entry.user_id = ${userId}
      AND entry.record_state = 'saved'
      AND entry.deleted_at IS NULL
    ORDER BY chapter.updated_at DESC, chapter.id, chapter_entry.position
  `;

  const [journeyRows, suggestions] = await Promise.all([
    journeyRowsPromise,
    parsed.includeSuggestions
      ? loadAtlasJourneySuggestions(userId)
      : Promise.resolve([]),
  ]);

  return {
    journeys: mapAtlasJourneyIndexRows(journeyRows.rows),
    suggestions,
  };
}

export async function loadAtlasJourneyDetail(
  userId: string,
  chapterId: string,
): Promise<AtlasJourneyDetail | null> {
  const result = await sql<JourneyDetailRow>`
    SELECT
      chapter.id AS chapter_id,
      chapter.title AS chapter_title,
      chapter.introduction AS chapter_introduction,
      chapter.version AS chapter_version,
      chapter.updated_at AS chapter_updated_at,
      entry.id AS entry_id,
      chapter_entry.position,
      entry.title AS entry_title,
      entry.description AS entry_description,
      entry.place_label,
      entry.place_name,
      entry.visited_on,
      ST_Y(entry.location::geometry)::float8 AS latitude,
      ST_X(entry.location::geometry)::float8 AS longitude,
      chapter_entry.transition_note,
      cover_media.id AS media_id,
      cover_media.storage_path,
      cover_media.thumbnail_path,
      cover_media.mime_type,
      cover_media.alt_text
    FROM atlas_chapters AS chapter
    LEFT JOIN atlas_chapter_entries AS chapter_entry
      ON chapter_entry.chapter_id = chapter.id
      AND chapter_entry.user_id = ${userId}
    LEFT JOIN atlas_entries AS entry
      ON entry.id = chapter_entry.entry_id
      AND entry.user_id = ${userId}
      AND entry.record_state = 'saved'
      AND entry.deleted_at IS NULL
    LEFT JOIN LATERAL (
      SELECT
        media.id,
        media.storage_path,
        media.thumbnail_path,
        media.mime_type,
        media.alt_text
      FROM atlas_media AS media
      WHERE media.entry_id = entry.id
        AND media.user_id = ${userId}
        AND media.thumbnail_path IS NOT NULL
      ORDER BY media.sort_order, media.created_at
      LIMIT 1
    ) AS cover_media ON TRUE
    WHERE chapter.id = ${chapterId}
      AND chapter.user_id = ${userId}
    ORDER BY chapter_entry.position
  `;

  const firstRow = result.rows[0];
  if (!firstRow) return null;

  const stops = result.rows.flatMap((row): AtlasJourneyDetailStop[] => {
    const stop = rowToStop(row);
    if (!stop) return [];
    let thumbnailUrl: string | null = null;
    if (
      row.media_id &&
      row.storage_path &&
      row.thumbnail_path &&
      row.mime_type
    ) {
      thumbnailUrl = createAuthenticatedAtlasMediaUrls(
        {
          id: row.media_id,
          entryId: stop.entryId,
          storagePath: row.storage_path,
          thumbnailPath: row.thumbnail_path,
          mimeType: row.mime_type,
        },
        userId,
      ).thumbnailUrl;
    }

    return [
      {
        ...stop,
        description: row.entry_description ?? '',
        transitionNote: row.transition_note ?? '',
        thumbnailUrl,
        thumbnailAlt: row.alt_text ?? '',
      },
    ];
  });
  const range = stopDateRange(stops);

  return {
    id: firstRow.chapter_id,
    title: firstRow.chapter_title,
    introduction: firstRow.chapter_introduction,
    version: firstRow.chapter_version,
    updatedAt: toIsoString(firstRow.chapter_updated_at),
    startDate: range.startDate,
    endDate: range.endDate,
    memoryCount: stops.length,
    drawable: stops.length >= 2,
    stops,
  };
}

function rowToSuggestionCandidate(
  row: SuggestionEntryRow,
): AtlasJourneySuggestionCandidate | null {
  const visitedOn = toDateString(row.visited_on);
  const latitude = Number(row.latitude);
  const longitude = Number(row.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  return {
    entryId: row.entry_id,
    version: row.entry_version,
    title: row.entry_title,
    placeLabel: row.place_label ?? '',
    placeName: row.place_name ?? null,
    placeLocality: row.place_locality ?? null,
    placeRegion: row.place_region ?? null,
    placeCountry: row.place_country ?? null,
    visitedOn,
    latitude,
    longitude,
  };
}

export async function loadAtlasJourneySuggestions(
  userId: string,
  { applyFeedback = true }: { applyFeedback?: boolean } = {},
): Promise<AtlasJourneySuggestion[]> {
  const [importRows, historicalRows, feedbackRows] = await Promise.all([
    sql<ImportSuggestionRow>`
      WITH recent_batches AS (
        SELECT batch.id, batch.completed_at, batch.item_count
        FROM atlas_import_batches AS batch
        WHERE batch.user_id = ${userId}
          AND batch.status = 'completed'
          AND batch.completed_at IS NOT NULL
          AND batch.item_count BETWEEN 2 AND 50
          AND batch.cover_client_item_id IS NULL
          AND BTRIM(batch.chapter_title) = ''
          AND NOT EXISTS (
            SELECT 1
            FROM atlas_chapters AS imported_chapter
            WHERE imported_chapter.import_batch_id = batch.id
              AND imported_chapter.user_id = ${userId}
          )
        ORDER BY batch.completed_at DESC, batch.id
        LIMIT 12
      )
      SELECT
        recent_batch.id AS batch_id,
        recent_batch.completed_at,
        recent_batch.item_count,
        import_item.position,
        entry.id AS entry_id,
        entry.version AS entry_version,
        entry.title AS entry_title,
        entry.place_label,
        entry.place_name,
        entry.place_locality,
        entry.place_region,
        entry.place_country,
        entry.visited_on,
        ST_Y(entry.location::geometry)::float8 AS latitude,
        ST_X(entry.location::geometry)::float8 AS longitude
      FROM recent_batches AS recent_batch
      INNER JOIN atlas_import_items AS import_item
        ON import_item.batch_id = recent_batch.id
        AND import_item.user_id = ${userId}
      INNER JOIN atlas_entries AS entry
        ON entry.id = import_item.entry_id
        AND entry.user_id = ${userId}
        AND entry.record_state = 'saved'
        AND entry.deleted_at IS NULL
      WHERE NOT EXISTS (
        SELECT 1
        FROM atlas_chapter_entries AS membership
        WHERE membership.entry_id = entry.id
          AND membership.user_id = ${userId}
      )
      ORDER BY recent_batch.completed_at DESC, recent_batch.id, import_item.position
    `,
    sql<SuggestionEntryRow>`
      SELECT
        entry.id AS entry_id,
        entry.version AS entry_version,
        entry.title AS entry_title,
        entry.place_label,
        entry.place_name,
        entry.place_locality,
        entry.place_region,
        entry.place_country,
        entry.visited_on,
        ST_Y(entry.location::geometry)::float8 AS latitude,
        ST_X(entry.location::geometry)::float8 AS longitude
      FROM atlas_entries AS entry
      WHERE entry.user_id = ${userId}
        AND entry.record_state = 'saved'
        AND entry.deleted_at IS NULL
        AND entry.visited_on IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM atlas_chapter_entries AS membership
          WHERE membership.entry_id = entry.id
            AND membership.user_id = ${userId}
        )
      ORDER BY entry.visited_on DESC, entry.updated_at DESC, entry.id
      LIMIT ${ATLAS_JOURNEY_SUGGESTION_CANDIDATE_LIMIT}
    `,
    sql<SuggestionFeedbackRow>`
      SELECT suggestion_key
      FROM atlas_journey_suggestion_feedback
      WHERE user_id = ${userId}
        AND algorithm_version = ${ATLAS_JOURNEY_SUGGESTION_ALGORITHM_VERSION}
    `,
  ]);

  const batches = new Map<
    string,
    AtlasJourneyImportSuggestionCandidate & { itemCount: number }
  >();
  for (const row of importRows.rows) {
    const entry = rowToSuggestionCandidate(row);
    if (!entry) continue;
    const batch = batches.get(row.batch_id) ?? {
      batchId: row.batch_id,
      completedAt: toIsoString(row.completed_at),
      itemCount: row.item_count,
      entries: [],
    };
    batch.entries.push({ ...entry, position: row.position });
    batches.set(row.batch_id, batch);
  }

  const completeBatches = Array.from(batches.values()).filter(
    (batch) => batch.entries.length === batch.itemCount,
  );
  const historicalCandidates = historicalRows.rows.flatMap((row) => {
    const entry = rowToSuggestionCandidate(row);
    return entry ? [entry] : [];
  });

  return selectAtlasJourneySuggestions({
    imports: buildImportJourneySuggestions(completeBatches),
    historical: buildHistoricalJourneySuggestions(historicalCandidates),
    excludedKeys: new Set(
      applyFeedback
        ? feedbackRows.rows.map((row) => row.suggestion_key.trim())
        : [],
    ),
  });
}

export async function dismissAtlasJourneySuggestion(
  userId: string,
  suggestion: Pick<
    AtlasJourneySuggestion,
    'key' | 'algorithmVersion' | 'source'
  >,
) {
  await sql`
    INSERT INTO atlas_journey_suggestion_feedback (
      user_id,
      suggestion_key,
      algorithm_version,
      source,
      decision,
      decided_at
    )
    VALUES (
      ${userId},
      ${suggestion.key},
      ${suggestion.algorithmVersion},
      ${suggestion.source},
      'dismissed',
      NOW()
    )
    ON CONFLICT (user_id, suggestion_key) DO UPDATE
    SET
      algorithm_version = EXCLUDED.algorithm_version,
      source = EXCLUDED.source,
      decision = 'dismissed',
      chapter_id = NULL,
      decided_at = NOW()
  `;
}

export async function acceptAtlasJourneySuggestion(
  userId: string,
  suggestionKey: string,
  source: AtlasJourneySuggestionSource,
  chapterId: string,
) {
  await sql`
    INSERT INTO atlas_journey_suggestion_feedback (
      user_id,
      suggestion_key,
      algorithm_version,
      source,
      decision,
      chapter_id,
      decided_at
    )
    VALUES (
      ${userId},
      ${suggestionKey},
      ${ATLAS_JOURNEY_SUGGESTION_ALGORITHM_VERSION},
      ${source},
      'accepted',
      ${chapterId},
      NOW()
    )
    ON CONFLICT (user_id, suggestion_key) DO UPDATE
    SET
      algorithm_version = EXCLUDED.algorithm_version,
      source = EXCLUDED.source,
      decision = 'accepted',
      chapter_id = EXCLUDED.chapter_id,
      decided_at = NOW()
  `;
}
