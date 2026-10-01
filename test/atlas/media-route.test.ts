import { sql } from '@vercel/postgres';

import { GET } from '@/app/api/atlas/media/[mediaId]/route';
import { getVerifiedSession } from '@/app/lib/auth/session';
import { createAtlasMediaGrant } from '@/app/lib/atlas/media-grant';
import { readAtlasMediaObject } from '@/app/lib/atlas/media-storage';

jest.mock('@vercel/postgres', () => ({ sql: jest.fn() }));
jest.mock('@/app/lib/auth/session', () => ({
  getVerifiedSession: jest.fn(),
}));
jest.mock('@/app/lib/atlas/media-storage', () => ({
  readAtlasMediaObject: jest.fn(),
}));

const mediaId = 'bf69b9f1-4868-4206-abbf-df01e6a8d033';
const userId = 'a6fcbd7c-6d0f-4f76-b03b-5056af3d5d72';
const source = {
  id: mediaId,
  entryId: 'cfe81448-0a0d-4eb5-b015-b3e9d81baaaf',
  storagePath:
    'atlas/memories/cfe81448-0a0d-4eb5-b015-b3e9d81baaaf/bf69b9f1-4868-4206-abbf-df01e6a8d033.jpg',
  thumbnailPath:
    'atlas/memories/cfe81448-0a0d-4eb5-b015-b3e9d81baaaf/bf69b9f1-4868-4206-abbf-df01e6a8d033.thumbnail.webp',
  mimeType: 'image/jpeg',
};
const mediaRow = {
  storage_path: source.storagePath,
  thumbnail_path: source.thumbnailPath,
  mime_type: source.mimeType,
};

function storedMediaResponse({
  body = 'photo',
  etag = 'private-etag',
}: {
  body?: string;
  etag?: string;
} = {}) {
  return {
    statusCode: 200,
    blob: { etag, size: new TextEncoder().encode(body).byteLength },
    stream: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    }),
  } as never;
}

describe('authenticated Atlas media delivery', () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = 'test-auth-secret-with-enough-entropy';
    jest.mocked(sql).mockReset();
    jest.mocked(getVerifiedSession).mockReset();
    jest.mocked(readAtlasMediaObject).mockReset();
    jest.mocked(getVerifiedSession).mockResolvedValue({
      user: { id: userId },
    } as never);
    jest.mocked(sql).mockResolvedValue({ rows: [mediaRow] } as never);
    jest
      .mocked(readAtlasMediaObject)
      .mockImplementation(async () => storedMediaResponse());
  });

  it('revalidates live ownership before serving a session-bound grant', async () => {
    const grant = createAtlasMediaGrant(source, userId);
    const response = await GET(
      new Request(
        `https://fieldatlas.test/api/atlas/media/${mediaId}?variant=thumbnail&grant=${grant}`,
      ),
      { params: Promise.resolve({ mediaId }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe(
      'private, max-age=0, must-revalidate',
    );
    expect(getVerifiedSession).toHaveBeenCalledTimes(1);
    expect(sql).toHaveBeenCalledTimes(1);
    expect(readAtlasMediaObject).toHaveBeenCalledWith(source.thumbnailPath, {
      ifNoneMatch: undefined,
    });
  });

  it('rejects a valid grant after its media association is deleted', async () => {
    const grant = createAtlasMediaGrant(source, userId);
    jest.mocked(sql).mockResolvedValue({ rows: [] } as never);

    const response = await GET(
      new Request(
        `https://fieldatlas.test/api/atlas/media/${mediaId}?variant=thumbnail&grant=${grant}`,
      ),
      { params: Promise.resolve({ mediaId }) },
    );

    expect(response.status).toBe(404);
    expect(getVerifiedSession).toHaveBeenCalledTimes(1);
    expect(sql).toHaveBeenCalledTimes(1);
    expect(readAtlasMediaObject).not.toHaveBeenCalled();
  });

  it('rejects a tampered grant without falling back to a database lookup', async () => {
    const grant = createAtlasMediaGrant(source, userId);
    const response = await GET(
      new Request(
        `https://fieldatlas.test/api/atlas/media/${mediaId}?grant=${grant.slice(0, -1)}x`,
      ),
      { params: Promise.resolve({ mediaId }) },
    );

    expect(response.status).toBe(404);
    expect(sql).not.toHaveBeenCalled();
    expect(readAtlasMediaObject).not.toHaveBeenCalled();
  });

  it('rejects an owner grant without a live authenticated session', async () => {
    const grant = createAtlasMediaGrant(source, userId);
    jest.mocked(getVerifiedSession).mockResolvedValue(null);

    const response = await GET(
      new Request(
        `https://fieldatlas.test/api/atlas/media/${mediaId}?variant=thumbnail&grant=${grant}`,
      ),
      { params: Promise.resolve({ mediaId }) },
    );

    expect(response.status).toBe(404);
    expect(sql).not.toHaveBeenCalled();
    expect(readAtlasMediaObject).not.toHaveBeenCalled();
  });

  it("falls back to the owner's current original when its thumbnail object is missing", async () => {
    const grant = createAtlasMediaGrant(source, userId);
    jest
      .mocked(readAtlasMediaObject)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(
        storedMediaResponse({ body: 'original', etag: 'original-etag' }),
      );

    const response = await GET(
      new Request(
        `https://fieldatlas.test/api/atlas/media/${mediaId}?variant=thumbnail&grant=${grant}`,
        { headers: { 'If-None-Match': 'previous-thumbnail-etag' } },
      ),
      { params: Promise.resolve({ mediaId }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(source.mimeType);
    expect(response.headers.get('etag')).toBe('original-etag');
    expect(response.headers.get('cache-control')).toBe(
      'private, max-age=0, must-revalidate',
    );
    expect(response.headers.get('x-atlas-media-fallback')).toBe('original');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    await expect(response.text()).resolves.toBe('original');
    expect(readAtlasMediaObject).toHaveBeenNthCalledWith(
      1,
      source.thumbnailPath,
      { ifNoneMatch: 'previous-thumbnail-etag' },
    );
    expect(readAtlasMediaObject).toHaveBeenNthCalledWith(
      2,
      source.storagePath,
      { ifNoneMatch: 'previous-thumbnail-etag' },
    );
    expect(sql).toHaveBeenCalledTimes(1);
  });

  it('returns a quiet unavailable response when both owner objects are missing', async () => {
    const grant = createAtlasMediaGrant(source, userId);
    jest.mocked(readAtlasMediaObject).mockResolvedValue(null);

    const response = await GET(
      new Request(
        `https://fieldatlas.test/api/atlas/media/${mediaId}?variant=thumbnail&grant=${grant}`,
      ),
      { params: Promise.resolve({ mediaId }) },
    );

    expect(response.status).toBe(204);
    expect(response.headers.get('content-type')).toBeNull();
    expect(response.headers.get('cache-control')).toBe(
      'private, max-age=0, must-revalidate',
    );
    expect(response.headers.get('x-atlas-media-fallback')).toBe('unavailable');
    await expect(response.text()).resolves.toBe('');
    expect(readAtlasMediaObject).toHaveBeenNthCalledWith(
      1,
      source.thumbnailPath,
      { ifNoneMatch: undefined },
    );
    expect(readAtlasMediaObject).toHaveBeenNthCalledWith(
      2,
      source.storagePath,
      { ifNoneMatch: undefined },
    );
  });

  it('returns unavailable without reverse-falling back when an owner original is missing', async () => {
    const grant = createAtlasMediaGrant(source, userId);
    jest.mocked(readAtlasMediaObject).mockResolvedValueOnce(null);

    const response = await GET(
      new Request(
        `https://fieldatlas.test/api/atlas/media/${mediaId}?grant=${grant}`,
      ),
      { params: Promise.resolve({ mediaId }) },
    );

    expect(response.status).toBe(204);
    expect(response.headers.get('x-atlas-media-fallback')).toBe('unavailable');
    expect(readAtlasMediaObject).toHaveBeenCalledTimes(1);
    expect(readAtlasMediaObject).toHaveBeenCalledWith(source.storagePath, {
      ifNoneMatch: undefined,
    });
  });

  it('does not mask a thumbnail storage failure with an owner fallback', async () => {
    const grant = createAtlasMediaGrant(source, userId);
    const consoleError = jest
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    jest
      .mocked(readAtlasMediaObject)
      .mockRejectedValueOnce(new Error('Blob storage unavailable'));

    try {
      const response = await GET(
        new Request(
          `https://fieldatlas.test/api/atlas/media/${mediaId}?variant=thumbnail&grant=${grant}`,
        ),
        { params: Promise.resolve({ mediaId }) },
      );

      expect(response.status).toBe(404);
      expect(readAtlasMediaObject).toHaveBeenCalledTimes(1);
      expect(readAtlasMediaObject).toHaveBeenCalledWith(source.thumbnailPath, {
        ifNoneMatch: undefined,
      });
      expect(consoleError).toHaveBeenCalledWith(
        'Atlas media delivery failed:',
        expect.any(Error),
      );
    } finally {
      consoleError.mockRestore();
    }
  });

  it('keeps a database-backed compatibility path for older private URLs', async () => {
    jest.mocked(sql).mockResolvedValue({
      rows: [
        {
          storage_path: source.storagePath,
          thumbnail_path: source.thumbnailPath,
          mime_type: source.mimeType,
        },
      ],
    } as never);

    const response = await GET(
      new Request(`https://fieldatlas.test/api/atlas/media/${mediaId}`),
      { params: Promise.resolve({ mediaId }) },
    );

    expect(response.status).toBe(200);
    expect(getVerifiedSession).toHaveBeenCalledTimes(1);
    expect(sql).toHaveBeenCalledTimes(1);
    expect(readAtlasMediaObject).toHaveBeenCalledWith(source.storagePath, {
      ifNoneMatch: undefined,
    });
  });

  it('falls back through the database-backed owner path when a thumbnail object is missing', async () => {
    jest.mocked(sql).mockResolvedValue({
      rows: [
        {
          storage_path: source.storagePath,
          thumbnail_path: source.thumbnailPath,
          mime_type: source.mimeType,
        },
      ],
    } as never);
    jest
      .mocked(readAtlasMediaObject)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(storedMediaResponse({ body: 'original' }));

    const response = await GET(
      new Request(
        `https://fieldatlas.test/api/atlas/media/${mediaId}?variant=thumbnail`,
      ),
      { params: Promise.resolve({ mediaId }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(source.mimeType);
    await expect(response.text()).resolves.toBe('original');
    expect(readAtlasMediaObject).toHaveBeenNthCalledWith(
      1,
      source.thumbnailPath,
      { ifNoneMatch: undefined },
    );
    expect(readAtlasMediaObject).toHaveBeenNthCalledWith(
      2,
      source.storagePath,
      { ifNoneMatch: undefined },
    );
  });

  it('serves the owner original directly when a legacy row has no thumbnail path', async () => {
    jest.mocked(sql).mockResolvedValue({
      rows: [
        {
          storage_path: source.storagePath,
          thumbnail_path: null,
          mime_type: source.mimeType,
        },
      ],
    } as never);

    const response = await GET(
      new Request(
        `https://fieldatlas.test/api/atlas/media/${mediaId}?variant=thumbnail`,
      ),
      { params: Promise.resolve({ mediaId }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe(source.mimeType);
    expect(response.headers.get('cache-control')).toBe(
      'private, max-age=0, must-revalidate',
    );
    expect(response.headers.get('x-atlas-media-fallback')).toBe('original');
    expect(readAtlasMediaObject).toHaveBeenCalledTimes(1);
    expect(readAtlasMediaObject).toHaveBeenCalledWith(source.storagePath, {
      ifNoneMatch: undefined,
    });
  });

  it('preserves conditional responses while falling back to an owner original', async () => {
    const grant = createAtlasMediaGrant(source, userId);
    jest
      .mocked(readAtlasMediaObject)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        statusCode: 304,
        blob: { etag: 'original-etag', size: null },
        stream: null,
      } as never);

    const response = await GET(
      new Request(
        `https://fieldatlas.test/api/atlas/media/${mediaId}?variant=thumbnail&grant=${grant}`,
        { headers: { 'If-None-Match': 'original-etag' } },
      ),
      { params: Promise.resolve({ mediaId }) },
    );

    expect(response.status).toBe(304);
    expect(response.headers.get('etag')).toBe('original-etag');
    expect(response.headers.get('cache-control')).toBe(
      'private, max-age=0, must-revalidate',
    );
    expect(response.headers.get('x-atlas-media-fallback')).toBe('original');
    expect(readAtlasMediaObject).toHaveBeenNthCalledWith(
      2,
      source.storagePath,
      { ifNoneMatch: 'original-etag' },
    );
  });

  it('retains the revocation-aware database check for unlisted shares', async () => {
    const shareId = '7d7762db-25db-4887-8a87-04ce90df1db3';
    jest.mocked(sql).mockResolvedValue({
      rows: [
        {
          storage_path: source.storagePath,
          thumbnail_path: source.thumbnailPath,
          mime_type: source.mimeType,
        },
      ],
    } as never);

    const response = await GET(
      new Request(
        `https://fieldatlas.test/api/atlas/media/${mediaId}?variant=thumbnail&share=${shareId}`,
      ),
      { params: Promise.resolve({ mediaId }) },
    );

    expect(response.status).toBe(200);
    expect(getVerifiedSession).not.toHaveBeenCalled();
    expect(sql).toHaveBeenCalledTimes(1);
    expect(readAtlasMediaObject).toHaveBeenCalledWith(source.thumbnailPath, {
      ifNoneMatch: undefined,
    });
  });

  it('returns only the bodyless unavailable response when a shared thumbnail is missing', async () => {
    const shareId = '7d7762db-25db-4887-8a87-04ce90df1db3';
    jest.mocked(sql).mockResolvedValue({
      rows: [
        {
          storage_path: source.storagePath,
          thumbnail_path: source.thumbnailPath,
          mime_type: source.mimeType,
        },
      ],
    } as never);
    jest.mocked(readAtlasMediaObject).mockResolvedValueOnce(null);

    const response = await GET(
      new Request(
        `https://fieldatlas.test/api/atlas/media/${mediaId}?variant=thumbnail&share=${shareId}`,
      ),
      { params: Promise.resolve({ mediaId }) },
    );

    expect(response.status).toBe(204);
    expect(response.headers.get('content-type')).toBeNull();
    expect(response.headers.get('x-atlas-media-fallback')).toBe('unavailable');
    expect(getVerifiedSession).not.toHaveBeenCalled();
    expect(readAtlasMediaObject).toHaveBeenCalledTimes(1);
    expect(readAtlasMediaObject).toHaveBeenCalledWith(source.thumbnailPath, {
      ifNoneMatch: undefined,
    });
  });

  it('never reads an original for an unlisted share without a thumbnail path', async () => {
    const shareId = '7d7762db-25db-4887-8a87-04ce90df1db3';
    jest.mocked(sql).mockResolvedValue({
      rows: [
        {
          storage_path: source.storagePath,
          thumbnail_path: null,
          mime_type: source.mimeType,
        },
      ],
    } as never);

    const response = await GET(
      new Request(
        `https://fieldatlas.test/api/atlas/media/${mediaId}?variant=thumbnail&share=${shareId}`,
      ),
      { params: Promise.resolve({ mediaId }) },
    );

    expect(response.status).toBe(404);
    expect(getVerifiedSession).not.toHaveBeenCalled();
    expect(readAtlasMediaObject).not.toHaveBeenCalled();
  });

  it('serves imported JPEG thumbnails with the correct nosniff content type', async () => {
    const jpegSource = {
      ...source,
      thumbnailPath: source.thumbnailPath.replace(/\.webp$/, '.jpg'),
    };
    const grant = createAtlasMediaGrant(jpegSource, userId);
    jest.mocked(sql).mockResolvedValue({
      rows: [
        {
          ...mediaRow,
          thumbnail_path: jpegSource.thumbnailPath,
        },
      ],
    } as never);

    const response = await GET(
      new Request(
        `https://fieldatlas.test/api/atlas/media/${mediaId}?variant=thumbnail&grant=${grant}`,
      ),
      { params: Promise.resolve({ mediaId }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/jpeg');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(readAtlasMediaObject).toHaveBeenCalledWith(
      jpegSource.thumbnailPath,
      { ifNoneMatch: undefined },
    );
  });

  it('never exposes an original upload through an unlisted share', async () => {
    const shareId = '7d7762db-25db-4887-8a87-04ce90df1db3';
    const response = await GET(
      new Request(
        `https://fieldatlas.test/api/atlas/media/${mediaId}?share=${shareId}`,
      ),
      { params: Promise.resolve({ mediaId }) },
    );

    expect(response.status).toBe(404);
    expect(getVerifiedSession).not.toHaveBeenCalled();
    expect(sql).not.toHaveBeenCalled();
    expect(readAtlasMediaObject).not.toHaveBeenCalled();
  });
});
