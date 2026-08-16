import { get } from '@vercel/blob';
import { sql } from '@vercel/postgres';

import { getVerifiedSession } from '@/app/lib/auth/session';
import { getAtlasBlobToken } from '@/app/lib/atlas/media-storage';

export const runtime = 'nodejs';
const PRIVATE_MEDIA_CACHE = 'private, max-age=300, stale-while-revalidate=3600';

type MediaPathRow = {
  storage_path: string;
  mime_type: string;
};

export async function GET(
  request: Request,
  context: { params: Promise<{ mediaId: string }> },
) {
  const session = await getVerifiedSession();
  if (!session) return new Response(null, { status: 404 });

  const { mediaId } = await context.params;
  const media = await sql<MediaPathRow>`
    SELECT media.storage_path, media.mime_type
    FROM atlas_media AS media
    INNER JOIN atlas_entries AS entry ON entry.id = media.entry_id
    WHERE media.id = ${mediaId}
      AND media.user_id = ${session.user.id}
      AND entry.user_id = ${session.user.id}
      AND entry.deleted_at IS NULL
    LIMIT 1
  `;

  const row = media.rows[0];
  if (!row) return new Response(null, { status: 404 });

  try {
    const blob = await get(row.storage_path, {
      access: 'private',
      token: getAtlasBlobToken(),
      ifNoneMatch: request.headers.get('if-none-match') ?? undefined,
    });

    if (!blob) return new Response(null, { status: 404 });
    if (blob.statusCode === 304) {
      return new Response(null, {
        status: 304,
        headers: {
          ETag: blob.blob.etag,
          'Cache-Control': PRIVATE_MEDIA_CACHE,
        },
      });
    }

    return new Response(blob.stream, {
      headers: {
        'Content-Type': row.mime_type,
        'Content-Length': String(blob.blob.size),
        'Content-Disposition': 'inline',
        'Cache-Control': PRIVATE_MEDIA_CACHE,
        ETag: blob.blob.etag,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    console.error('Atlas media delivery failed:', error);
    return new Response(null, { status: 404 });
  }
}
