import { generateKeyPairSync, sign } from 'node:crypto';

import { issueSignedToken } from '@vercel/blob';
import { handleUploadPresigned } from '@vercel/blob/client';

import { getVerifiedSession } from '@/app/lib/auth/session';
import { POST, PUT } from '@/app/api/atlas/media/upload/route';
import {
  getAtlasBlobAuthOptions,
  getAtlasBlobWebhookPublicKey,
  getE2EAtlasMediaStorageConfiguration,
  isE2EAtlasMediaStorageEnabled,
  putE2EAtlasMediaObject,
} from '@/app/lib/atlas/media-storage';
import {
  markAtlasMediaUploadCompleted,
  reserveAtlasMediaUploadVariant,
} from '@/app/lib/atlas/upload-intents';

jest.mock('@vercel/blob', () => ({ issueSignedToken: jest.fn() }));
jest.mock('@vercel/blob/client', () => ({
  handleUploadPresigned: jest.fn(),
}));
jest.mock('@/app/lib/auth/session', () => ({
  getVerifiedSession: jest.fn(),
}));
jest.mock('@/app/lib/atlas/media-storage', () => ({
  getAtlasBlobAuthOptions: jest.fn(),
  getAtlasBlobWebhookPublicKey: jest.fn(),
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
    jest.mocked(issueSignedToken).mockReset();
    jest.mocked(handleUploadPresigned).mockReset();
    jest.mocked(getVerifiedSession).mockReset();
    jest.mocked(getAtlasBlobAuthOptions).mockReset();
    jest.mocked(getAtlasBlobWebhookPublicKey).mockReset();
    jest.mocked(getE2EAtlasMediaStorageConfiguration).mockReset();
    jest.mocked(isE2EAtlasMediaStorageEnabled).mockReset();
    jest.mocked(putE2EAtlasMediaObject).mockReset();
    jest.mocked(markAtlasMediaUploadCompleted).mockReset();
    jest.mocked(reserveAtlasMediaUploadVariant).mockReset();
    jest.mocked(isE2EAtlasMediaStorageEnabled).mockReturnValue(false);
    jest.mocked(getAtlasBlobAuthOptions).mockReturnValue({
      storeId: 'atlas-store-id',
    });
    jest
      .mocked(getAtlasBlobWebhookPublicKey)
      .mockReturnValue('atlas-webhook-public-key');
    jest.mocked(issueSignedToken).mockResolvedValue({
      delegationToken: 'delegation-token',
      clientSigningToken: 'client-signing-token',
      validUntil: Date.now() + 60_000,
    });
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
        type: 'blob.generate-presigned-url',
        payload: { pathname, clientPayload, multipart: true },
      }),
    );

    expect(response.status).toBe(404);
    expect(getVerifiedSession).not.toHaveBeenCalled();
    expect(getAtlasBlobAuthOptions).not.toHaveBeenCalled();
    expect(handleUploadPresigned).not.toHaveBeenCalled();
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

  it('rejects presigned URL generation without a verified session', async () => {
    jest.mocked(getVerifiedSession).mockResolvedValue(null);

    const response = await POST(
      uploadRequest({
        type: 'blob.generate-presigned-url',
        payload: { pathname, clientPayload, multipart: true },
      }),
    );

    expect(response.status).toBe(401);
    expect(handleUploadPresigned).not.toHaveBeenCalled();
    expect(reserveAtlasMediaUploadVariant).not.toHaveBeenCalled();
  });

  it('rejects a payload that tries to mix two media UUIDs', async () => {
    jest.mocked(getVerifiedSession).mockResolvedValue({
      user: { id: '17d69b97-9d24-4e07-a461-271263c71c52' },
    } as never);
    const mismatchedThumbnail = `atlas/memories/${entryId}/40504744-8e58-49c8-b4e7-bcb029a96dc5.thumbnail.webp`;
    jest.mocked(handleUploadPresigned).mockImplementation(async (options) => {
      await options.getSignedToken(
        pathname,
        JSON.stringify({
          entryId,
          mediaId,
          pathname,
          thumbnailPathname: mismatchedThumbnail,
        }),
        true,
      );
      return {
        type: 'blob.generate-presigned-url',
        presignedUrlPayload: {} as never,
      };
    });

    const response = await POST(
      uploadRequest({
        type: 'blob.generate-presigned-url',
        payload: { pathname, clientPayload, multipart: true },
      }),
    );

    expect(response.status).toBe(400);
    expect(reserveAtlasMediaUploadVariant).not.toHaveBeenCalled();
  });

  it('reserves the immutable pair before issuing a scoped upload URL', async () => {
    const userId = '17d69b97-9d24-4e07-a461-271263c71c52';
    jest.mocked(getVerifiedSession).mockResolvedValue({
      user: { id: userId },
    } as never);
    let generatedOptions: Record<string, unknown> | undefined;
    jest.mocked(handleUploadPresigned).mockImplementation(async (options) => {
      generatedOptions = await options.getSignedToken(
        pathname,
        clientPayload,
        true,
      );
      return {
        type: 'blob.generate-presigned-url',
        presignedUrlPayload: {} as never,
      };
    });

    const response = await POST(
      uploadRequest({
        type: 'blob.generate-presigned-url',
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
    expect(issueSignedToken).toHaveBeenCalledWith({
      storeId: 'atlas-store-id',
      pathname,
      operations: ['put'],
      allowedContentTypes: ['image/jpeg', 'image/png', 'image/webp'],
      maximumSizeInBytes: 10 * 1024 * 1024,
      validUntil: expect.any(Number),
    });
    expect(generatedOptions).toMatchObject({
      token: expect.objectContaining({
        delegationToken: 'delegation-token',
      }),
      urlOptions: {
        allowOverwrite: false,
        addRandomSuffix: false,
        maximumSizeInBytes: 10 * 1024 * 1024,
      },
    });
    const urlOptions = generatedOptions?.urlOptions as
      Record<string, unknown> | undefined;
    expect(JSON.parse(String(urlOptions?.tokenPayload))).toMatchObject({
      userId,
      entryId,
      mediaId,
      pathname,
      thumbnailPathname,
      variant: 'original',
    });
  });

  it('completes the installed SDK presigned URL contract', async () => {
    const userId = '17d69b97-9d24-4e07-a461-271263c71c52';
    const actualClient = jest.requireActual<
      typeof import('@vercel/blob/client')
    >('@vercel/blob/client');
    const previousCallbackUrl = process.env.VERCEL_BLOB_CALLBACK_URL;
    process.env.VERCEL_BLOB_CALLBACK_URL = 'https://fieldatlas.test';
    jest
      .mocked(handleUploadPresigned)
      .mockImplementation(actualClient.handleUploadPresigned);
    jest.mocked(getVerifiedSession).mockResolvedValue({
      user: { id: userId },
    } as never);
    jest.mocked(issueSignedToken).mockImplementation(async (options) => {
      const validUntil = Number(options.validUntil);
      const delegationPayload = Buffer.from(
        JSON.stringify({
          storeId: 'atlasstore12345',
          pathname: options.pathname,
          operations: options.operations,
          validUntil,
          allowedContentTypes: options.allowedContentTypes,
          maximumSizeInBytes: options.maximumSizeInBytes,
        }),
      ).toString('base64url');
      return {
        delegationToken: `${delegationPayload}.server-signature`,
        clientSigningToken: Buffer.from('contract-signing-key').toString(
          'base64url',
        ),
        validUntil,
      };
    });

    try {
      const response = await POST(
        uploadRequest({
          type: 'blob.generate-presigned-url',
          payload: { pathname, clientPayload, multipart: true },
        }),
      );

      expect(response.status).toBe(200);
      const responseBody = await response.json();
      expect(responseBody).toMatchObject({
        type: 'blob.generate-presigned-url',
        presignedUrlPayload: {
          delegationToken: expect.any(String),
          signature: expect.any(String),
          params: expect.objectContaining({
            'vercel-blob-allow-overwrite': 'false',
            'vercel-blob-add-random-suffix': 'false',
          }),
        },
      });
      const params = responseBody.presignedUrlPayload.params as Record<
        string,
        string
      >;
      expect(params).toMatchObject({
        'vercel-blob-allowed-content-types': 'image/jpeg,image/png,image/webp',
        'vercel-blob-cache-control-max-age': String(30 * 24 * 60 * 60),
        'vercel-blob-callback-url':
          'https://fieldatlas.test/api/atlas/media/upload',
        'vercel-blob-maximum-size-in-bytes': String(10 * 1024 * 1024),
      });
      // The installed SDK omits a redundant URL expiry when it exactly matches
      // the expiry already carried by the delegation token.
      expect(params['vercel-blob-valid-until']).toBeUndefined();
      expect(
        JSON.parse(params['vercel-blob-callback-token-payload']),
      ).toMatchObject({
        userId,
        entryId,
        mediaId,
        pathname,
        thumbnailPathname,
        variant: 'original',
      });
    } finally {
      if (previousCallbackUrl === undefined) {
        delete process.env.VERCEL_BLOB_CALLBACK_URL;
      } else {
        process.env.VERCEL_BLOB_CALLBACK_URL = previousCallbackUrl;
      }
    }
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
    jest.mocked(handleUploadPresigned).mockImplementation(async (options) => {
      generatedOptions = await options.getSignedToken(
        jpegThumbnailPathname,
        jpegPayload,
        false,
      );
      return {
        type: 'blob.generate-presigned-url',
        presignedUrlPayload: {} as never,
      };
    });

    const response = await POST(
      uploadRequest({
        type: 'blob.generate-presigned-url',
        payload: {
          pathname: jpegThumbnailPathname,
          clientPayload: jpegPayload,
          multipart: false,
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(generatedOptions).toMatchObject({
      urlOptions: {
        allowedContentTypes: ['image/jpeg'],
        maximumSizeInBytes: 2 * 1024 * 1024,
      },
    });
    expect(issueSignedToken).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: jpegThumbnailPathname,
        operations: ['put'],
        allowedContentTypes: ['image/jpeg'],
        maximumSizeInBytes: 2 * 1024 * 1024,
      }),
    );
    expect(reserveAtlasMediaUploadVariant).toHaveBeenCalledWith(
      expect.objectContaining({
        thumbnailPathname: jpegThumbnailPathname,
        variant: 'thumbnail',
      }),
    );
  });

  it('accepts SDK-verified completion callbacks without an Auth.js browser session', async () => {
    const userId = '17d69b97-9d24-4e07-a461-271263c71c52';
    const actualClient = jest.requireActual<
      typeof import('@vercel/blob/client')
    >('@vercel/blob/client');
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const webhookPublicKey = publicKey
      .export({ format: 'pem', type: 'spki' })
      .toString();
    const callbackBody = {
      type: 'blob.upload-completed',
      payload: {
        blob: { pathname },
        tokenPayload: JSON.stringify({
          userId,
          entryId,
          mediaId,
          pathname,
          thumbnailPathname,
          variant: 'original',
        }),
      },
    };
    const serializedBody = JSON.stringify(callbackBody);
    const signature = sign(
      null,
      Buffer.from(serializedBody),
      privateKey,
    ).toString('hex');
    jest
      .mocked(handleUploadPresigned)
      .mockImplementation(actualClient.handleUploadPresigned);
    jest.mocked(getAtlasBlobWebhookPublicKey).mockReturnValue(webhookPublicKey);

    const response = await POST(
      new Request('https://fieldatlas.test/api/atlas/media/upload', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-vercel-signature': signature,
        },
        body: serializedBody,
      }),
    );

    expect(response.status).toBe(200);
    expect(getVerifiedSession).not.toHaveBeenCalled();
    expect(getAtlasBlobWebhookPublicKey).toHaveBeenCalledTimes(1);
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

  it('rejects missing and tampered completion callback signatures', async () => {
    const actualClient = jest.requireActual<
      typeof import('@vercel/blob/client')
    >('@vercel/blob/client');
    const { privateKey, publicKey } = generateKeyPairSync('ed25519');
    const webhookPublicKey = publicKey
      .export({ format: 'pem', type: 'spki' })
      .toString();
    const callbackBody = {
      type: 'blob.upload-completed',
      payload: {
        blob: { pathname },
        tokenPayload: clientPayload,
      },
    };
    const serializedBody = JSON.stringify(callbackBody);
    const validSignature = sign(
      null,
      Buffer.from(serializedBody),
      privateKey,
    ).toString('hex');
    const tamperedSignature = `${validSignature[0] === '0' ? '1' : '0'}${validSignature.slice(1)}`;
    jest
      .mocked(handleUploadPresigned)
      .mockImplementation(actualClient.handleUploadPresigned);
    jest.mocked(getAtlasBlobWebhookPublicKey).mockReturnValue(webhookPublicKey);

    const missingSignatureResponse = await POST(
      new Request('https://fieldatlas.test/api/atlas/media/upload', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: serializedBody,
      }),
    );
    const tamperedSignatureResponse = await POST(
      new Request('https://fieldatlas.test/api/atlas/media/upload', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-vercel-signature': tamperedSignature,
        },
        body: serializedBody,
      }),
    );

    expect(missingSignatureResponse.status).toBe(400);
    expect(tamperedSignatureResponse.status).toBe(400);
    expect(getVerifiedSession).not.toHaveBeenCalled();
    expect(markAtlasMediaUploadCompleted).not.toHaveBeenCalled();
  });
});
