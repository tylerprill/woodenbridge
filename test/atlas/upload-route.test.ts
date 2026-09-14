import { handleUpload } from '@vercel/blob/client';

import { getVerifiedSession } from '@/app/lib/auth/session';
import { POST, PUT } from '@/app/api/atlas/media/upload/route';
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

jest.mock('@vercel/blob/client', () => ({ handleUpload: jest.fn() }));
jest.mock('@/app/lib/auth/session', () => ({
  getVerifiedSession: jest.fn(),
}));
jest.mock('@/app/lib/atlas/media-storage', () => ({
  getAtlasBlobToken: jest.fn(),
  getE2EAtlasMediaStorageConfiguration: jest.fn(),
  isE2EAtlasMediaStorageEnabled: jest.fn(),
  putE2EAtlasMediaObject: jest.fn(),
}));
jest.mock('@/app/lib/atlas/upload-intents', () => ({
  markAtlasMediaUploadCompleted: jest.fn(),
  reserveAtlasMediaUploadVariant: jest.fn(),
}));

const entryId = 'f7c0bf19-59fc-49df-9bd7-ae405a69e49c';
const mediaId = '2df8f2d8-9fae-4c86-9578-3ed6179e262b';
const pathname = `atlas/memories/${entryId}/${mediaId}.jpg`;
const thumbnailPathname = `atlas/memories/${entryId}/${mediaId}.thumbnail.webp`;
const clientPayload = JSON.stringify({
  entryId,
  mediaId,
  pathname,
  thumbnailPathname,
});

function uploadRequest(body: unknown) {
  return new Request('https://fieldatlas.test/api/atlas/media/upload', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function filesystemUploadRequest({
  body = new Uint8Array([1, 2, 3]),
  origin = 'http://127.0.0.1:3100',
  path = pathname,
  payload = clientPayload,
  contentType = 'image/jpeg',
}: {
  body?: BodyInit;
  origin?: string;
  path?: string;
  payload?: string;
  contentType?: string;
} = {}) {
  return new Request(
    `${origin}/api/atlas/media/upload?pathname=${encodeURIComponent(path)}`,
    {
      method: 'PUT',
      headers: {
        'content-type': contentType,
        origin,
        'x-atlas-upload-payload': Buffer.from(payload).toString('base64url'),
      },
      body,
    },
  );
}

describe('atlas Blob upload authorization route', () => {
  beforeEach(() => {
    jest.mocked(handleUpload).mockReset();
    jest.mocked(getVerifiedSession).mockReset();
    jest.mocked(getAtlasBlobToken).mockReset();
    jest.mocked(getE2EAtlasMediaStorageConfiguration).mockReset();
    jest.mocked(isE2EAtlasMediaStorageEnabled).mockReset();
    jest.mocked(putE2EAtlasMediaObject).mockReset();
    jest.mocked(markAtlasMediaUploadCompleted).mockReset();
    jest.mocked(reserveAtlasMediaUploadVariant).mockReset();
    jest.mocked(isE2EAtlasMediaStorageEnabled).mockReturnValue(false);
    jest.mocked(getAtlasBlobToken).mockReturnValue('test-blob-token');
    jest.mocked(getE2EAtlasMediaStorageConfiguration).mockResolvedValue({
      appOrigin: 'http://127.0.0.1:3100',
      root: '/tmp/field-atlas-e2e-media-test',
    });
    jest.mocked(putE2EAtlasMediaObject).mockImplementation(
      async (input) =>
        ({
          pathname: input.pathname,
        }) as never,
    );
    jest.mocked(reserveAtlasMediaUploadVariant).mockResolvedValue({
      validUntil: Date.now() + 60_000,
    });
  });

  it('keeps the filesystem upload endpoint unavailable without its explicit E2E flag', async () => {
    const response = await PUT(filesystemUploadRequest());

    expect(response.status).toBe(404);
    expect(getE2EAtlasMediaStorageConfiguration).not.toHaveBeenCalled();
    expect(getVerifiedSession).not.toHaveBeenCalled();
    expect(putE2EAtlasMediaObject).not.toHaveBeenCalled();
  });

  it('keeps the production Blob endpoint unavailable in filesystem mode', async () => {
    jest.mocked(isE2EAtlasMediaStorageEnabled).mockReturnValue(true);

    const response = await POST(
      uploadRequest({
        type: 'blob.generate-client-token',
        payload: { pathname, clientPayload, multipart: true },
      }),
    );

    expect(response.status).toBe(404);
    expect(getVerifiedSession).not.toHaveBeenCalled();
    expect(getAtlasBlobToken).not.toHaveBeenCalled();
    expect(handleUpload).not.toHaveBeenCalled();
  });

  it('rejects filesystem uploads outside the configured same origin', async () => {
    jest.mocked(isE2EAtlasMediaStorageEnabled).mockReturnValue(true);
    const request = filesystemUploadRequest();
    request.headers.set('origin', 'http://localhost:3100');

    const response = await PUT(request);

    expect(response.status).toBe(404);
    expect(getVerifiedSession).not.toHaveBeenCalled();
    expect(putE2EAtlasMediaObject).not.toHaveBeenCalled();
  });

  it('rejects a filesystem upload with a mismatched Host header', async () => {
    jest.mocked(isE2EAtlasMediaStorageEnabled).mockReturnValue(true);
    const request = filesystemUploadRequest();
    request.headers.set('host', 'localhost:3100');

    const response = await PUT(request);

    expect(response.status).toBe(404);
    expect(getVerifiedSession).not.toHaveBeenCalled();
    expect(putE2EAtlasMediaObject).not.toHaveBeenCalled();
  });

  it('requires an authenticated user for filesystem uploads', async () => {
    jest.mocked(isE2EAtlasMediaStorageEnabled).mockReturnValue(true);
    jest.mocked(getVerifiedSession).mockResolvedValue(null);

    const response = await PUT(filesystemUploadRequest());

    expect(response.status).toBe(401);
    expect(reserveAtlasMediaUploadVariant).not.toHaveBeenCalled();
    expect(putE2EAtlasMediaObject).not.toHaveBeenCalled();
  });

  it('writes and marks an authenticated filesystem upload in order', async () => {
    const userId = '17d69b97-9d24-4e07-a461-271263c71c52';
    jest.mocked(isE2EAtlasMediaStorageEnabled).mockReturnValue(true);
    jest.mocked(getVerifiedSession).mockResolvedValue({
      user: { id: userId },
    } as never);

    const response = await PUT(filesystemUploadRequest());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ pathname });
    expect(reserveAtlasMediaUploadVariant).toHaveBeenCalledWith({
      userId,
      entryId,
      mediaId,
      pathname,
      thumbnailPathname,
      variant: 'original',
    });
    expect(putE2EAtlasMediaObject).toHaveBeenCalledWith({
      pathname,
      contentType: 'image/jpeg',
      bytes: new Uint8Array([1, 2, 3]),
    });
    expect(markAtlasMediaUploadCompleted).toHaveBeenCalledWith({
      tokenPayload: {
        userId,
        entryId,
        mediaId,
        pathname,
        thumbnailPathname,
        variant: 'original',
      },
      pathname,
    });
    expect(
      jest.mocked(reserveAtlasMediaUploadVariant).mock.invocationCallOrder[0],
    ).toBeLessThan(
      jest.mocked(putE2EAtlasMediaObject).mock.invocationCallOrder[0],
    );
    expect(
      jest.mocked(putE2EAtlasMediaObject).mock.invocationCallOrder[0],
    ).toBeLessThan(
      jest.mocked(markAtlasMediaUploadCompleted).mock.invocationCallOrder[0],
    );
  });

  it('rejects an unpaired payload before reserving or writing bytes', async () => {
    const mismatchedThumbnail = `atlas/memories/${entryId}/40504744-8e58-49c8-b4e7-bcb029a96dc5.thumbnail.webp`;
    jest.mocked(isE2EAtlasMediaStorageEnabled).mockReturnValue(true);
    jest.mocked(getVerifiedSession).mockResolvedValue({
      user: { id: '17d69b97-9d24-4e07-a461-271263c71c52' },
    } as never);

    const response = await PUT(
      filesystemUploadRequest({
        payload: JSON.stringify({
          entryId,
          mediaId,
          pathname,
          thumbnailPathname: mismatchedThumbnail,
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(reserveAtlasMediaUploadVariant).not.toHaveBeenCalled();
    expect(putE2EAtlasMediaObject).not.toHaveBeenCalled();
  });

  it('enforces the thumbnail content type before reserving storage', async () => {
    jest.mocked(isE2EAtlasMediaStorageEnabled).mockReturnValue(true);
    jest.mocked(getVerifiedSession).mockResolvedValue({
      user: { id: '17d69b97-9d24-4e07-a461-271263c71c52' },
    } as never);

    const response = await PUT(
      filesystemUploadRequest({
        path: thumbnailPathname,
        contentType: 'image/jpeg',
      }),
    );

    expect(response.status).toBe(400);
    expect(reserveAtlasMediaUploadVariant).not.toHaveBeenCalled();
    expect(putE2EAtlasMediaObject).not.toHaveBeenCalled();
  });

  it('rejects token generation without a verified session', async () => {
    jest.mocked(getVerifiedSession).mockResolvedValue(null);

    const response = await POST(
      uploadRequest({
        type: 'blob.generate-client-token',
        payload: { pathname, clientPayload, multipart: true },
      }),
    );

    expect(response.status).toBe(401);
    expect(handleUpload).not.toHaveBeenCalled();
    expect(reserveAtlasMediaUploadVariant).not.toHaveBeenCalled();
  });

  it('rejects a payload that tries to mix two media UUIDs', async () => {
    jest.mocked(getVerifiedSession).mockResolvedValue({
      user: { id: '17d69b97-9d24-4e07-a461-271263c71c52' },
    } as never);
    const mismatchedThumbnail = `atlas/memories/${entryId}/40504744-8e58-49c8-b4e7-bcb029a96dc5.thumbnail.webp`;
    jest.mocked(handleUpload).mockImplementation(async (options) => {
      await options.onBeforeGenerateToken(
        pathname,
        JSON.stringify({
          entryId,
          mediaId,
          pathname,
          thumbnailPathname: mismatchedThumbnail,
        }),
        true,
      );
      return { type: 'blob.generate-client-token', clientToken: 'unused' };
    });

    const response = await POST(
      uploadRequest({
        type: 'blob.generate-client-token',
        payload: { pathname, clientPayload, multipart: true },
      }),
    );

    expect(response.status).toBe(400);
    expect(reserveAtlasMediaUploadVariant).not.toHaveBeenCalled();
  });

  it('reserves the immutable pair before authorizing a variant', async () => {
    const userId = '17d69b97-9d24-4e07-a461-271263c71c52';
    jest.mocked(getVerifiedSession).mockResolvedValue({
      user: { id: userId },
    } as never);
    let generatedOptions: Record<string, unknown> | undefined;
    jest.mocked(handleUpload).mockImplementation(async (options) => {
      generatedOptions = await options.onBeforeGenerateToken(
        pathname,
        clientPayload,
        true,
      );
      return { type: 'blob.generate-client-token', clientToken: 'safe-token' };
    });

    const response = await POST(
      uploadRequest({
        type: 'blob.generate-client-token',
        payload: { pathname, clientPayload, multipart: true },
      }),
    );

    expect(response.status).toBe(200);
    expect(reserveAtlasMediaUploadVariant).toHaveBeenCalledWith({
      userId,
      entryId,
      mediaId,
      pathname,
      thumbnailPathname,
      variant: 'original',
    });
    expect(generatedOptions).toMatchObject({
      allowOverwrite: false,
      addRandomSuffix: false,
      maximumSizeInBytes: 10 * 1024 * 1024,
    });
    expect(JSON.parse(String(generatedOptions?.tokenPayload))).toMatchObject({
      userId,
      entryId,
      mediaId,
      pathname,
      thumbnailPathname,
      variant: 'original',
    });
  });

  it('authorizes the iOS-safe JPEG thumbnail for a bulk import', async () => {
    const userId = '17d69b97-9d24-4e07-a461-271263c71c52';
    const jpegThumbnailPathname = `atlas/memories/${entryId}/${mediaId}.thumbnail.jpg`;
    const jpegPayload = JSON.stringify({
      entryId,
      mediaId,
      pathname,
      thumbnailPathname: jpegThumbnailPathname,
    });
    jest.mocked(getVerifiedSession).mockResolvedValue({
      user: { id: userId },
    } as never);
    let generatedOptions: Record<string, unknown> | undefined;
    jest.mocked(handleUpload).mockImplementation(async (options) => {
      generatedOptions = await options.onBeforeGenerateToken(
        jpegThumbnailPathname,
        jpegPayload,
        false,
      );
      return { type: 'blob.generate-client-token', clientToken: 'safe-token' };
    });

    const response = await POST(
      uploadRequest({
        type: 'blob.generate-client-token',
        payload: {
          pathname: jpegThumbnailPathname,
          clientPayload: jpegPayload,
          multipart: false,
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(generatedOptions).toMatchObject({
      allowedContentTypes: ['image/jpeg'],
      maximumSizeInBytes: 2 * 1024 * 1024,
    });
    expect(reserveAtlasMediaUploadVariant).toHaveBeenCalledWith(
      expect.objectContaining({
        thumbnailPathname: jpegThumbnailPathname,
        variant: 'thumbnail',
      }),
    );
  });

  it('accepts signed completion callbacks without an Auth.js browser session', async () => {
    const userId = '17d69b97-9d24-4e07-a461-271263c71c52';
    jest.mocked(handleUpload).mockImplementation(async (options) => {
      await options.onUploadCompleted?.({
        blob: { pathname } as never,
        tokenPayload: JSON.stringify({
          userId,
          entryId,
          mediaId,
          pathname,
          thumbnailPathname,
          variant: 'original',
        }),
      });
      return { type: 'blob.upload-completed', response: 'ok' };
    });

    const response = await POST(
      uploadRequest({
        type: 'blob.upload-completed',
        payload: {
          blob: { pathname },
          tokenPayload: '{}',
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(getVerifiedSession).not.toHaveBeenCalled();
    expect(markAtlasMediaUploadCompleted).toHaveBeenCalledWith({
      tokenPayload: {
        userId,
        entryId,
        mediaId,
        pathname,
        thumbnailPathname,
        variant: 'original',
      },
      pathname,
    });
  });
});
