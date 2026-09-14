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

describe('authenticated Atlas media delivery', () => {
  beforeEach(() => {
    process.env.AUTH_SECRET = 'test-auth-secret-with-enough-entropy';
    jest.mocked(getVerifiedSession).mockResolvedValue({
      user: { id: userId },
    } as never);
    jest.mocked(readAtlasMediaObject).mockResolvedValue({
      statusCode: 200,
      blob: { etag: 'private-etag', size: 5 },
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('photo'));
          controller.close();
        },
      }),
    } as never);
  });

  it('uses a valid session-bound grant without a second ownership query', async () => {
    const grant = createAtlasMediaGrant(source, userId);
    const response = await GET(
      new Request(
        `https://fieldatlas.test/api/atlas/media/${mediaId}?variant=thumbnail&grant=${grant}`,
      ),
      { params: Promise.resolve({ mediaId }) },
    );

    expect(response.status).toBe(200);
    expect(getVerifiedSession).toHaveBeenCalledTimes(1);
    expect(sql).not.toHaveBeenCalled();
    expect(readAtlasMediaObject).toHaveBeenCalledWith(source.thumbnailPath, {
      ifNoneMatch: undefined,
    });
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

  it('serves imported JPEG thumbnails with the correct nosniff content type', async () => {
    const jpegSource = {
      ...source,
      thumbnailPath: source.thumbnailPath.replace(/\.webp$/, '.jpg'),
    };
    const grant = createAtlasMediaGrant(jpegSource, userId);

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
