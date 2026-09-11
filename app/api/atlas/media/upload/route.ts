import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { getVerifiedSession } from '@/app/lib/auth/session';
import {
  ATLAS_MEDIA_ALLOWED_TYPES,
  ATLAS_MEDIA_MAX_BYTES,
  ATLAS_THUMBNAIL_MAX_BYTES,
  areAtlasMediaPathsPaired,
  atlasMediaClientPayloadSchema,
  getAtlasMediaPathId,
  getAtlasThumbnailContentType,
  isAtlasMediaPath,
  isAtlasMediaUploadPath,
  isAtlasThumbnailPath,
} from '@/app/lib/atlas/media-policy';
import {
  getAtlasBlobToken,
  getE2EAtlasMediaStorageConfiguration,
  isE2EAtlasMediaStorageEnabled,
  putE2EAtlasMediaObject,
} from '@/app/lib/atlas/media-storage';
import {
  markAtlasMediaUploadCompleted,
  reserveAtlasMediaUploadVariant,
} from '@/app/lib/atlas/upload-intents';

export const runtime = 'nodejs';

type ValidatedUpload = {
  entryId: string;
  mediaId: string;
  pathname: string;
  thumbnailPathname: string;
  variant: 'original' | 'thumbnail';
  contentType: string | null;
  maximumSizeInBytes: number;
};

function validateUpload(pathname: string, payload: unknown): ValidatedUpload {
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
  const thumbnailContentType = isThumbnail
    ? getAtlasThumbnailContentType(pathname)
    : null;
  if ((!isThumbnail && !isOriginal) || (isThumbnail && !thumbnailContentType)) {
    throw new Error('Invalid upload request.');
  }

  return {
    ...parsed.data,
    variant: isThumbnail ? 'thumbnail' : 'original',
    contentType: thumbnailContentType,
    maximumSizeInBytes: isThumbnail
      ? ATLAS_THUMBNAIL_MAX_BYTES
      : ATLAS_MEDIA_MAX_BYTES,
  };
}

function decodeE2EClientPayload(value: string | null) {
  if (!value || value.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('Invalid upload request.');
  }
  try {
    const decoded = Buffer.from(value, 'base64url').toString('utf8');
    return JSON.parse(decoded) as unknown;
  } catch {
    throw new Error('Invalid upload request.');
  }
}

async function readBoundedBody(request: Request, maximumSizeInBytes: number) {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (
      !Number.isSafeInteger(parsedLength) ||
      parsedLength < 1 ||
      parsedLength > maximumSizeInBytes
    ) {
      throw new Error('Invalid upload size.');
    }
  }
  if (!request.body) throw new Error('Invalid upload request.');

  const chunks: Uint8Array[] = [];
  const reader = request.body.getReader();
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > maximumSizeInBytes) {
        await reader.cancel();
        throw new Error('Invalid upload size.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (byteLength < 1) throw new Error('Invalid upload size.');

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function isConfiguredSameOriginRequest(request: Request, appOrigin: string) {
  const expected = new URL(appOrigin);
  const requestHost =
    request.headers.get('host')?.trim().toLowerCase() ??
    new URL(request.url).host.toLowerCase();
  return (
    request.headers.get('origin') === expected.origin &&
    requestHost === expected.host.toLowerCase()
  );
}

export async function PUT(request: Request) {
  if (!isE2EAtlasMediaStorageEnabled()) {
    return new Response(null, { status: 404 });
  }

  try {
    const configuration = await getE2EAtlasMediaStorageConfiguration();
    const requestUrl = new URL(request.url);
    if (!isConfiguredSameOriginRequest(request, configuration.appOrigin)) {
      return new Response(null, { status: 404 });
    }

    const session = await getVerifiedSession();
    if (!session) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const pathname = requestUrl.searchParams.get('pathname') ?? '';
    const payload = decodeE2EClientPayload(
      request.headers.get('x-atlas-upload-payload'),
    );
    const upload = validateUpload(pathname, payload);
    const suppliedContentType =
      request.headers.get('content-type')?.split(';', 1)[0]?.trim() ?? '';
    if (
      upload.variant === 'thumbnail'
        ? suppliedContentType !== upload.contentType
        : !ATLAS_MEDIA_ALLOWED_TYPES.some(
            (contentType) => contentType === suppliedContentType,
          )
    ) {
      throw new Error('Invalid upload content type.');
    }

    await reserveAtlasMediaUploadVariant({
      userId: session.user.id,
      entryId: upload.entryId,
      mediaId: upload.mediaId,
      pathname: upload.pathname,
      thumbnailPathname: upload.thumbnailPathname,
      variant: upload.variant,
    });
    const bytes = await readBoundedBody(request, upload.maximumSizeInBytes);
    const stored = await putE2EAtlasMediaObject({
      pathname,
      contentType: suppliedContentType,
      bytes,
    });
    await markAtlasMediaUploadCompleted({
      tokenPayload: {
        userId: session.user.id,
        entryId: upload.entryId,
        mediaId: upload.mediaId,
        pathname: upload.pathname,
        thumbnailPathname: upload.thumbnailPathname,
        variant: upload.variant,
      },
      pathname,
    });

    return Response.json({ pathname: stored.pathname });
  } catch (error) {
    console.error('Atlas E2E media upload failed:', error);
    return Response.json(
      { error: 'The photo upload could not be completed.' },
      { status: 400 },
    );
  }
}

export async function POST(request: Request) {
  if (isE2EAtlasMediaStorageEnabled()) {
    return new Response(null, { status: 404 });
  }

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

        const upload = validateUpload(pathname, payload);
        const reservation = await reserveAtlasMediaUploadVariant({
          userId: session.user.id,
          entryId: upload.entryId,
          mediaId: upload.mediaId,
          pathname: upload.pathname,
          thumbnailPathname: upload.thumbnailPathname,
          variant: upload.variant,
        });

        return {
          allowedContentTypes:
            upload.variant === 'thumbnail' && upload.contentType
              ? [upload.contentType]
              : [...ATLAS_MEDIA_ALLOWED_TYPES],
          maximumSizeInBytes: upload.maximumSizeInBytes,
          validUntil: reservation.validUntil,
          addRandomSuffix: false,
          allowOverwrite: false,
          cacheControlMaxAge: 30 * 24 * 60 * 60,
          tokenPayload: JSON.stringify({
            userId: session.user.id,
            entryId: upload.entryId,
            mediaId: upload.mediaId,
            pathname: upload.pathname,
            thumbnailPathname: upload.thumbnailPathname,
            variant: upload.variant,
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
