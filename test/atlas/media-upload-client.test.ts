/**
 * @jest-environment jsdom
 */

import { TextEncoder as NodeTextEncoder } from 'node:util';

import { upload } from '@vercel/blob/client';

import { uploadAtlasMedia } from '@/app/lib/atlas/media-upload-client';

jest.mock('@vercel/blob/client', () => ({ upload: jest.fn() }));

const pathname =
  'atlas/memories/f7c0bf19-59fc-49df-9bd7-ae405a69e49c/2df8f2d8-9fae-4c86-9578-3ed6179e262b.jpg';
const clientPayload = JSON.stringify({
  entryId: 'f7c0bf19-59fc-49df-9bd7-ae405a69e49c',
  mediaId: '2df8f2d8-9fae-4c86-9578-3ed6179e262b',
  pathname,
  thumbnailPathname:
    'atlas/memories/f7c0bf19-59fc-49df-9bd7-ae405a69e49c/2df8f2d8-9fae-4c86-9578-3ed6179e262b.thumbnail.webp',
});

describe('Atlas media upload client', () => {
  const originalAdapter = process.env.NEXT_PUBLIC_E2E_MEDIA_STORAGE_ADAPTER;
  const originalTextEncoder = global.TextEncoder;

  beforeAll(() => {
    Object.defineProperty(global, 'TextEncoder', {
      configurable: true,
      value: NodeTextEncoder,
    });
  });

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_E2E_MEDIA_STORAGE_ADAPTER;
    jest.mocked(upload).mockReset();
    global.fetch = jest.fn();
  });

  afterAll(() => {
    Object.defineProperty(global, 'TextEncoder', {
      configurable: true,
      value: originalTextEncoder,
    });
    if (originalAdapter === undefined) {
      delete process.env.NEXT_PUBLIC_E2E_MEDIA_STORAGE_ADAPTER;
    } else {
      process.env.NEXT_PUBLIC_E2E_MEDIA_STORAGE_ADAPTER = originalAdapter;
    }
  });

  it('preserves the production Vercel Blob client upload contract', async () => {
    const body = new Blob(['photo'], { type: 'image/jpeg' });
    const onUploadProgress = jest.fn();
    jest.mocked(upload).mockResolvedValue({ pathname } as never);

    await expect(
      uploadAtlasMedia(pathname, body, {
        clientPayload,
        multipart: true,
        onUploadProgress,
      }),
    ).resolves.toEqual({ pathname });

    expect(upload).toHaveBeenCalledWith(pathname, body, {
      access: 'private',
      handleUploadUrl: '/api/atlas/media/upload',
      clientPayload,
      multipart: true,
      onUploadProgress,
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('uses the guarded same-origin PUT endpoint in filesystem E2E mode', async () => {
    process.env.NEXT_PUBLIC_E2E_MEDIA_STORAGE_ADAPTER = 'filesystem';
    const body = new Blob(['photo'], { type: 'image/jpeg' });
    const onUploadProgress = jest.fn();
    jest.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ pathname }),
    } as Response);

    await expect(
      uploadAtlasMedia(pathname, body, {
        clientPayload,
        multipart: true,
        onUploadProgress,
      }),
    ).resolves.toEqual({ pathname });

    expect(upload).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      `/api/atlas/media/upload?pathname=${encodeURIComponent(pathname)}`,
      expect.objectContaining({
        method: 'PUT',
        credentials: 'same-origin',
        body,
      }),
    );
    const requestOptions = jest.mocked(fetch).mock.calls[0][1];
    expect(requestOptions?.headers).toEqual(
      expect.objectContaining({
        'Content-Type': 'image/jpeg',
      }),
    );
    const encodedPayload = String(
      (requestOptions?.headers as Record<string, string>)[
        'X-Atlas-Upload-Payload'
      ],
    );
    expect(Buffer.from(encodedPayload, 'base64url').toString('utf8')).toBe(
      clientPayload,
    );
    expect(onUploadProgress).toHaveBeenNthCalledWith(1, {
      loaded: 0,
      total: body.size,
      percentage: 0,
    });
    expect(onUploadProgress).toHaveBeenNthCalledWith(2, {
      loaded: body.size,
      total: body.size,
      percentage: 100,
    });
  });

  it('does not report completion when the filesystem upload fails', async () => {
    process.env.NEXT_PUBLIC_E2E_MEDIA_STORAGE_ADAPTER = 'filesystem';
    const body = new Blob(['photo'], { type: 'image/jpeg' });
    const onUploadProgress = jest.fn();
    jest.mocked(fetch).mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Upload interrupted.' }),
    } as Response);

    await expect(
      uploadAtlasMedia(pathname, body, {
        clientPayload,
        multipart: false,
        onUploadProgress,
      }),
    ).rejects.toThrow('Upload interrupted.');
    expect(onUploadProgress).toHaveBeenCalledTimes(1);
  });
});
