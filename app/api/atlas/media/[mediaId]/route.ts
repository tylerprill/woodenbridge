import { get } from '@vercel/blob';
import { sql } from '@/app/lib/db';

import { getVerifiedSession } from '@/app/lib/auth/session';
import { verifyAtlasMediaGrant } from '@/app/lib/atlas/media-grant';
import { getAtlasBlobToken } from '@/app/lib/atlas/media-storage';
import { getAtlasThumbnailContentType } from '@/app/lib/atlas/media-policy';
import { atlasChapterIdSchema } from '@/app/lib/chapters/validation';

export const runtime = 'nodejs';
const PRIVATE_MEDIA_CACHE = 'private, max-age=300, stale-while-revalidate=3600';

type MediaPathRow = {
  storage_path: string;
  thumbnail_path: string | null;
  mime_type: string;
};

export async function GET(
  request: Request,
  context: { params: Promise<{ mediaId: string }> },
) {
  const searchParams = new URL(request.url).searchParams;
  const variant = searchParams.get('variant');
  if (variant && variant !== 'thumbnail') {
    return new Response(null, { status: 404 });
  }

  const { mediaId } = await context.params;
  const parsedShareId = atlasChapterIdSchema.safeParse(
    searchParams.get('share'),
  );
  const isSharedAccess = parsedShareId.success;

  // Unlisted chapter viewers receive only the canvas-transcoded derivative.
  // derivative. Original uploads can retain EXIF/location metadata and remain
  // available exclusively through an authenticated owner path.
  if (isSharedAccess && variant !== 'thumbnail') {
    return new Response(null, { status: 404 });
  }
  let row: MediaPathRow | undefined;

  if (parsedShareId.success) {
    const media = await sql<MediaPathRow>`
        SELECT media.storage_path, media.thumbnail_path, media.mime_type
        FROM atlas_media AS media
        INNER JOIN atlas_entries AS entry
          ON entry.id = media.entry_id
          AND entry.user_id = media.user_id
        INNER JOIN atlas_chapter_entries AS chapter_entry
          ON chapter_entry.entry_id = entry.id
          AND chapter_entry.user_id = entry.user_id
        INNER JOIN atlas_chapters AS chapter
          ON chapter.id = chapter_entry.chapter_id
          AND chapter.user_id = chapter_entry.user_id
        WHERE media.id = ${mediaId}
          AND chapter.share_id = ${parsedShareId.data}
          AND chapter.visibility = 'shared'
          AND entry.deleted_at IS NULL
        LIMIT 1
      `;
    row = media.rows[0];
  } else {
    const session = await getVerifiedSession();
    if (!session) return new Response(null, { status: 404 });

    const grant = searchParams.get('grant');
    if (grant !== null) {
      const grantedMedia = verifyAtlasMediaGrant(grant, {
        mediaId,
        userId: session.user.id,
      });
      if (!grantedMedia) return new Response(null, { status: 404 });
      row = {
        storage_path: grantedMedia.storagePath,
        thumbnail_path: grantedMedia.thumbnailPath,
        mime_type: grantedMedia.mimeType,
      };
    } else {
      const media = await sql<MediaPathRow>`
        SELECT media.storage_path, media.thumbnail_path, media.mime_type
        FROM atlas_media AS media
        INNER JOIN atlas_entries AS entry ON entry.id = media.entry_id
        WHERE media.id = ${mediaId}
          AND media.user_id = ${session.user.id}
          AND entry.user_id = ${session.user.id}
          AND entry.deleted_at IS NULL
        LIMIT 1
      `;
      row = media.rows[0];
    }
  }

  if (!row) return new Response(null, { status: 404 });
  if (isSharedAccess && !row.thumbnail_path) {
    return new Response(null, { status: 404 });
  }

  const thumbnailPath = variant === 'thumbnail' ? row.thumbnail_path : null;
  const storagePath = thumbnailPath ?? row.storage_path;
  const contentType = thumbnailPath
    ? getAtlasThumbnailContentType(thumbnailPath)
    : row.mime_type;
  if (!contentType) return new Response(null, { status: 404 });

  try {
    const blob = await get(storagePath, {
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
        'Content-Type': contentType,
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
