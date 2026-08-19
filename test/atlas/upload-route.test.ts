import { handleUpload } from '@vercel/blob/client';

import { getVerifiedSession } from '@/app/lib/auth/session';
import { POST } from '@/app/api/atlas/media/upload/route';
import {
  markAtlasMediaUploadCompleted,
  reserveAtlasMediaUploadVariant,
} from '@/app/lib/atlas/upload-intents';

jest.mock('@vercel/blob/client', () => ({ handleUpload: jest.fn() }));
jest.mock('@/app/lib/auth/session', () => ({
  getVerifiedSession: jest.fn(),
}));
jest.mock('@/app/lib/atlas/media-storage', () => ({
  getAtlasBlobToken: () => 'test-blob-token',
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

describe('atlas Blob upload authorization route', () => {
  beforeEach(() => {
    jest.mocked(handleUpload).mockReset();
    jest.mocked(getVerifiedSession).mockReset();
    jest.mocked(markAtlasMediaUploadCompleted).mockReset();
    jest.mocked(reserveAtlasMediaUploadVariant).mockReset();
    jest.mocked(reserveAtlasMediaUploadVariant).mockResolvedValue({
      validUntil: Date.now() + 60_000,
    });
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
