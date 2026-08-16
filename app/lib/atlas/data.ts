import 'server-only';

import { sql } from '@vercel/postgres';

import { requireVerifiedSession } from '@/app/lib/auth/session';
import type { AtlasData } from './definitions';
import {
  type AtlasEntryRow,
  type AtlasMediaRow,
  type AtlasViewRow,
  toAtlasEntry,
  toAtlasMedia,
  toAtlasView,
} from './rows';

export async function getAtlasData(): Promise<AtlasData> {
  const session = await requireVerifiedSession();
  const userId = session.user.id;

  const [entriesResult, mediaResult, viewResult] = await Promise.all([
    sql<AtlasEntryRow>`
      SELECT
        id,
        title,
        description,
        place_label,
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
    sql<AtlasMediaRow>`
      SELECT
        media.id,
        media.entry_id,
        media.mime_type,
        media.width,
        media.height,
        media.byte_size,
        media.alt_text,
        media.sort_order,
        media.created_at
      FROM atlas_media AS media
      INNER JOIN atlas_entries AS entry ON entry.id = media.entry_id
      WHERE media.user_id = ${userId}
        AND entry.user_id = ${userId}
        AND entry.deleted_at IS NULL
      ORDER BY media.entry_id, media.sort_order, media.created_at
    `,
    sql<AtlasViewRow>`
      SELECT latitude, longitude, zoom, bearing, pitch
      FROM atlas_preferences
      WHERE user_id = ${userId}
      LIMIT 1
    `,
  ]);

  const mediaByEntry = new Map<string, ReturnType<typeof toAtlasMedia>[]>();
  for (const row of mediaResult.rows) {
    const media = toAtlasMedia(row);
    const current = mediaByEntry.get(media.entryId) ?? [];
    current.push(media);
    mediaByEntry.set(media.entryId, current);
  }

  return {
    entries: entriesResult.rows.map((entry) =>
      toAtlasEntry(entry, mediaByEntry.get(entry.id) ?? []),
    ),
    view: toAtlasView(viewResult.rows[0]),
  };
}
