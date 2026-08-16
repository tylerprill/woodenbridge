'use server';

import { del } from '@vercel/blob';
import { db, sql } from '@vercel/postgres';
import { revalidatePath } from 'next/cache';

import { requireVerifiedSession } from '@/app/lib/auth/session';
import type {
  AtlasActionResult,
  AtlasDraftInput,
  AtlasEntry,
  AtlasEntryUpdateInput,
  AtlasViewInput,
} from '@/app/lib/atlas/definitions';
import { reverseGeocodeAtlasPlace } from '@/app/lib/atlas/geocoding';
import type { AtlasPlaceContext } from '@/app/lib/atlas/place';
import { type AtlasEntryRow, toAtlasEntry } from '@/app/lib/atlas/rows';
import { getAtlasBlobToken } from '@/app/lib/atlas/media-storage';
import {
  atlasDraftSchema,
  atlasEntryIdSchema,
  atlasEntryUpdateSchema,
  atlasViewSchema,
} from '@/app/lib/atlas/validation';

const ENTRY_COLUMNS = `
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
`;

function failed(message = 'We could not save that change. Please try again.') {
  return { ok: false, error: 'failed', message } as const;
}

export async function createAtlasDraftAction(
  input: AtlasDraftInput,
): Promise<AtlasActionResult<AtlasEntry>> {
  const session = await requireVerifiedSession();
  const parsed = atlasDraftSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid',
      message: 'That location is outside the atlas.',
    };
  }

  const { clientRequestId, latitude, longitude } = parsed.data;
  const client = await db.connect();

  try {
    await client.query('BEGIN');
    const inserted = await client.query<AtlasEntryRow>(
      `
        INSERT INTO atlas_entries (
          user_id,
          client_request_id,
          location,
          title,
          record_state
        )
        VALUES (
          $1,
          $2,
          ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography,
          '',
          'draft'
        )
        ON CONFLICT (user_id, client_request_id)
        DO UPDATE SET client_request_id = EXCLUDED.client_request_id
        RETURNING ${ENTRY_COLUMNS}
      `,
      [session.user.id, clientRequestId, longitude, latitude],
    );
    await client.query('COMMIT');

    revalidatePath('/dashboard');
    return { ok: true, data: toAtlasEntry(inserted.rows[0]) };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('Atlas draft creation failed:', error);
    return failed('The atlas could not place that pin. Please try again.');
  } finally {
    client.release();
  }
}

export async function updateAtlasEntryAction(
  input: AtlasEntryUpdateInput,
): Promise<AtlasActionResult<AtlasEntry>> {
  const session = await requireVerifiedSession();
  const parsed = atlasEntryUpdateSchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error: 'invalid',
      message:
        parsed.error.issues[0]?.message ?? 'Check the memory and try again.',
    };
  }

  const entry = parsed.data;
  const client = await db.connect();

  try {
    const result = await client.query<AtlasEntryRow>(
      `
        UPDATE atlas_entries
        SET
          title = $1,
          description = $2,
          place_label = NULLIF($3, ''),
          visited_on = $4::date,
          journey_state = $5::atlas_journey_state,
          record_state = 'saved',
          version = version + 1,
          updated_at = NOW()
        WHERE id = $6
          AND user_id = $7
          AND version = $8
          AND deleted_at IS NULL
        RETURNING ${ENTRY_COLUMNS}
      `,
      [
        entry.title,
        entry.description,
        entry.placeLabel,
        entry.visitedOn,
        entry.journeyState,
        entry.id,
        session.user.id,
        entry.version,
      ],
    );

    if (!result.rows[0]) {
      const current = await sql<{ version: number }>`
        SELECT version
        FROM atlas_entries
        WHERE id = ${entry.id}
          AND user_id = ${session.user.id}
          AND deleted_at IS NULL
        LIMIT 1
      `;

      return current.rows[0]
        ? {
            ok: false,
            error: 'conflict',
            message: 'This memory changed elsewhere. Refresh it and try again.',
          }
        : {
            ok: false,
            error: 'not-found',
            message: 'That memory no longer exists.',
          };
    }

    revalidatePath('/dashboard');
    revalidatePath('/dashboard/users');
    revalidatePath('/dashboard/journal');
    revalidatePath(`/dashboard/card/${entry.id}`);
    return { ok: true, data: toAtlasEntry(result.rows[0]) };
  } catch (error) {
    console.error('Atlas entry update failed:', error);
    return failed();
  } finally {
    client.release();
  }
}

export async function resolveAtlasPlaceAction(
  entryId: string,
): Promise<AtlasActionResult<{ entryId: string; place: AtlasPlaceContext }>> {
  const session = await requireVerifiedSession();
  const parsed = atlasEntryIdSchema.safeParse(entryId);

  if (!parsed.success) {
    return { ok: false, error: 'invalid', message: 'Invalid memory.' };
  }

  const existing = await sql<{
    id: string;
    latitude: number | string;
    longitude: number | string;
    place_name: string | null;
    place_locality: string | null;
    place_region: string | null;
    place_country: string | null;
    place_country_code: string | null;
    place_geocoder: string | null;
    place_geocoded_at: Date | string | null;
  }>`
    SELECT
      id,
      ST_Y(location::geometry)::float8 AS latitude,
      ST_X(location::geometry)::float8 AS longitude,
      place_name,
      place_locality,
      place_region,
      place_country,
      place_country_code,
      place_geocoder,
      place_geocoded_at
    FROM atlas_entries
    WHERE id = ${parsed.data}
      AND user_id = ${session.user.id}
      AND deleted_at IS NULL
    LIMIT 1
  `;

  const row = existing.rows[0];
  if (!row) {
    return {
      ok: false,
      error: 'not-found',
      message: 'That memory no longer exists.',
    };
  }

  if (row.place_name && row.place_geocoder && row.place_geocoded_at) {
    return {
      ok: true,
      data: {
        entryId: row.id,
        place: {
          placeName: row.place_name,
          locality: row.place_locality,
          region: row.place_region,
          country: row.place_country,
          countryCode: row.place_country_code?.trim() || null,
          geocoder: row.place_geocoder,
          geocodedAt:
            row.place_geocoded_at instanceof Date
              ? row.place_geocoded_at.toISOString()
              : new Date(row.place_geocoded_at).toISOString(),
        },
      },
    };
  }

  const place = await reverseGeocodeAtlasPlace({
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
  });

  if (!place) {
    return {
      ok: false,
      error: 'failed',
      message:
        'We could not identify this place yet. You can name it yourself.',
    };
  }

  const updated = await sql<{ id: string }>`
    UPDATE atlas_entries
    SET
      place_name = ${place.placeName},
      place_locality = ${place.locality},
      place_region = ${place.region},
      place_country = ${place.country},
      place_country_code = ${place.countryCode},
      place_geocoder = ${place.geocoder},
      place_geocoded_at = ${place.geocodedAt}::timestamptz,
      updated_at = NOW()
    WHERE id = ${parsed.data}
      AND user_id = ${session.user.id}
      AND deleted_at IS NULL
    RETURNING id
  `;

  if (!updated.rows[0]) {
    return {
      ok: false,
      error: 'not-found',
      message: 'That memory no longer exists.',
    };
  }

  revalidatePath('/dashboard');
  revalidatePath('/dashboard/users');
  revalidatePath('/dashboard/journal');
  revalidatePath(`/dashboard/card/${parsed.data}`);
  return { ok: true, data: { entryId: updated.rows[0].id, place } };
}

export async function archiveAtlasEntryAction(
  entryId: string,
): Promise<AtlasActionResult<{ id: string }>> {
  const session = await requireVerifiedSession();
  const parsed = atlasEntryIdSchema.safeParse(entryId);

  if (!parsed.success) {
    return { ok: false, error: 'invalid', message: 'Invalid memory.' };
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const entry = await client.query<{ id: string }>(
      `
        SELECT id
        FROM atlas_entries
        WHERE id = $1
          AND user_id = $2
          AND deleted_at IS NULL
        FOR UPDATE
      `,
      [parsed.data, session.user.id],
    );

    if (!entry.rows[0]) {
      await client.query('ROLLBACK');
      return {
        ok: false,
        error: 'not-found',
        message: 'That memory no longer exists.',
      };
    }

    const media = await client.query<{ storage_path: string }>(
      `
        SELECT storage_path
        FROM atlas_media
        WHERE entry_id = $1
          AND user_id = $2
      `,
      [parsed.data, session.user.id],
    );
    const storagePaths = media.rows.map((row) => row.storage_path);

    if (storagePaths.length) {
      await del(storagePaths, { token: getAtlasBlobToken() });
      await client.query(
        'DELETE FROM atlas_media WHERE entry_id = $1 AND user_id = $2',
        [parsed.data, session.user.id],
      );
    }

    const result = await client.query<{ id: string }>(
      `
        UPDATE atlas_entries
        SET
          record_state = 'archived',
          deleted_at = NOW(),
          version = version + 1,
          updated_at = NOW()
        WHERE id = $1
          AND user_id = $2
          AND deleted_at IS NULL
        RETURNING id
      `,
      [parsed.data, session.user.id],
    );
    await client.query('COMMIT');

    revalidatePath('/dashboard');
    revalidatePath('/dashboard/users');
    revalidatePath('/dashboard/journal');
    revalidatePath(`/dashboard/card/${parsed.data}`);
    return { ok: true, data: result.rows[0] };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('Atlas entry archive failed:', error);
    return failed('The memory could not be removed. Please try again.');
  } finally {
    client.release();
  }
}

export async function saveAtlasViewAction(
  input: AtlasViewInput,
): Promise<AtlasActionResult<{ saved: true }>> {
  const session = await requireVerifiedSession();
  const parsed = atlasViewSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, error: 'invalid', message: 'Invalid atlas view.' };
  }

  const view = parsed.data;

  try {
    await sql`
      INSERT INTO atlas_preferences (
        user_id,
        latitude,
        longitude,
        zoom,
        bearing,
        pitch
      )
      VALUES (
        ${session.user.id},
        ${view.latitude},
        ${view.longitude},
        ${view.zoom},
        ${view.bearing},
        ${view.pitch}
      )
      ON CONFLICT (user_id)
      DO UPDATE SET
        latitude = EXCLUDED.latitude,
        longitude = EXCLUDED.longitude,
        zoom = EXCLUDED.zoom,
        bearing = EXCLUDED.bearing,
        pitch = EXCLUDED.pitch,
        updated_at = NOW()
    `;

    return { ok: true, data: { saved: true } };
  } catch (error) {
    console.error('Atlas view update failed:', error);
    return failed('The atlas view could not be remembered.');
  }
}
