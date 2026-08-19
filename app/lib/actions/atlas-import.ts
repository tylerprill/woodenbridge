'use server';

import { createHash, randomUUID } from 'node:crypto';
import { db, sql, type VercelPoolClient } from '@/app/lib/db';
import { revalidatePath } from 'next/cache';

import { requireVerifiedSession } from '@/app/lib/auth/session';
import type {
  AtlasImportActionResult,
  AtlasImportBatch,
  AtlasImportCancellation,
  AtlasImportFinalization,
  AtlasImportPlaceResult,
  CancelAtlasImportBatchInput,
  CreateAtlasImportBatchInput,
  FinalizeAtlasImportBatchInput,
  PrepareAtlasImportItemInput,
  AtlasImportPreparation,
  ResolveAtlasImportPlaceInput,
} from '@/app/lib/atlas/import-definitions';
import { loadAtlasImportBatchForUser } from '@/app/lib/atlas/import-data';
import {
  ATLAS_IMPORT_MAX_ACCOUNT_ENTRIES,
  ATLAS_IMPORT_MAX_ACTIVE_BATCHES,
  ATLAS_IMPORT_MAX_RETAINED_CLEANUP_BATCHES,
  ATLAS_IMPORT_CLEANUP_FENCE_MINUTES,
  cancelAtlasImportBatchSchema,
  createAtlasImportBatchSchema,
  finalizeAtlasImportBatchSchema,
  prepareAtlasImportItemSchema,
  resolveAtlasImportPlaceSchema,
} from '@/app/lib/atlas/import-validation';
import {
  createAtlasMediaPath,
  createAtlasThumbnailPath,
} from '@/app/lib/atlas/media-policy';
import { lookupAtlasPlace } from '@/app/lib/atlas/geocoding';
import { createAtlasImportPayloadFingerprint } from '@/app/lib/atlas/import-fingerprint';
import type { AtlasPlaceContext } from '@/app/lib/atlas/place';

const GEOCODE_HOURLY_LIMIT = 120;
const GEOCODE_CACHE_DAYS = 30;
const GEOCODE_LEASE_SECONDS = 10;
const DEFAULT_GEOCODE_MIN_INTERVAL_MS = 1_000;
const MIN_GEOCODE_INTERVAL_MS = 50;
const MAX_GEOCODE_INTERVAL_MS = 60_000;

type BatchStateRow = {
  id: string;
  status: AtlasImportBatch['status'];
  version: number;
  item_count: number;
  chapter_title: string;
  chapter_introduction: string;
  cover_client_item_id: string | null;
};

type FinalizeItemRow = {
  client_item_id: string;
  entry_id: string;
  expected_media_id: string;
  position: number;
  status: 'pending' | 'uploaded';
  title: string;
  media_id: string | null;
};

type GeocodeCacheRow = {
  status: 'pending' | 'ready';
  lease_token: string | null;
  leased_until: Date | string | null;
  place_name: string | null;
  locality: string | null;
  region: string | null;
  country: string | null;
  country_code: string | null;
  geocoder: string | null;
  geocoded_at: Date | string | null;
  expires_at: Date | string;
};

type GeocodeUsageRow = {
  request_count: number;
  window_expired: boolean;
  too_fast: boolean;
  retry_after_ms: number;
};

type GeocodeGlobalUsageRow = {
  in_flight: boolean;
  in_flight_retry_after_ms: number;
  too_fast: boolean;
  retry_after_ms: number;
};

function failed(message = 'The photographs could not be imported. Try again.') {
  return { ok: false, error: 'failed', message } as const;
}

function trimPlaceField(value: string | null, maximum = 120) {
  return value?.trim().slice(0, maximum) || null;
}

function normalizeImportPlace(place: AtlasPlaceContext): AtlasPlaceContext {
  const countryCode = place.countryCode?.trim().toUpperCase() ?? '';
  return {
    placeName: trimPlaceField(place.placeName) ?? 'Place awaiting detail',
    locality: trimPlaceField(place.locality),
    region: trimPlaceField(place.region),
    country: trimPlaceField(place.country),
    countryCode: /^[A-Z]{2}$/.test(countryCode) ? countryCode : null,
    geocoder: trimPlaceField(place.geocoder, 32) ?? 'atlas',
    geocodedAt: place.geocodedAt,
  };
}

function toCachedImportPlace(row: GeocodeCacheRow): AtlasPlaceContext | null {
  if (
    row.status !== 'ready' ||
    !row.place_name ||
    !row.geocoder ||
    !row.geocoded_at
  ) {
    return null;
  }
  return {
    placeName: row.place_name,
    locality: row.locality,
    region: row.region,
    country: row.country,
    countryCode: row.country_code?.trim() || null,
    geocoder: row.geocoder,
    geocodedAt:
      row.geocoded_at instanceof Date
        ? row.geocoded_at.toISOString()
        : new Date(row.geocoded_at).toISOString(),
  };
}

function createGeocodeCacheKey(latitude: number, longitude: number) {
  const provider =
    process.env.ATLAS_GEOCODER_ENDPOINT || 'nominatim-openstreetmap-v1';
  return createHash('sha256')
    .update(`${provider}\u0000${latitude.toFixed(5)},${longitude.toFixed(5)}`)
    .digest('hex');
}

function getGeocodeMinIntervalMs() {
  const configured = Number(process.env.ATLAS_GEOCODER_MIN_INTERVAL_MS);
  return Number.isInteger(configured) &&
    configured >= MIN_GEOCODE_INTERVAL_MS &&
    configured <= MAX_GEOCODE_INTERVAL_MS
    ? configured
    : DEFAULT_GEOCODE_MIN_INTERVAL_MS;
}

function revalidateAtlasImport(chapterId?: string | null) {
  revalidatePath('/dashboard');
  revalidatePath('/dashboard/places');
  revalidatePath('/dashboard/chapters');
  if (chapterId) revalidatePath(`/dashboard/chapters/${chapterId}`);
}

async function loadCompletedFinalization(
  client: VercelPoolClient,
  batch: BatchStateRow,
  userId: string,
): Promise<AtlasImportFinalization> {
  const [entries, chapter] = await Promise.all([
    client.query<{ entry_id: string }>(
      `
        SELECT entry_id
        FROM atlas_import_items
        WHERE batch_id = $1 AND user_id = $2
        ORDER BY position
      `,
      [batch.id, userId],
    ),
    client.query<{ id: string; share_id: string }>(
      `
        SELECT id, share_id
        FROM atlas_chapters
        WHERE import_batch_id = $1 AND user_id = $2
        LIMIT 1
      `,
      [batch.id, userId],
    ),
  ]);

  return {
    batchId: batch.id,
    version: batch.version,
    entryIds: entries.rows.map((row) => row.entry_id),
    chapterId: chapter.rows[0]?.id ?? null,
    shareId: chapter.rows[0]?.share_id ?? null,
  };
}

export async function createAtlasImportBatchAction(
  input: CreateAtlasImportBatchInput,
): Promise<AtlasImportActionResult<AtlasImportBatch>> {
  const session = await requireVerifiedSession();
  const parsed = createAtlasImportBatchSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid',
      message:
        parsed.error.issues[0]?.message ??
        'Review the photographs and try again.',
    };
  }

  const userId = session.user.id;
  const { clientRequestId: normalizedClientRequestId, ...normalizedPayload } =
    parsed.data;
  const payloadFingerprint =
    createAtlasImportPayloadFingerprint(normalizedPayload);
  const client = await db.connect();
  let batchId: string | null = null;

  try {
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`atlas-import:${userId}`],
    );

    const existing = await client.query<{
      id: string;
      payload_matches: boolean;
    }>(
      `
        SELECT
          id,
          payload_fingerprint = $3::char(64) AS payload_matches
        FROM atlas_import_batches
        WHERE user_id = $1 AND client_request_id = $2
        LIMIT 1
        FOR UPDATE
      `,
      [userId, normalizedClientRequestId, payloadFingerprint],
    );
    if (existing.rows[0]) {
      if (!existing.rows[0].payload_matches) {
        await client.query('ROLLBACK');
        return {
          ok: false,
          error: 'conflict',
          message:
            'This import request was already opened with different details. Start a new import and try again.',
        };
      }
      batchId = existing.rows[0].id;
      await client.query('COMMIT');
      const batch = await loadAtlasImportBatchForUser(userId, batchId);
      return batch
        ? { ok: true, data: batch }
        : failed('That import could not be reopened.');
    }

    const sourceHashes = parsed.data.items.map((item) => item.sourceHash);
    const duplicateResult = await client.query<{
      source_hash: string;
      entry_id: string;
      title: string;
    }>(
      `
        WITH requested AS (
          SELECT source_hash
          FROM unnest($2::text[]) AS selected(source_hash)
        ),
        matches AS (
          SELECT media.source_hash, media.entry_id
          FROM atlas_media AS media
          INNER JOIN requested ON requested.source_hash = media.source_hash
          WHERE media.user_id = $1
            AND media.source_hash IS NOT NULL
          UNION
          SELECT item.source_hash, item.entry_id
          FROM atlas_import_items AS item
          INNER JOIN atlas_import_batches AS batch
            ON batch.id = item.batch_id
            AND batch.user_id = item.user_id
          INNER JOIN requested ON requested.source_hash = item.source_hash
          WHERE item.user_id = $1
            AND batch.status IN ('uploading', 'ready', 'completed')
        )
        SELECT DISTINCT ON (matches.source_hash)
          matches.source_hash,
          entry.id AS entry_id,
          entry.title
        FROM matches
        INNER JOIN atlas_entries AS entry
          ON entry.id = matches.entry_id
          AND entry.user_id = $1
          AND entry.deleted_at IS NULL
        ORDER BY matches.source_hash, entry.updated_at DESC
      `,
      [userId, sourceHashes],
    );
    if (duplicateResult.rows.length) {
      await client.query('ROLLBACK');
      const duplicateByHash = new Map(
        duplicateResult.rows.map((row) => [row.source_hash.trim(), row]),
      );
      return {
        ok: false,
        error: 'duplicate',
        message:
          duplicateResult.rows.length === 1
            ? 'That photograph is already in your atlas.'
            : `${duplicateResult.rows.length} photographs are already in your atlas.`,
        duplicates: parsed.data.items.flatMap((item) => {
          const match = duplicateByHash.get(item.sourceHash);
          return match
            ? [
                {
                  clientItemId: item.clientItemId,
                  entryId: match.entry_id,
                  title: match.title,
                },
              ]
            : [];
        }),
      };
    }

    const usage = await client.query<{
      open_batches: number | string;
      retained_cleanup_batches: number | string;
      live_entries: number | string;
    }>(
      `
        SELECT
          (
            SELECT COUNT(*)::int
            FROM atlas_import_batches
            WHERE user_id = $1
              AND status IN ('uploading', 'ready')
          ) AS open_batches,
          (
            SELECT COUNT(*)::int
            FROM atlas_import_batches
            WHERE user_id = $1
              AND status = 'cancel_pending'
          ) AS retained_cleanup_batches,
          (
            SELECT COUNT(*)::int
            FROM atlas_entries AS entry
            WHERE entry.user_id = $1
              AND entry.deleted_at IS NULL
              AND NOT EXISTS (
                SELECT 1
                FROM atlas_import_items AS cancelled_item
                INNER JOIN atlas_import_batches AS cancelled_batch
                  ON cancelled_batch.id = cancelled_item.batch_id
                  AND cancelled_batch.user_id = cancelled_item.user_id
                WHERE cancelled_item.entry_id = entry.id
                  AND cancelled_item.user_id = entry.user_id
                  AND cancelled_batch.status IN ('cancel_pending', 'cancelled')
              )
          ) AS live_entries
      `,
      [userId],
    );
    const openBatches = Number(usage.rows[0]?.open_batches ?? 0);
    const retainedCleanupBatches = Number(
      usage.rows[0]?.retained_cleanup_batches ?? 0,
    );
    const liveEntries = Number(usage.rows[0]?.live_entries ?? 0);
    if (retainedCleanupBatches >= ATLAS_IMPORT_MAX_RETAINED_CLEANUP_BATCHES) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        error: 'limit',
        message:
          'Cancelled photo imports are still being cleaned up. Try starting a new import after cleanup finishes.',
      };
    }
    if (openBatches >= ATLAS_IMPORT_MAX_ACTIVE_BATCHES) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        error: 'limit',
        message:
          'Finish or cancel an open photo import before starting another.',
      };
    }
    if (
      liveEntries + parsed.data.items.length >
      ATLAS_IMPORT_MAX_ACCOUNT_ENTRIES
    ) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        error: 'limit',
        message: 'Your atlas has reached its memory limit.',
      };
    }

    const insertedBatch = await client.query<{ id: string }>(
      `
        INSERT INTO atlas_import_batches (
          user_id,
          client_request_id,
          payload_fingerprint,
          item_count,
          chapter_title,
          chapter_introduction,
          cover_client_item_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
      `,
      [
        userId,
        normalizedClientRequestId,
        payloadFingerprint,
        parsed.data.items.length,
        parsed.data.chapterTitle,
        parsed.data.chapterIntroduction,
        parsed.data.coverClientItemId,
      ],
    );
    const insertedBatchRow = insertedBatch.rows[0];
    if (!insertedBatchRow)
      throw new Error('Import batch insert returned no row.');
    batchId = insertedBatchRow.id;
    const newBatchId = batchId;

    const preparedItems = parsed.data.items.map((item, position) => {
      const entryId = randomUUID();
      const entryRequestId = randomUUID();
      const mediaId = randomUUID();
      return {
        ...item,
        id: randomUUID(),
        batch_id: newBatchId,
        entry_id: entryId,
        entry_request_id: entryRequestId,
        media_id: mediaId,
        client_item_id: item.clientItemId,
        position,
        place_label: item.placeLabel,
        place_name: item.placeName,
        place_locality: item.placeLocality,
        place_region: item.placeRegion,
        place_country: item.placeCountry,
        place_country_code: item.placeCountryCode,
        place_geocoder: item.placeGeocoder,
        place_geocoded_at: item.placeGeocodedAt,
        visited_on: item.visitedOn,
        source_name: item.sourceName,
        source_mime_type: item.sourceMimeType,
        source_byte_size: item.sourceByteSize,
        source_hash: item.sourceHash,
        source_width: item.sourceWidth,
        source_height: item.sourceHeight,
        media_width: item.mediaWidth,
        media_height: item.mediaHeight,
        prepared_byte_size: item.preparedByteSize,
        thumbnail_byte_size: item.thumbnailByteSize,
        location_source: item.locationSource,
        date_source: item.dateSource,
        date_confirmed: item.dateConfirmed,
        place_source: item.placeSource,
      };
    });
    const preparedJson = JSON.stringify(preparedItems);

    await client.query(
      `
        INSERT INTO atlas_entries (
          id,
          user_id,
          client_request_id,
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
          location
        )
        SELECT
          selected.entry_id,
          $1,
          selected.entry_request_id,
          selected.title,
          selected.description,
          NULLIF(selected.place_label, ''),
          selected.place_name,
          selected.place_locality,
          selected.place_region,
          selected.place_country,
          selected.place_country_code,
          selected.place_geocoder,
          selected.place_geocoded_at,
          selected.visited_on,
          'draft',
          'visited',
          ST_SetSRID(
            ST_MakePoint(selected.longitude, selected.latitude),
            4326
          )::geography
        FROM jsonb_to_recordset($2::jsonb) AS selected(
          entry_id UUID,
          entry_request_id UUID,
          title TEXT,
          description TEXT,
          place_label TEXT,
          place_name TEXT,
          place_locality TEXT,
          place_region TEXT,
          place_country TEXT,
          place_country_code TEXT,
          place_geocoder TEXT,
          place_geocoded_at TIMESTAMPTZ,
          visited_on DATE,
          latitude DOUBLE PRECISION,
          longitude DOUBLE PRECISION
        )
      `,
      [userId, preparedJson],
    );

    await client.query(
      `
        INSERT INTO atlas_import_items (
          id,
          batch_id,
          user_id,
          entry_id,
          expected_media_id,
          client_item_id,
          position,
          source_name,
          source_mime_type,
          source_byte_size,
          source_hash,
          source_width,
          source_height,
          media_width,
          media_height,
          prepared_byte_size,
          thumbnail_byte_size,
          location_source,
          date_source,
          date_confirmed,
          place_source
        )
        SELECT
          selected.id,
          selected.batch_id,
          $1,
          selected.entry_id,
          selected.media_id,
          selected.client_item_id,
          selected.position,
          selected.source_name,
          selected.source_mime_type,
          selected.source_byte_size,
          selected.source_hash,
          selected.source_width,
          selected.source_height,
          selected.media_width,
          selected.media_height,
          selected.prepared_byte_size,
          selected.thumbnail_byte_size,
          selected.location_source,
          selected.date_source,
          selected.date_confirmed,
          selected.place_source
        FROM jsonb_to_recordset($2::jsonb) AS selected(
          id UUID,
          batch_id UUID,
          entry_id UUID,
          media_id UUID,
          client_item_id UUID,
          position SMALLINT,
          source_name TEXT,
          source_mime_type TEXT,
          source_byte_size BIGINT,
          source_hash TEXT,
          source_width INTEGER,
          source_height INTEGER,
          media_width INTEGER,
          media_height INTEGER,
          prepared_byte_size INTEGER,
          thumbnail_byte_size INTEGER,
          location_source TEXT,
          date_source TEXT,
          date_confirmed BOOLEAN,
          place_source TEXT
        )
      `,
      [userId, preparedJson],
    );

    await client.query('COMMIT');
    const batch = await loadAtlasImportBatchForUser(userId, batchId);
    if (!batch) return failed();
    revalidatePath('/dashboard');
    return { ok: true, data: batch };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('Atlas import batch creation failed:', error);
    return failed();
  } finally {
    client.release();
  }
}

export async function prepareAtlasImportItemAction(
  input: PrepareAtlasImportItemInput,
): Promise<AtlasImportActionResult<AtlasImportPreparation>> {
  const session = await requireVerifiedSession();
  const parsed = prepareAtlasImportItemSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid',
      message:
        parsed.error.issues[0]?.message ??
        'The photograph could not be prepared.',
    };
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const batchResult = await client.query<{
      status: AtlasImportBatch['status'];
    }>(
      `
        SELECT status
        FROM atlas_import_batches
        WHERE id = $1 AND user_id = $2
        LIMIT 1
        FOR UPDATE
      `,
      [parsed.data.batchId, session.user.id],
    );
    const batch = batchResult.rows[0];
    if (!batch) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        error: 'not-found',
        message: 'That import is unavailable.',
      };
    }
    if (!['uploading', 'ready'].includes(batch.status)) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        error: 'invalid',
        message: 'That import can no longer accept photographs.',
      };
    }

    const itemResult = await client.query<{
      id: string;
      status: 'pending' | 'uploaded';
      source_width: number | null;
      source_height: number | null;
      media_width: number | null;
      media_height: number | null;
      prepared_byte_size: number | null;
      thumbnail_byte_size: number | null;
    }>(
      `
        SELECT
          item.id,
          item.status,
          item.source_width,
          item.source_height,
          item.media_width,
          item.media_height,
          item.prepared_byte_size,
          item.thumbnail_byte_size
        FROM atlas_import_items AS item
        WHERE item.id = $1
          AND item.batch_id = $2
          AND item.user_id = $3
        LIMIT 1
        FOR UPDATE
      `,
      [parsed.data.itemId, parsed.data.batchId, session.user.id],
    );
    const item = itemResult.rows[0];
    if (!item) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        error: 'not-found',
        message: 'That photograph is no longer in this import.',
      };
    }
    const expected = [
      parsed.data.sourceWidth,
      parsed.data.sourceHeight,
      parsed.data.mediaWidth,
      parsed.data.mediaHeight,
      parsed.data.preparedByteSize,
      parsed.data.thumbnailByteSize,
    ];
    const current = [
      item.source_width,
      item.source_height,
      item.media_width,
      item.media_height,
      item.prepared_byte_size,
      item.thumbnail_byte_size,
    ];
    const wasPrepared = current.every((value) => value !== null);
    if (
      wasPrepared &&
      !current.every((value, index) => value === expected[index])
    ) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        error: 'conflict',
        message: 'This photograph was already prepared differently.',
      };
    }

    if (!wasPrepared) {
      const updated = await client.query<{ id: string }>(
        `
          UPDATE atlas_import_items
          SET
            source_width = $1,
            source_height = $2,
            media_width = $3,
            media_height = $4,
            prepared_byte_size = $5,
            thumbnail_byte_size = $6,
            updated_at = NOW()
          WHERE id = $7
            AND batch_id = $8
            AND user_id = $9
            AND status = 'pending'
            AND source_width IS NULL
            AND source_height IS NULL
            AND media_width IS NULL
            AND media_height IS NULL
            AND prepared_byte_size IS NULL
            AND thumbnail_byte_size IS NULL
          RETURNING id
        `,
        [...expected, item.id, parsed.data.batchId, session.user.id],
      );
      if (!updated.rows[0]) {
        await client.query('ROLLBACK');
        return {
          ok: false,
          error: 'conflict',
          message: 'This photograph changed while it was being prepared.',
        };
      }
    }

    await client.query('COMMIT');
    return {
      ok: true,
      data: {
        batchId: parsed.data.batchId,
        itemId: item.id,
        prepared: true,
      },
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('Atlas import preparation failed:', error);
    return failed('The photograph could not be prepared. Try it again.');
  } finally {
    client.release();
  }
}

export async function resolveAtlasImportPlaceAction(
  input: ResolveAtlasImportPlaceInput,
): Promise<AtlasImportPlaceResult> {
  const session = await requireVerifiedSession();
  const parsed = resolveAtlasImportPlaceSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid',
      message: 'Invalid photograph location.',
    };
  }

  const cacheKey = createGeocodeCacheKey(
    parsed.data.latitude,
    parsed.data.longitude,
  );
  const geocodeMinIntervalMs = getGeocodeMinIntervalMs();
  const leaseToken = randomUUID();
  const globalLeaseToken = randomUUID();
  const client = await db.connect();
  let clientReleased = false;
  let globalLeaseCommitted = false;

  try {
    await client.query('BEGIN');
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`atlas-import-geocode-cache:${cacheKey}`],
    );
    const cacheResult = await client.query<GeocodeCacheRow>(
      `
        SELECT
          status,
          lease_token,
          leased_until,
          place_name,
          locality,
          region,
          country,
          country_code,
          geocoder,
          geocoded_at,
          expires_at
        FROM atlas_import_geocode_cache
        WHERE cache_key = $1
        LIMIT 1
        FOR UPDATE
      `,
      [cacheKey],
    );
    const cache = cacheResult.rows[0];
    const cachedPlace = cache ? toCachedImportPlace(cache) : null;
    const cacheStillFresh = Boolean(
      cachedPlace && new Date(cache!.expires_at).getTime() > Date.now(),
    );
    if (cachedPlace && cacheStillFresh) {
      await client.query('COMMIT');
      return { ok: true, data: cachedPlace };
    }

    if (
      cache?.status === 'pending' &&
      cache.leased_until &&
      new Date(cache.leased_until).getTime() > Date.now()
    ) {
      const leaseRemainingMs =
        new Date(cache.leased_until).getTime() - Date.now();
      await client.query('ROLLBACK');
      return {
        ok: false,
        error: 'limit',
        message: 'Atlas is already identifying this place. Try again shortly.',
        retryAfterMs: Math.min(750, Math.max(100, leaseRemainingMs)),
      };
    }

    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [`atlas-import-geocode-user:${session.user.id}`],
    );
    const usageResult = await client.query<GeocodeUsageRow>(
      `
        SELECT
          request_count,
          window_started_at <= NOW() - INTERVAL '1 hour' AS window_expired,
          last_request_at >
            clock_timestamp() - ($2::int * INTERVAL '1 millisecond') AS too_fast,
          GREATEST(
            0,
            CEIL(
              EXTRACT(
                EPOCH FROM (
                  last_request_at
                  + ($2::int * INTERVAL '1 millisecond')
                  - clock_timestamp()
                )
              ) * 1000
            )
          )::int AS retry_after_ms
        FROM atlas_import_geocode_usage
        WHERE user_id = $1
        LIMIT 1
        FOR UPDATE
      `,
      [session.user.id, geocodeMinIntervalMs],
    );
    const usage = usageResult.rows[0];
    if (
      usage &&
      !usage.window_expired &&
      usage.request_count >= GEOCODE_HOURLY_LIMIT
    ) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        error: 'limit',
        message:
          'The hourly place lookup limit has been reached. Try again later.',
      };
    }
    if (usage && !usage.window_expired && usage.too_fast) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        error: 'limit',
        message: 'Atlas is pacing place lookups. Try again in a moment.',
        retryAfterMs: Math.max(
          MIN_GEOCODE_INTERVAL_MS,
          usage.retry_after_ms || geocodeMinIntervalMs,
        ),
      };
    }

    const globalUsageResult = await client.query<GeocodeGlobalUsageRow>(
      `
        SELECT
          in_flight_token IS NOT NULL
            AND in_flight_until > clock_timestamp() AS in_flight,
          GREATEST(
            0,
            CEIL(
              EXTRACT(
                EPOCH FROM (in_flight_until - clock_timestamp())
              ) * 1000
            )
          )::int AS in_flight_retry_after_ms,
          last_request_at >
            clock_timestamp() - ($1::int * INTERVAL '1 millisecond') AS too_fast,
          GREATEST(
            0,
            CEIL(
              EXTRACT(
                EPOCH FROM (
                  last_request_at
                  + ($1::int * INTERVAL '1 millisecond')
                  - clock_timestamp()
                )
              ) * 1000
            )
          )::int AS retry_after_ms
        FROM atlas_import_geocode_global_usage
        WHERE singleton_id = 1
        FOR UPDATE
      `,
      [geocodeMinIntervalMs],
    );
    const globalUsage = globalUsageResult.rows[0];
    if (!globalUsage) {
      throw new Error('Atlas geocoder global usage row is missing.');
    }
    if (globalUsage.in_flight) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        error: 'limit',
        message: 'Atlas is identifying another place. Try again in a moment.',
        retryAfterMs: Math.max(
          MIN_GEOCODE_INTERVAL_MS,
          globalUsage.in_flight_retry_after_ms || geocodeMinIntervalMs,
        ),
      };
    }
    if (globalUsage.too_fast) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        error: 'limit',
        message:
          'Atlas is pacing place lookups across all travelers. Try again in a moment.',
        retryAfterMs: Math.max(
          MIN_GEOCODE_INTERVAL_MS,
          globalUsage.retry_after_ms || geocodeMinIntervalMs,
        ),
      };
    }

    await client.query(
      `
        INSERT INTO atlas_import_geocode_cache (
          cache_key,
          status,
          lease_token,
          leased_until,
          expires_at
        )
        VALUES (
          $1,
          'pending',
          $2,
          NOW() + ($3 * INTERVAL '1 second'),
          NOW() + ($3 * INTERVAL '1 second')
        )
        ON CONFLICT (cache_key) DO UPDATE
        SET
          status = 'pending',
          lease_token = EXCLUDED.lease_token,
          leased_until = EXCLUDED.leased_until,
          place_name = NULL,
          locality = NULL,
          region = NULL,
          country = NULL,
          country_code = NULL,
          geocoder = NULL,
          geocoded_at = NULL,
          expires_at = EXCLUDED.expires_at,
          updated_at = NOW()
      `,
      [cacheKey, leaseToken, GEOCODE_LEASE_SECONDS],
    );
    await client.query(
      `
        INSERT INTO atlas_import_geocode_usage (
          user_id,
          window_started_at,
          request_count,
          last_request_at
        )
        VALUES ($1, NOW(), 1, clock_timestamp())
        ON CONFLICT (user_id) DO UPDATE
        SET
          window_started_at = CASE
            WHEN atlas_import_geocode_usage.window_started_at
              <= NOW() - INTERVAL '1 hour'
            THEN NOW()
            ELSE atlas_import_geocode_usage.window_started_at
          END,
          request_count = CASE
            WHEN atlas_import_geocode_usage.window_started_at
              <= NOW() - INTERVAL '1 hour'
            THEN 1
            ELSE atlas_import_geocode_usage.request_count + 1
          END,
          last_request_at = clock_timestamp(),
          updated_at = NOW()
      `,
      [session.user.id],
    );
    const globalUsageUpdate = await client.query(
      `
        UPDATE atlas_import_geocode_global_usage
        SET
          last_request_at = clock_timestamp(),
          in_flight_token = $1,
          in_flight_until = clock_timestamp() + ($2 * INTERVAL '1 second'),
          updated_at = NOW()
        WHERE singleton_id = 1
      `,
      [globalLeaseToken, GEOCODE_LEASE_SECONDS],
    );
    if (globalUsageUpdate.rowCount !== 1) {
      throw new Error('Atlas geocoder global usage row could not be updated.');
    }
    await client.query('COMMIT');
    globalLeaseCommitted = true;
    client.release();
    clientReleased = true;

    const resolved = await lookupAtlasPlace(parsed.data);
    if (!resolved.ok) {
      await sql`
        DELETE FROM atlas_import_geocode_cache
        WHERE cache_key = ${cacheKey}
          AND lease_token = ${leaseToken}
          AND status = 'pending'
      `;
      if (resolved.retryAfterMs !== undefined) {
        return {
          ok: false,
          error: 'provider',
          message:
            resolved.reason === 'rate-limited'
              ? 'The place service is pacing requests. Atlas will try again shortly.'
              : 'The place service needs another moment. Atlas will try again shortly.',
          retryAfterMs: resolved.retryAfterMs,
        };
      }
      return {
        ok: false,
        error: 'failed',
        message: 'Atlas could not identify this place. Name it yourself.',
      };
    }
    const place = normalizeImportPlace(resolved.data);
    const stored = await sql<{ cache_key: string }>`
      UPDATE atlas_import_geocode_cache
      SET
        status = 'ready',
        lease_token = NULL,
        leased_until = NULL,
        place_name = ${place.placeName},
        locality = ${place.locality},
        region = ${place.region},
        country = ${place.country},
        country_code = ${place.countryCode},
        geocoder = ${place.geocoder},
        geocoded_at = ${place.geocodedAt}::timestamptz,
        expires_at = NOW() + (${GEOCODE_CACHE_DAYS} * INTERVAL '1 day'),
        updated_at = NOW()
      WHERE cache_key = ${cacheKey}
        AND lease_token = ${leaseToken}
        AND status = 'pending'
      RETURNING cache_key
    `;
    if (!stored.rows[0]) {
      const concurrent = await sql<GeocodeCacheRow>`
        SELECT
          status,
          lease_token,
          leased_until,
          place_name,
          locality,
          region,
          country,
          country_code,
          geocoder,
          geocoded_at,
          expires_at
        FROM atlas_import_geocode_cache
        WHERE cache_key = ${cacheKey}
          AND status = 'ready'
          AND expires_at > NOW()
        LIMIT 1
      `;
      const concurrentPlace = concurrent.rows[0]
        ? toCachedImportPlace(concurrent.rows[0])
        : null;
      return { ok: true, data: concurrentPlace ?? place };
    }
    return { ok: true, data: place };
  } catch (error) {
    if (!clientReleased) {
      await client.query('ROLLBACK').catch(() => undefined);
    } else {
      await sql`
        DELETE FROM atlas_import_geocode_cache
        WHERE cache_key = ${cacheKey}
          AND lease_token = ${leaseToken}
          AND status = 'pending'
      `.catch(() => undefined);
    }
    console.error('Atlas import place lookup failed:', error);
    return {
      ok: false,
      error: 'failed',
      message: 'Atlas could not identify this place. Name it yourself.',
    };
  } finally {
    if (globalLeaseCommitted) {
      await sql`
        UPDATE atlas_import_geocode_global_usage
        SET
          in_flight_token = NULL,
          in_flight_until = NULL,
          updated_at = NOW()
        WHERE singleton_id = 1
          AND in_flight_token = ${globalLeaseToken}
      `.catch((error) => {
        console.error('Atlas geocoder global lease release failed:', error);
      });
    }
    if (!clientReleased) client.release();
  }
}

export async function finalizeAtlasImportBatchAction(
  input: FinalizeAtlasImportBatchInput,
): Promise<AtlasImportActionResult<AtlasImportFinalization>> {
  const session = await requireVerifiedSession();
  const parsed = finalizeAtlasImportBatchSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'invalid', message: 'Invalid photo import.' };
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const batchResult = await client.query<BatchStateRow>(
      `
        SELECT
          id,
          status,
          version,
          item_count,
          chapter_title,
          chapter_introduction,
          cover_client_item_id
        FROM atlas_import_batches
        WHERE id = $1 AND user_id = $2
        LIMIT 1
        FOR UPDATE
      `,
      [parsed.data.batchId, session.user.id],
    );
    const batch = batchResult.rows[0];
    if (!batch) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        error: 'not-found',
        message: 'That import is unavailable.',
      };
    }
    const persistedCreateChapter = batch.cover_client_item_id !== null;
    if (parsed.data.createChapter !== persistedCreateChapter) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        error: 'conflict',
        message:
          'This import has a different saved chapter choice. Reopen it and try again.',
      };
    }
    if (batch.status === 'completed') {
      const completedCover = batch.cover_client_item_id
        ? await client.query<{ expected_media_id: string }>(
            `
              SELECT expected_media_id
              FROM atlas_import_items
              WHERE batch_id = $1
                AND user_id = $2
                AND client_item_id = $3
              LIMIT 1
            `,
            [batch.id, session.user.id, batch.cover_client_item_id],
          )
        : null;
      const expectedCompletedCover =
        completedCover?.rows[0]?.expected_media_id ?? null;
      if (parsed.data.coverMediaId !== expectedCompletedCover) {
        await client.query('ROLLBACK');
        return {
          ok: false,
          error: 'conflict',
          message:
            'This import has a different saved chapter cover. Reopen it and try again.',
        };
      }
      const completed = await loadCompletedFinalization(
        client,
        batch,
        session.user.id,
      );
      await client.query('COMMIT');
      return { ok: true, data: completed };
    }
    if (batch.version !== parsed.data.version) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        error: 'conflict',
        message: 'This import changed elsewhere. Refresh it and try again.',
      };
    }
    if (batch.status !== 'ready') {
      await client.query('ROLLBACK');
      return {
        ok: false,
        error: 'invalid',
        message: 'Finish uploading every photograph before creating memories.',
      };
    }

    const items = await client.query<FinalizeItemRow>(
      `
        SELECT
          item.client_item_id,
          item.entry_id,
          item.expected_media_id,
          item.position,
          item.status,
          entry.title,
          media.id AS media_id
        FROM atlas_import_items AS item
        INNER JOIN atlas_entries AS entry
          ON entry.id = item.entry_id AND entry.user_id = item.user_id
        LEFT JOIN atlas_media AS media
          ON media.id = item.expected_media_id
          AND media.entry_id = item.entry_id
          AND media.user_id = item.user_id
        WHERE item.batch_id = $1 AND item.user_id = $2
        ORDER BY item.position
        FOR UPDATE OF item, entry
      `,
      [batch.id, session.user.id],
    );
    if (
      items.rows.length !== batch.item_count ||
      items.rows.some(
        (item) =>
          item.status !== 'uploaded' || !item.media_id || !item.title.trim(),
      )
    ) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        error: 'invalid',
        message: 'Review every memory and finish its photograph before saving.',
      };
    }

    const persistedCover = batch.cover_client_item_id
      ? items.rows.find(
          (item) => item.client_item_id === batch.cover_client_item_id,
        )
      : null;
    const expectedCoverMediaId = persistedCover?.expected_media_id ?? null;
    if (
      (persistedCreateChapter && !persistedCover) ||
      parsed.data.coverMediaId !== expectedCoverMediaId
    ) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        error: 'conflict',
        message:
          'This import has a different saved chapter cover. Reopen it and try again.',
      };
    }

    let chapterId: string | null = null;
    let shareId: string | null = null;
    if (persistedCreateChapter) {
      if (!batch.chapter_title.trim()) {
        await client.query('ROLLBACK');
        return {
          ok: false,
          error: 'invalid',
          message: 'Name the chapter before creating it.',
        };
      }
      const chapter = await client.query<{ id: string; share_id: string }>(
        `
          INSERT INTO atlas_chapters (
            user_id,
            title,
            introduction,
            cover_media_id,
            visibility,
            share_map,
            share_location_precision,
            import_batch_id
          )
          VALUES ($1, $2, $3, $4, 'private', TRUE, 'approximate', $5)
          RETURNING id, share_id
        `,
        [
          session.user.id,
          batch.chapter_title,
          batch.chapter_introduction,
          expectedCoverMediaId,
          batch.id,
        ],
      );
      const chapterRow = chapter.rows[0];
      if (!chapterRow) throw new Error('Chapter insert returned no row.');
      chapterId = chapterRow.id;
      shareId = chapterRow.share_id;

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
            selected.position,
            ''
          FROM unnest($3::uuid[], $4::smallint[])
            AS selected(entry_id, position)
        `,
        [
          chapterId,
          session.user.id,
          items.rows.map((item) => item.entry_id),
          items.rows.map((item) => item.position),
        ],
      );
    }

    const entryIds = items.rows.map((item) => item.entry_id);
    const savedEntries = await client.query<{ id: string }>(
      `
        UPDATE atlas_entries
        SET record_state = 'saved', version = version + 1, updated_at = NOW()
        WHERE user_id = $1
          AND id = ANY($2::uuid[])
          AND record_state = 'draft'
          AND deleted_at IS NULL
        RETURNING id
      `,
      [session.user.id, entryIds],
    );
    if (savedEntries.rows.length !== entryIds.length) {
      throw new Error('Import finalization did not save every entry.');
    }
    const completed = await client.query<{ version: number }>(
      `
        UPDATE atlas_import_batches
        SET
          status = 'completed',
          version = version + 1,
          completed_at = NOW(),
          updated_at = NOW()
        WHERE id = $1 AND user_id = $2 AND status = 'ready'
        RETURNING version
      `,
      [batch.id, session.user.id],
    );
    const completedRow = completed.rows[0];
    if (!completedRow) throw new Error('Import completion returned no row.');
    await client.query(
      `
        UPDATE atlas_import_items
        SET source_name = '', updated_at = NOW()
        WHERE batch_id = $1 AND user_id = $2
      `,
      [batch.id, session.user.id],
    );
    await client.query('COMMIT');

    revalidateAtlasImport(chapterId);
    return {
      ok: true,
      data: {
        batchId: batch.id,
        version: completedRow.version,
        entryIds,
        chapterId,
        shareId,
      },
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('Atlas import finalization failed:', error);
    return failed(
      'The memories could not be finished. Your import is still safe.',
    );
  } finally {
    client.release();
  }
}

export async function cancelAtlasImportBatchAction(
  input: CancelAtlasImportBatchInput,
): Promise<AtlasImportActionResult<AtlasImportCancellation>> {
  const session = await requireVerifiedSession();
  const parsed = cancelAtlasImportBatchSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: 'invalid', message: 'Invalid photo import.' };
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const batch = await client.query<BatchStateRow>(
      `
        SELECT
          id,
          status,
          version,
          item_count,
          chapter_title,
          chapter_introduction,
          cover_client_item_id
        FROM atlas_import_batches
        WHERE id = $1 AND user_id = $2
        LIMIT 1
        FOR UPDATE
      `,
      [parsed.data.batchId, session.user.id],
    );
    const row = batch.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        error: 'not-found',
        message: 'That import is unavailable.',
      };
    }
    if (row.status === 'completed') {
      await client.query('ROLLBACK');
      return {
        ok: false,
        error: 'invalid',
        message:
          'Finished memories can be removed from your atlas individually.',
      };
    }
    if (
      row.status !== 'cancel_pending' &&
      row.version !== parsed.data.version
    ) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        error: 'conflict',
        message: 'This import changed elsewhere. Refresh it and try again.',
      };
    }
    if (row.status !== 'cancel_pending') {
      await client.query(
        `
          UPDATE atlas_import_batches
          SET
            status = 'cancel_pending',
            version = version + 1,
            cleanup_not_before = NOW() + ($3 * INTERVAL '1 minute'),
            updated_at = NOW()
          WHERE id = $1 AND user_id = $2
        `,
        [row.id, session.user.id, ATLAS_IMPORT_CLEANUP_FENCE_MINUTES],
      );
    }
    await client.query(
      `
        UPDATE atlas_media AS media
        SET source_hash = NULL
        FROM atlas_import_items AS item
        WHERE item.batch_id = $1
          AND item.user_id = $2
          AND media.id = item.expected_media_id
          AND media.entry_id = item.entry_id
          AND media.user_id = item.user_id
      `,
      [row.id, session.user.id],
    );
    await client.query('COMMIT');

    revalidatePath('/dashboard');
    return {
      ok: true,
      data: { batchId: row.id, cleanupPending: true },
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('Atlas import cancellation failed:', error);
    return failed('The import could not be cancelled. Try again.');
  } finally {
    client.release();
  }
}
