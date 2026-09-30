import { sql } from '@/app/lib/db';

import { getVerifiedSession } from '@/app/lib/auth/session';
import { verifyAtlasMediaGrant } from '@/app/lib/atlas/media-grant';
import { readAtlasMediaObject } from '@/app/lib/atlas/media-storage';
import { getAtlasThumbnailContentType } from '@/app/lib/atlas/media-policy';
import { atlasChapterIdSchema } from '@/app/lib/chapters/validation';

export const runtime = 'nodejs';
// Every request must repeat the live ownership/share check. `private` alone
// does not partition the browser cache by session and stale responses could
// otherwise outlive logout, deletion, or Journey unsharing.
const PRIVATE_MEDIA_CACHE = 'private, max-age=0, must-revalidate';
const PRIVATE_MEDIA_FALLBACK_CACHE = 'private, max-age=0, must-revalidate';

type MediaPathRow = {
  storage_path: string;
  thumbnail_path: string | null;
  mime_type: string;
};

function unavailableMediaResponse() {
  // A bodyless success avoids a noisy 404 while still firing the image error
  // event. ResilientMediaImage can then replace the element with the matching
  // visual treatment and an honest accessible name instead of leaving the
  // original photograph description on a generic server placeholder.
  return new Response(null, {
    status: 204,
    headers: {
      'Cache-Control': PRIVATE_MEDIA_FALLBACK_CACHE,
      'X-Atlas-Media-Fallback': 'unavailable',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

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
  // Original uploads can retain EXIF/location metadata and remain
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
    }

    // Grants avoid exposing storage metadata to the browser, but the live
    // association remains authoritative so logical deletion revokes access
    // before asynchronous Blob cleanup completes.
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

  if (!row) return new Response(null, { status: 404 });
  if (isSharedAccess && !row.thumbnail_path) {
    return new Response(null, { status: 404 });
  }

  const thumbnailPath = variant === 'thumbnail' ? row.thumbnail_path : null;
  let storagePath = thumbnailPath ?? row.storage_path;
  let contentType = thumbnailPath
    ? getAtlasThumbnailContentType(thumbnailPath)
    : row.mime_type;
  let usedOriginalFallback =
    variant === 'thumbnail' && !isSharedAccess && !thumbnailPath;
  if (!contentType) return new Response(null, { status: 404 });

  try {
    const readOptions = {
      ifNoneMatch: request.headers.get('if-none-match') ?? undefined,
    };
    let blob = await readAtlasMediaObject(storagePath, readOptions);

    if (!blob && !isSharedAccess && thumbnailPath) {
      storagePath = row.storage_path;
      contentType = row.mime_type;
      usedOriginalFallback = true;
      blob = await readAtlasMediaObject(storagePath, readOptions);
    }

    // The database association is valid but its private object has gone
    // missing. Every image surface replaces this quiet 204 with its polished,
    // accessible local fallback while the operator audit reports the finding.
    if (!blob) return unavailableMediaResponse();
    const cacheControl = usedOriginalFallback
      ? PRIVATE_MEDIA_FALLBACK_CACHE
      : PRIVATE_MEDIA_CACHE;
    const responseHeaders = new Headers({
      'Cache-Control': cacheControl,
      ETag: blob.blob.etag,
    });
    if (usedOriginalFallback) {
      responseHeaders.set('X-Atlas-Media-Fallback', 'original');
    }
    if (blob.statusCode === 304) {
      return new Response(null, {
        status: 304,
        headers: responseHeaders,
      });
    }

    responseHeaders.set('Content-Type', contentType);
    responseHeaders.set('Content-Length', String(blob.blob.size));
    responseHeaders.set('Content-Disposition', 'inline');
    responseHeaders.set('X-Content-Type-Options', 'nosniff');

    return new Response(blob.stream, {
      headers: responseHeaders,
    });
  } catch (error) {
    console.error('Atlas media delivery failed:', error);
    return new Response(null, { status: 404 });
  }
}
