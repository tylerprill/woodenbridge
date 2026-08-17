import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { getVerifiedSession } from '@/app/lib/auth/session';
import {
  ATLAS_MEDIA_ALLOWED_TYPES,
  ATLAS_MEDIA_MAX_BYTES,
  ATLAS_THUMBNAIL_MAX_BYTES,
  ATLAS_THUMBNAIL_MIME_TYPE,
  areAtlasMediaPathsPaired,
  atlasMediaClientPayloadSchema,
  getAtlasMediaPathId,
  isAtlasMediaPath,
  isAtlasMediaUploadPath,
  isAtlasThumbnailPath,
} from '@/app/lib/atlas/media-policy';
import { getAtlasBlobToken } from '@/app/lib/atlas/media-storage';
import {
  markAtlasMediaUploadCompleted,
  reserveAtlasMediaUploadVariant,
} from '@/app/lib/atlas/upload-intents';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as HandleUploadBody;
    const session =
      body.type === 'blob.generate-client-token'
        ? await getVerifiedSession()
        : null;

    if (body.type === 'blob.generate-client-token' && !session) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const response = await handleUpload({
      body,
      request,
      token: getAtlasBlobToken(),
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        if (!session) throw new Error('Unauthorized upload request.');

        let payload: unknown;
        try {
          payload = clientPayload ? JSON.parse(clientPayload) : null;
        } catch {
          throw new Error('Invalid upload request.');
        }

        const parsed = atlasMediaClientPayloadSchema.safeParse(payload);
        if (
          !parsed.success ||
          !isAtlasMediaUploadPath(pathname, parsed.data.entryId) ||
          (pathname !== parsed.data.pathname &&
            pathname !== parsed.data.thumbnailPathname) ||
          !areAtlasMediaPathsPaired(
            parsed.data.pathname,
            parsed.data.thumbnailPathname,
            parsed.data.entryId,
          ) ||
          getAtlasMediaPathId(parsed.data.pathname) !== parsed.data.mediaId
        ) {
          throw new Error('Invalid upload request.');
        }

        const isThumbnail = isAtlasThumbnailPath(pathname, parsed.data.entryId);
        const isOriginal = isAtlasMediaPath(pathname, parsed.data.entryId);
        if (!isThumbnail && !isOriginal) {
          throw new Error('Invalid upload request.');
        }
        const variant = isThumbnail ? 'thumbnail' : 'original';
        const reservation = await reserveAtlasMediaUploadVariant({
          userId: session.user.id,
          entryId: parsed.data.entryId,
          mediaId: parsed.data.mediaId,
          pathname: parsed.data.pathname,
          thumbnailPathname: parsed.data.thumbnailPathname,
          variant,
        });

        return {
          allowedContentTypes: isThumbnail
            ? [ATLAS_THUMBNAIL_MIME_TYPE]
            : [...ATLAS_MEDIA_ALLOWED_TYPES],
          maximumSizeInBytes: isThumbnail
            ? ATLAS_THUMBNAIL_MAX_BYTES
            : ATLAS_MEDIA_MAX_BYTES,
          validUntil: reservation.validUntil,
          addRandomSuffix: false,
          allowOverwrite: false,
          cacheControlMaxAge: 30 * 24 * 60 * 60,
          tokenPayload: JSON.stringify({
            userId: session.user.id,
            entryId: parsed.data.entryId,
            mediaId: parsed.data.mediaId,
            pathname: parsed.data.pathname,
            thumbnailPathname: parsed.data.thumbnailPathname,
            variant,
          }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        let payload: unknown;
        try {
          payload = tokenPayload ? JSON.parse(tokenPayload) : null;
        } catch {
          throw new Error('Invalid upload callback.');
        }

        await markAtlasMediaUploadCompleted({
          tokenPayload: payload,
          pathname: blob.pathname,
        });
      },
    });

    return Response.json(response);
  } catch (error) {
    console.error('Atlas media upload authorization failed:', error);
    return Response.json(
      { error: 'The photo upload could not be authorized.' },
      { status: 400 },
    );
  }
}
