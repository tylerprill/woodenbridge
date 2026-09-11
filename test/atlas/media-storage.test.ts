import { randomUUID } from 'node:crypto';
import { chmod, lstat, mkdtemp, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BlobNotFoundError, del, get, head } from '@vercel/blob';

import {
  AtlasMediaStorageConflictError,
  deleteAtlasMediaObjects,
  getE2EAtlasMediaStorageConfiguration,
  headAtlasMediaObject,
  putE2EAtlasMediaObject,
  readAtlasMediaObject,
} from '@/app/lib/atlas/media-storage';

jest.mock('@vercel/blob', () => ({
  BlobNotFoundError: class MockBlobNotFoundError extends Error {},
  del: jest.fn(),
  get: jest.fn(),
  head: jest.fn(),
}));

const entryId = 'f7c0bf19-59fc-49df-9bd7-ae405a69e49c';
const mediaId = '2df8f2d8-9fae-4c86-9578-3ed6179e262b';
const pathname = `atlas/memories/${entryId}/${mediaId}.jpg`;
const environmentKeys = [
  'APP_URL',
  'ATLAS_BLOB_READ_WRITE_TOKEN',
  'AUTH_URL',
  'DATABASE_URL',
  'E2E_DATABASE_ADAPTER',
  'E2E_MEDIA_STORAGE_ADAPTER',
  'E2E_MEDIA_STORAGE_ROOT',
  'NEXT_PUBLIC_E2E_MEDIA_STORAGE_ADAPTER',
  'POSTGRES_URL',
  'RUNNER_TEMP',
  'VERCEL',
  'VERCEL_ENV',
] as const;

function filesystemEnvironment(
  root: string,
  overrides: Partial<NodeJS.ProcessEnv> = {},
): NodeJS.ProcessEnv {
  return {
    APP_URL: 'http://127.0.0.1:3100',
    AUTH_URL: 'http://127.0.0.1:3100',
    DATABASE_URL:
      'postgresql://field_atlas_e2e:secret@127.0.0.1:5432/field_atlas_e2e',
    E2E_DATABASE_ADAPTER: 'pg',
    E2E_MEDIA_STORAGE_ADAPTER: 'filesystem',
    E2E_MEDIA_STORAGE_ROOT: root,
    NEXT_PUBLIC_E2E_MEDIA_STORAGE_ADAPTER: 'filesystem',
    NODE_ENV: 'test',
    POSTGRES_URL:
      'postgresql://field_atlas_e2e:secret@127.0.0.1:5432/field_atlas_e2e',
    RUNNER_TEMP: tmpdir(),
    ...overrides,
  };
}

describe('isolated Atlas filesystem media storage', () => {
  const originalEnvironment = new Map<string, string | undefined>();
  const cleanupPaths = new Set<string>();

  beforeAll(() => {
    for (const key of environmentKeys) {
      originalEnvironment.set(key, process.env[key]);
    }
  });

  beforeEach(() => {
    for (const key of environmentKeys) delete process.env[key];
    jest.mocked(del).mockReset();
    jest.mocked(get).mockReset();
    jest.mocked(head).mockReset();
  });

  afterEach(async () => {
    for (const cleanupPath of Array.from(cleanupPaths)) {
      await rm(cleanupPath, { force: true, recursive: true });
    }
    cleanupPaths.clear();
  });

  afterAll(() => {
    for (const key of environmentKeys) {
      const value = originalEnvironment.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('fails closed unless every isolated E2E guard is satisfied', async () => {
    const root = join(tmpdir(), `field-atlas-e2e-media-${randomUUID()}`);
    const nestedParent = await mkdtemp(
      join(tmpdir(), 'field-atlas-e2e-parent-'),
    );
    cleanupPaths.add(nestedParent);
    const base = filesystemEnvironment(root);
    const unsafeEnvironments: Array<[string, NodeJS.ProcessEnv]> = [
      [
        'missing filesystem opt-in',
        { ...base, E2E_MEDIA_STORAGE_ADAPTER: undefined },
      ],
      [
        'non-isolated database adapter',
        { ...base, E2E_DATABASE_ADAPTER: undefined },
      ],
      [
        'missing public filesystem opt-in',
        {
          ...base,
          NEXT_PUBLIC_E2E_MEDIA_STORAGE_ADAPTER: undefined,
        },
      ],
      [
        'remote database',
        {
          ...base,
          DATABASE_URL:
            'postgresql://field_atlas_e2e:secret@db.example.test:5432/field_atlas_e2e',
        },
      ],
      [
        'database host query override',
        {
          ...base,
          POSTGRES_URL:
            'postgresql://field_atlas_e2e:secret@127.0.0.1:5432/field_atlas_e2e?host=db.example.test',
        },
      ],
      [
        'non-loopback application origin',
        { ...base, APP_URL: 'https://fieldatlas.test' },
      ],
      [
        'mismatched authentication origin',
        { ...base, AUTH_URL: 'http://127.0.0.1:3200' },
      ],
      ['Vercel runtime', { ...base, VERCEL: '1' }],
      [
        'nested storage root',
        {
          ...base,
          E2E_MEDIA_STORAGE_ROOT: join(
            nestedParent,
            `field-atlas-e2e-media-${randomUUID()}`,
          ),
        },
      ],
      [
        'unrecognizable storage root',
        {
          ...base,
          E2E_MEDIA_STORAGE_ROOT: join(tmpdir(), `uploads-${randomUUID()}`),
        },
      ],
      [
        'temporary boundary itself',
        { ...base, E2E_MEDIA_STORAGE_ROOT: tmpdir() },
      ],
    ];

    for (const [description, environment] of unsafeEnvironments) {
      await expect(
        getE2EAtlasMediaStorageConfiguration(environment),
      ).rejects.toThrow();
      expect(description).toBeTruthy();
    }
  });

  it('keeps production reads and deletes on private Vercel Blob storage', async () => {
    process.env.ATLAS_BLOB_READ_WRITE_TOKEN = 'production-test-token';
    const metadata = {
      pathname,
      contentType: 'image/jpeg',
      size: 5,
      uploadedAt: new Date('2026-09-11T12:00:00.000Z'),
      etag: 'private-etag',
      contentDisposition: 'inline',
      cacheControl: 'private',
      url: 'https://private.blob.vercel-storage.com/photo',
      downloadUrl: 'https://private.blob.vercel-storage.com/photo?download=1',
    };
    jest.mocked(head).mockResolvedValue(metadata);
    jest.mocked(get).mockResolvedValue({
      statusCode: 200,
      stream: new ReadableStream(),
      headers: new Headers(),
      blob: metadata,
    });
    jest.mocked(del).mockResolvedValue(undefined);

    await expect(headAtlasMediaObject(pathname)).resolves.toBe(metadata);
    await expect(
      readAtlasMediaObject(pathname, { ifNoneMatch: 'previous-etag' }),
    ).resolves.toMatchObject({ statusCode: 200 });
    await expect(deleteAtlasMediaObjects([pathname])).resolves.toBeUndefined();

    expect(head).toHaveBeenCalledWith(pathname, {
      token: 'production-test-token',
    });
    expect(get).toHaveBeenCalledWith(pathname, {
      access: 'private',
      token: 'production-test-token',
      ifNoneMatch: 'previous-etag',
    });
    expect(del).toHaveBeenCalledWith([pathname], {
      token: 'production-test-token',
    });
  });

  it('rejects symbolic-link boundaries and storage roots', async () => {
    const boundaryLink = join(
      tmpdir(),
      `field-atlas-e2e-boundary-${randomUUID()}`,
    );
    const linkedRoot = join(tmpdir(), `field-atlas-e2e-media-${randomUUID()}`);
    const targetRoot = await mkdtemp(
      join(tmpdir(), 'field-atlas-e2e-media-target-'),
    );
    cleanupPaths.add(boundaryLink);
    cleanupPaths.add(linkedRoot);
    cleanupPaths.add(targetRoot);
    await symlink(tmpdir(), boundaryLink);
    await symlink(targetRoot, linkedRoot);

    await expect(
      getE2EAtlasMediaStorageConfiguration(
        filesystemEnvironment(
          join(boundaryLink, `field-atlas-e2e-media-${randomUUID()}`),
          { RUNNER_TEMP: boundaryLink },
        ),
      ),
    ).rejects.toThrow('temp boundary');
    await expect(
      getE2EAtlasMediaStorageConfiguration(filesystemEnvironment(linkedRoot)),
    ).rejects.toThrow('regular temporary directory');
  });

  it('rejects a storage root accessible by other users', async () => {
    const root = await mkdtemp(join(tmpdir(), 'field-atlas-e2e-media-'));
    cleanupPaths.add(root);
    await chmod(root, 0o755);

    await expect(
      getE2EAtlasMediaStorageConfiguration(filesystemEnvironment(root)),
    ).rejects.toThrow('other users');
  });

  it('stores, conditionally reads, and deletes immutable private objects', async () => {
    const root = join(tmpdir(), `field-atlas-e2e-media-${randomUUID()}`);
    cleanupPaths.add(root);
    Object.assign(process.env, filesystemEnvironment(root));
    const bytes = new TextEncoder().encode('private photo bytes');

    const stored = await putE2EAtlasMediaObject({
      pathname,
      contentType: 'image/jpeg',
      bytes,
    });

    expect(stored).toMatchObject({
      pathname,
      contentType: 'image/jpeg',
      size: bytes.byteLength,
    });
    expect(stored.etag).toMatch(/^"[0-9a-f]{64}"$/);
    const files = await readdir(root);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^[0-9a-f]{64}\.blob$/);
    expect(files[0]).not.toContain(mediaId);
    const file = await lstat(join(root, files[0]));
    expect(file.mode & 0o077).toBe(0);

    await expect(headAtlasMediaObject(pathname)).resolves.toMatchObject({
      pathname,
      size: bytes.byteLength,
    });
    const read = await readAtlasMediaObject(pathname);
    expect(read?.statusCode).toBe(200);
    if (!read || read.statusCode !== 200) {
      throw new Error('Expected a complete local media response.');
    }
    await expect(new Response(read.stream).text()).resolves.toBe(
      'private photo bytes',
    );

    const notModified = await readAtlasMediaObject(pathname, {
      ifNoneMatch: stored.etag,
    });
    expect(notModified).toMatchObject({
      statusCode: 304,
      stream: null,
      blob: { etag: stored.etag, size: null, contentType: null },
    });

    await expect(
      putE2EAtlasMediaObject({
        pathname,
        contentType: 'image/jpeg',
        bytes,
      }),
    ).rejects.toBeInstanceOf(AtlasMediaStorageConflictError);

    await deleteAtlasMediaObjects([pathname]);
    await expect(headAtlasMediaObject(pathname)).rejects.toBeInstanceOf(
      BlobNotFoundError,
    );
    await expect(readAtlasMediaObject(pathname)).resolves.toBeNull();
    await expect(deleteAtlasMediaObjects([pathname])).resolves.toBeUndefined();
  });

  it('rejects invalid paths, extension mismatches, and empty bodies', async () => {
    const root = join(tmpdir(), `field-atlas-e2e-media-${randomUUID()}`);
    cleanupPaths.add(root);
    Object.assign(process.env, filesystemEnvironment(root));

    await expect(
      putE2EAtlasMediaObject({
        pathname: `atlas/memories/${entryId}/../../outside.jpg`,
        contentType: 'image/jpeg',
        bytes: new Uint8Array([1]),
      }),
    ).rejects.toThrow('pathname');
    await expect(
      putE2EAtlasMediaObject({
        pathname,
        contentType: 'image/png',
        bytes: new Uint8Array([1]),
      }),
    ).rejects.toThrow('Invalid E2E Atlas media object');
    await expect(
      putE2EAtlasMediaObject({
        pathname,
        contentType: 'image/jpeg',
        bytes: new Uint8Array(),
      }),
    ).rejects.toThrow('Invalid E2E Atlas media object');
  });
});
