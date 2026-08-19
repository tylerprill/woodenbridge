import 'server-only';

import { db, sql } from '@/app/lib/db';

import { requireVerifiedSession } from '@/app/lib/auth/session';
import { createAuthenticatedAtlasMediaUrls } from './media-grant';
import {
  createAtlasImportThumbnailPath,
  createAtlasMediaPath,
} from './media-policy';
import type {
  AtlasImportBatch,
  AtlasImportItemStatus,
  AtlasImportStatus,
  AtlasImportSourceMimeType,
  AtlasImportLocationSource,
  AtlasImportDateSource,
  AtlasImportPlaceSource,
} from './import-definitions';
import { atlasImportBatchIdSchema } from './import-validation';

type ImportBatchRow = {
  id: string;
  client_request_id: string;
  status: AtlasImportStatus;
  version: number;
  chapter_title: string;
  chapter_introduction: string;
  cover_client_item_id: string | null;
  created_at: Date | string;
  updated_at: Date | string;
  completed_at: Date | string | null;
};

type ImportItemRow = {
  id: string;
  client_item_id: string;
  entry_id: string;
  expected_media_id: string;
  position: number;
  status: AtlasImportItemStatus;
  title: string;
  description: string;
  place_label: string | null;
  place_name: string | null;
  place_locality: string | null;
  place_region: string | null;
  place_country: string | null;
  place_country_code: string | null;
  place_geocoder: string | null;
  place_geocoded_at: Date | string | null;
  visited_on: Date | string | null;
  latitude: number | string;
  longitude: number | string;
  location_source: AtlasImportLocationSource;
  date_source: AtlasImportDateSource;
  date_confirmed: boolean;
  place_source: AtlasImportPlaceSource;
  source_name: string;
  source_mime_type: AtlasImportSourceMimeType;
  source_byte_size: number | string;
  source_hash: string;
  source_width: number | null;
  source_height: number | null;
  media_width: number | null;
  media_height: number | null;
  prepared_byte_size: number | null;
  thumbnail_byte_size: number | null;
  uploaded_at: Date | string | null;
  media_storage_path: string | null;
  media_thumbnail_path: string | null;
  media_mime_type: string | null;
};

function toIsoString(value: Date | string) {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

function toNullableIsoString(value: Date | string | null) {
  return value ? toIsoString(value) : null;
}

function toDateString(value: Date | string | null) {
  if (!value) return null;
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value).slice(0, 10);
}

export async function loadAtlasImportBatchForUser(
  userId: string,
  batchId: string,
): Promise<AtlasImportBatch | null> {
  const client = await db.connect();
  try {
    await client.query(
      'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
    );
    const batchResult = await client.query<ImportBatchRow>(
      `
      SELECT
        id,
        client_request_id,
        status,
        version,
        chapter_title,
        chapter_introduction,
        cover_client_item_id,
        created_at,
        updated_at,
        completed_at
      FROM atlas_import_batches
      WHERE id = $1
        AND user_id = $2
      LIMIT 1
    `,
      [batchId, userId],
    );
    const batch = batchResult.rows[0];
    if (!batch) {
      await client.query('ROLLBACK');
      return null;
    }
    const itemsResult = await client.query<ImportItemRow>(
      `
      SELECT
        item.id,
        item.client_item_id,
        item.entry_id,
        item.expected_media_id,
        item.position,
        item.status,
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
        ST_Y(entry.location::geometry)::float8 AS latitude,
        ST_X(entry.location::geometry)::float8 AS longitude,
        item.location_source,
        item.date_source,
        item.date_confirmed,
        item.place_source,
        item.source_name,
        item.source_mime_type,
        item.source_byte_size,
        item.source_hash,
        item.source_width,
        item.source_height,
        item.media_width,
        item.media_height,
        item.prepared_byte_size,
        item.thumbnail_byte_size,
        item.uploaded_at,
        media.storage_path AS media_storage_path,
        media.thumbnail_path AS media_thumbnail_path,
        media.mime_type AS media_mime_type
      FROM atlas_import_items AS item
      INNER JOIN atlas_entries AS entry
        ON entry.id = item.entry_id
        AND entry.user_id = item.user_id
      LEFT JOIN atlas_media AS media
        ON media.id = item.expected_media_id
        AND media.entry_id = item.entry_id
        AND media.user_id = item.user_id
      WHERE item.batch_id = $1
        AND item.user_id = $2
      ORDER BY item.position
    `,
      [batchId, userId],
    );
    await client.query('COMMIT');

    return {
      id: batch.id,
      clientRequestId: batch.client_request_id,
      status: batch.status,
      version: batch.version,
      chapterTitle: batch.chapter_title,
      chapterIntroduction: batch.chapter_introduction,
      coverClientItemId: batch.cover_client_item_id,
      items: itemsResult.rows.map((row) => {
        const pathname =
          row.media_storage_path ??
          createAtlasMediaPath(
            row.entry_id,
            row.expected_media_id,
            'image/jpeg',
          );
        const thumbnailPathname =
          row.media_thumbnail_path ??
          createAtlasImportThumbnailPath(row.entry_id, row.expected_media_id);
        const mediaUrls =
          row.media_storage_path &&
          row.media_thumbnail_path &&
          row.media_mime_type
            ? createAuthenticatedAtlasMediaUrls(
                {
                  id: row.expected_media_id,
                  entryId: row.entry_id,
                  storagePath: row.media_storage_path,
                  thumbnailPath: row.media_thumbnail_path,
                  mimeType: row.media_mime_type,
                },
                userId,
              )
            : null;

        return {
          id: row.id,
          clientItemId: row.client_item_id,
          entryId: row.entry_id,
          mediaId: row.expected_media_id,
          position: row.position,
          status: row.status,
          title: row.title,
          description: row.description,
          placeLabel: row.place_label ?? '',
          placeName: row.place_name,
          placeLocality: row.place_locality,
          placeRegion: row.place_region,
          placeCountry: row.place_country,
          placeCountryCode: row.place_country_code?.trim() || null,
          placeGeocoder: row.place_geocoder,
          placeGeocodedAt: toNullableIsoString(row.place_geocoded_at),
          visitedOn: toDateString(row.visited_on),
          latitude: Number(row.latitude),
          longitude: Number(row.longitude),
          locationSource: row.location_source,
          dateSource: row.date_source,
          dateConfirmed: row.date_confirmed,
          placeSource: row.place_source,
          sourceName: row.source_name,
          sourceMimeType: row.source_mime_type,
          sourceByteSize: Number(row.source_byte_size),
          sourceHash: row.source_hash.trim(),
          sourceWidth: row.source_width,
          sourceHeight: row.source_height,
          mediaWidth: row.media_width,
          mediaHeight: row.media_height,
          preparedByteSize: row.prepared_byte_size,
          thumbnailByteSize: row.thumbnail_byte_size,
          pathname,
          thumbnailPathname,
          thumbnailUrl: mediaUrls?.thumbnailUrl ?? null,
          uploadedAt: toNullableIsoString(row.uploaded_at),
        };
      }),
      createdAt: toIsoString(batch.created_at),
      updatedAt: toIsoString(batch.updated_at),
      completedAt: toNullableIsoString(batch.completed_at),
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function getAtlasImportBatchData(batchId: string) {
  const parsed = atlasImportBatchIdSchema.safeParse(batchId);
  if (!parsed.success) return null;

  const session = await requireVerifiedSession();
  return loadAtlasImportBatchForUser(session.user.id, parsed.data);
}

export async function getLatestOpenAtlasImportBatchData() {
  const session = await requireVerifiedSession();
  const latest = await sql<{ id: string }>`
    SELECT id
    FROM atlas_import_batches
    WHERE user_id = ${session.user.id}
      AND status IN ('uploading', 'ready')
    ORDER BY updated_at DESC, created_at DESC
    LIMIT 1
  `;
  const batchId = latest.rows[0]?.id;
  return batchId ? loadAtlasImportBatchForUser(session.user.id, batchId) : null;
}
