import sharp from 'sharp';

import {
  ATLAS_MEDIA_MAX_BYTES,
  ATLAS_THUMBNAIL_MAX_BYTES,
  assertRepairTarget,
  blobTarget,
  databaseEndpointFingerprint,
  inspectRow,
  main,
  parseOptions,
  reportExitCode,
  renderThumbnail,
  repairThumbnail,
  rowPathDetails,
  run,
} from '../../scripts/atlas-media-integrity.js';

const mediaId = '2df8f2d8-9fae-4c86-9578-3ed6179e262b';
const entryId = 'f7c0bf19-59fc-49df-9bd7-ae405a69e49c';
const userId = '8d78b335-1ab1-4a01-997e-86f3f91d23c3';
const originalPath = `atlas/memories/${entryId}/${mediaId}.jpg`;
const thumbnailPath = `atlas/memories/${entryId}/${mediaId}.thumbnail.webp`;

class MissingBlobError extends Error {}

function mediaRow(
  overrides: Partial<{
    byte_size: number;
    entry_deleted_at: Date | null;
    entry_id: string;
    entry_user_id: string | null;
    id: string;
    mime_type: string;
    storage_path: string;
    thumbnail_byte_size: number;
    thumbnail_path: string | null;
    user_id: string;
  }> = {},
) {
  return {
    id: mediaId,
    entry_id: entryId,
    user_id: userId,
    storage_path: originalPath,
    thumbnail_path: thumbnailPath,
    mime_type: 'image/jpeg',
    width: 1600,
    height: 900,
    byte_size: 1800,
    thumbnail_byte_size: 480,
    created_at: new Date('2026-09-30T12:00:00.000Z'),
    entry_user_id: userId,
    entry_deleted_at: null,
    ...overrides,
  };
}

function blobMetadata(pathname: string, contentType: string, size: number) {
  return {
    pathname,
    contentType,
    size,
    etag: `etag-${size}`,
  };
}

describe('Atlas media integrity operator tooling', () => {
  it.each(['not-repairable', 'original-mismatch'])(
    'returns the repair-failure exit code for %s',
    (status) => {
      expect(
        reportExitCode({
          summary: {
            findings: 1,
            statuses: {},
            repairs: { [status]: 1 },
          },
        }),
      ).toBe(1);
    },
  );

  it('shows help without opening services or printing configured secrets', async () => {
    const log = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    await expect(main(['--help'])).resolves.toBe(0);
    const output = log.mock.calls.flat().join('\n');
    expect(output).toContain('Read-only by default');
    expect(output).not.toMatch(/vercel_blob_rw_|postgres(?:ql)?:\/\//i);
    log.mockRestore();
  });

  it('is read-only by default and requires a bounded, explicitly confirmed repair', () => {
    expect(parseOptions([])).toMatchObject({
      repairMissingThumbnails: false,
      limit: null,
      concurrency: 4,
    });
    expect(() => parseOptions(['--repair-missing-thumbnails'])).toThrow(
      'explicit --limit',
    );
    expect(() =>
      parseOptions(['--repair-missing-thumbnails', '--limit=101']),
    ).toThrow('must not exceed 100');
    expect(
      parseOptions([
        '--repair-missing-thumbnails',
        '--limit=25',
        '--confirm-database=production',
        '--confirm-database-user=field_atlas_runtime',
        '--confirm-database-endpoint=sha256:database-endpoint',
        '--confirm-store=store_productionstore',
      ]),
    ).toMatchObject({
      confirmDatabase: 'production',
      confirmDatabaseEndpoint: 'sha256:database-endpoint',
      confirmDatabaseUser: 'field_atlas_runtime',
      confirmStore: 'productionstore',
    });
    const target = {
      databaseName: 'production',
      databaseUser: 'field_atlas_runtime',
      databaseEndpointFingerprint: 'sha256:database-endpoint',
      storeId: 'productionstore',
    };
    expect(() =>
      assertRepairTarget(
        {
          confirmDatabase: 'preview',
          confirmDatabaseEndpoint: null,
          confirmDatabaseUser: null,
          confirmStore: 'previewstore',
        },
        target,
      ),
    ).toThrow('--confirm-database=production');
    expect(() =>
      assertRepairTarget(
        {
          confirmDatabase: target.databaseName,
          confirmDatabaseEndpoint: null,
          confirmDatabaseUser: null,
          confirmStore: target.storeId,
        },
        target,
      ),
    ).toThrow('--confirm-database-user=field_atlas_runtime');
    expect(() =>
      assertRepairTarget(
        {
          confirmDatabase: target.databaseName,
          confirmDatabaseEndpoint: null,
          confirmDatabaseUser: target.databaseUser,
          confirmStore: target.storeId,
        },
        target,
      ),
    ).toThrow('--confirm-database-endpoint=sha256:database-endpoint');
    expect(() =>
      assertRepairTarget(
        {
          confirmDatabase: target.databaseName,
          confirmDatabaseEndpoint: target.databaseEndpointFingerprint,
          confirmDatabaseUser: target.databaseUser,
          confirmStore: 'previewstore',
        },
        target,
      ),
    ).toThrow('--confirm-store=productionstore');
    expect(() =>
      assertRepairTarget(
        {
          confirmDatabase: target.databaseName,
          confirmDatabaseEndpoint: target.databaseEndpointFingerprint,
          confirmDatabaseUser: target.databaseUser,
          confirmStore: target.storeId,
        },
        target,
      ),
    ).not.toThrow();
  });

  it('fingerprints only the configured database endpoint, never URL credentials', () => {
    const first = databaseEndpointFingerprint({
      POSTGRES_URL:
        'postgresql://runtime:first-secret@preview-pooler.example.test:5432/field_atlas_preview?sslmode=require',
    });
    const second = databaseEndpointFingerprint({
      POSTGRES_URL:
        'postgresql://another-user:another-secret@preview-pooler.example.test/another_database',
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(first).not.toContain('preview-pooler.example.test');
    expect(first).not.toContain('secret');
    expect(
      databaseEndpointFingerprint({
        POSTGRES_URL:
          'postgresql://runtime:secret@production-pooler.example.test/field_atlas',
      }),
    ).not.toBe(first);
  });

  it('prefers an explicit operator token over a potentially stale local OIDC token', () => {
    const token = 'vercel_blob_rw_atlasstore_operator-secret';
    expect(
      blobTarget({
        ATLAS_BLOB_READ_WRITE_TOKEN: token,
        ATLAS_BLOB_STORE_ID: 'atlasstore',
        VERCEL_OIDC_TOKEN: 'stale-local-oidc-token',
      }),
    ).toEqual({ auth: { token }, storeId: 'atlasstore' });
  });

  it('rejects a storage path whose embedded media ID differs from the row', () => {
    const anotherMediaId = 'af24737f-d09d-4346-b21b-9b4ae52e574b';
    expect(
      rowPathDetails(
        mediaRow({
          storage_path: `atlas/memories/${entryId}/${anotherMediaId}.jpg`,
          thumbnail_path: `atlas/memories/${entryId}/${anotherMediaId}.thumbnail.webp`,
        }),
      ).issues,
    ).toContain('original_path_media_id_mismatch');
  });

  it('still probes a structurally safe legacy pair with a different object UUID', async () => {
    const legacyObjectId = 'af24737f-d09d-4346-b21b-9b4ae52e574b';
    const legacyOriginal = `atlas/memories/${entryId}/${legacyObjectId}.jpg`;
    const legacyThumbnail = `atlas/memories/${entryId}/${legacyObjectId}.thumbnail.webp`;
    const blob = {
      BlobNotFoundError: MissingBlobError,
      head: jest.fn(async (pathname: string) =>
        pathname === legacyOriginal
          ? blobMetadata(pathname, 'image/jpeg', 1800)
          : blobMetadata(pathname, 'image/webp', 480),
      ),
    };

    const finding = await inspectRow(
      mediaRow({
        storage_path: legacyOriginal,
        thumbnail_path: legacyThumbnail,
      }),
      blob,
      { storeId: 'atlasstore' },
    );

    expect(finding.status).toBe('invalid_metadata');
    expect(finding.issues).toContain('original_path_media_id_mismatch');
    expect(finding.original).toMatchObject({ state: 'present' });
    expect(finding.thumbnail).toMatchObject({ state: 'present' });
    expect(blob.head).toHaveBeenCalledTimes(2);
  });

  it('rejects uppercase storage names to match the runtime media policy', () => {
    expect(
      rowPathDetails(
        mediaRow({
          storage_path: originalPath.toUpperCase(),
          thumbnail_path: thumbnailPath.toUpperCase(),
        }),
      ).issues,
    ).toEqual(
      expect.arrayContaining([
        'invalid_original_path',
        'invalid_thumbnail_path',
      ]),
    );
  });

  it('distinguishes a repairable missing thumbnail from a transient probe error', async () => {
    const missingThumbnailBlob = {
      BlobNotFoundError: MissingBlobError,
      head: jest.fn(async (pathname: string) => {
        if (pathname === thumbnailPath) throw new MissingBlobError();
        return blobMetadata(originalPath, 'image/jpeg', 1800);
      }),
    };
    const missing = await inspectRow(
      mediaRow({ thumbnail_byte_size: 2 * 1024 * 1024 }),
      missingThumbnailBlob,
      { storeId: 'atlasstore' },
    );
    expect(missing).toMatchObject({
      status: 'missing_thumbnail',
      issues: ['missing_thumbnail_object'],
      original: { state: 'present' },
      thumbnail: { state: 'missing' },
    });

    const unavailableBlob = {
      BlobNotFoundError: MissingBlobError,
      head: jest.fn(async (pathname: string) => {
        if (pathname === thumbnailPath) throw new Error('rate limited');
        return blobMetadata(originalPath, 'image/jpeg', 1800);
      }),
    };
    const unavailable = await inspectRow(mediaRow(), unavailableBlob, {
      storeId: 'atlasstore',
    });
    expect(unavailable.status).toBe('probe_error');
    expect(unavailable.issues).toContain('probe_error');
  });

  it('treats the legacy 2 MiB thumbnail size as unverified, not corrupt', async () => {
    const blob = {
      BlobNotFoundError: MissingBlobError,
      head: jest.fn(async (pathname: string) =>
        pathname === originalPath
          ? blobMetadata(pathname, 'image/jpeg', 1800)
          : blobMetadata(pathname, 'image/webp', 480),
      ),
    };
    const finding = await inspectRow(
      mediaRow({ thumbnail_byte_size: 2 * 1024 * 1024 }),
      blob,
      { storeId: 'atlasstore' },
    );
    expect(finding.status).toBe('healthy');
    expect(finding.notes).toEqual(['legacy_thumbnail_size_unverified']);
  });

  it.each([
    [
      'original recorded',
      { byte_size: 0 },
      1800,
      480,
      'original_recorded_byte_size_out_of_policy',
    ],
    [
      'original object',
      {},
      ATLAS_MEDIA_MAX_BYTES + 1,
      480,
      'original_object_byte_size_out_of_policy',
    ],
    [
      'thumbnail recorded',
      { thumbnail_byte_size: 1.5 },
      1800,
      480,
      'thumbnail_recorded_byte_size_out_of_policy',
    ],
    [
      'thumbnail object',
      {},
      1800,
      ATLAS_THUMBNAIL_MAX_BYTES + 1,
      'thumbnail_object_byte_size_out_of_policy',
    ],
  ] as const)(
    'rejects an out-of-policy %s byte size',
    async (_label, overrides, originalSize, thumbnailSize, expectedIssue) => {
      const blob = {
        BlobNotFoundError: MissingBlobError,
        head: jest.fn(async (pathname: string) =>
          pathname === originalPath
            ? blobMetadata(pathname, 'image/jpeg', originalSize)
            : blobMetadata(pathname, 'image/webp', thumbnailSize),
        ),
      };

      const finding = await inspectRow(mediaRow(overrides), blob, {
        storeId: 'atlasstore',
      });

      expect(finding.status).toBe('metadata_mismatch');
      expect(finding.issues).toContain(expectedIssue);
    },
  );

  it('validates thumbnail policy bounds before applying the legacy-size exception', async () => {
    const blob = {
      BlobNotFoundError: MissingBlobError,
      head: jest.fn(async (pathname: string) =>
        pathname === originalPath
          ? blobMetadata(pathname, 'image/jpeg', 1800)
          : blobMetadata(pathname, 'image/webp', ATLAS_THUMBNAIL_MAX_BYTES + 1),
      ),
    };

    const finding = await inspectRow(
      mediaRow({ thumbnail_byte_size: ATLAS_THUMBNAIL_MAX_BYTES }),
      blob,
      { storeId: 'atlasstore' },
    );

    expect(finding.issues).toContain(
      'thumbnail_object_byte_size_out_of_policy',
    );
    expect(finding.notes).not.toContain('legacy_thumbnail_size_unverified');
  });

  it('does only read-only SQL and HEAD requests in default audit mode', async () => {
    const row = mediaRow();
    const query = jest.fn(async (statement: string) => {
      if (statement.includes('current_database()')) {
        return {
          rows: [
            {
              database_name: 'field_atlas_preview',
              database_user: 'field_atlas_runtime',
            },
          ],
        };
      }
      if (statement.includes('FROM atlas_media AS media')) {
        return { rows: [row] };
      }
      return { rows: [] };
    });
    const release = jest.fn();
    const database = { connect: jest.fn(async () => ({ query, release })) };
    const blob = {
      BlobNotFoundError: MissingBlobError,
      head: jest.fn(async (pathname: string) =>
        pathname === originalPath
          ? blobMetadata(pathname, 'image/jpeg', 1800)
          : blobMetadata(pathname, 'image/webp', 480),
      ),
      get: jest.fn(),
      put: jest.fn(),
      del: jest.fn(),
    };

    const report = await run(parseOptions([]), {
      database,
      blob,
      blobTarget: {
        auth: { storeId: 'atlasstore' },
        storeId: 'atlasstore',
      },
      environment: {
        POSTGRES_URL:
          'postgresql://runtime:secret@preview-pooler.example.test/field_atlas_preview',
      },
    });

    expect(report.summary).toMatchObject({ inspected: 1, healthy: 1 });
    expect(
      query.mock.calls.map(([statement]) => String(statement)).join('\n'),
    ).not.toMatch(/\b(?:INSERT|UPDATE|DELETE)\b/i);
    expect(query.mock.calls[0][0]).toBe(
      'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
    );
    expect(report.target).toMatchObject({
      databaseName: 'field_atlas_preview',
      databaseUser: 'field_atlas_runtime',
      databaseEndpointFingerprint: expect.stringMatching(
        /^sha256:[0-9a-f]{64}$/,
      ),
      storeId: 'atlasstore',
    });
    expect(blob.get).not.toHaveBeenCalled();
    expect(blob.put).not.toHaveBeenCalled();
    expect(blob.del).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('fails an exact-media audit when the requested record does not exist', async () => {
    const query = jest.fn(async (statement: string) => {
      if (statement.includes('current_database()')) {
        return {
          rows: [
            {
              database_name: 'field_atlas_preview',
              database_user: 'field_atlas_runtime',
            },
          ],
        };
      }
      return { rows: [] };
    });
    const release = jest.fn();
    const database = { connect: jest.fn(async () => ({ query, release })) };

    await expect(
      run(parseOptions([`--media-id=${mediaId}`]), {
        database,
        blobTarget: {
          auth: { storeId: 'atlasstore' },
          storeId: 'atlasstore',
        },
        environment: {
          POSTGRES_URL:
            'postgresql://runtime:secret@preview-pooler.example.test/field_atlas_preview',
        },
      }),
    ).rejects.toThrow(`Atlas media ${mediaId} was not found.`);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['image/jpeg', 'jpeg'],
    ['image/webp', 'webp'],
  ] as const)(
    'regenerates a bounded, metadata-free %s derivative',
    async (contentType, format) => {
      const source = await sharp({
        create: {
          width: 1400,
          height: 900,
          channels: 3,
          background: '#b65f3c',
        },
      })
        .jpeg()
        .withMetadata({ orientation: 6 })
        .toBuffer();
      expect((await sharp(source).metadata()).exif).toBeDefined();

      const derivative = await renderThumbnail(source, contentType, sharp);
      const metadata = await sharp(derivative).metadata();
      expect(metadata).toMatchObject({ format });
      expect(
        Math.max(metadata.width ?? 0, metadata.height ?? 0),
      ).toBeLessThanOrEqual(1024);
      expect(metadata.exif).toBeUndefined();
      expect(metadata.xmp).toBeUndefined();
      expect(metadata.iptc).toBeUndefined();
    },
  );

  it('commits the locked CAS association before reacquiring locks and uploading', async () => {
    const row = mediaRow({
      thumbnail_path: null,
      thumbnail_byte_size: 2 * 1024 * 1024,
    });
    const source = await sharp({
      create: {
        width: 1200,
        height: 800,
        channels: 3,
        background: '#10231d',
      },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    row.byte_size = source.length;
    const events: string[] = [];
    const put = jest.fn(
      async (_pathname: string, _body: Buffer, _options: unknown) => {
        events.push('PUT');
        return {
          pathname: thumbnailPath,
        };
      },
    );
    const blob = {
      BlobNotFoundError: MissingBlobError,
      head: jest.fn(async (pathname: string) => {
        if (pathname === thumbnailPath) throw new MissingBlobError();
        return blobMetadata(originalPath, 'image/jpeg', source.length);
      }),
      get: jest.fn(async () => ({
        statusCode: 200,
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue(source);
            controller.close();
          },
        }),
      })),
      put,
    };
    let currentRow = { ...row };
    const query = jest.fn(async (statement: string, values?: unknown[]) => {
      if (statement === 'BEGIN' || statement === 'COMMIT') {
        events.push(statement);
      } else if (statement.includes('UPDATE atlas_media')) {
        events.push('UPDATE');
      } else if (statement.includes('FOR UPDATE')) {
        events.push('LOCK');
      }
      if (
        statement.includes('FROM atlas_media') &&
        statement.includes('FOR UPDATE')
      ) {
        return { rows: [currentRow] };
      }
      if (statement.includes('UPDATE atlas_media')) {
        currentRow = {
          ...currentRow,
          thumbnail_path: values?.[0] as string | null,
          thumbnail_byte_size: values?.[1] as number,
        };
        return { rows: [{ id: mediaId }] };
      }
      return { rows: [] };
    });

    const result = await repairThumbnail(
      row,
      {
        status: 'missing_thumbnail',
        issues: ['missing_thumbnail_reference'],
        original: { state: 'present' },
      },
      {
        auth: { storeId: 'atlasstore' },
        blob,
        client: { query },
        sharp,
      },
    );

    expect(result).toMatchObject({
      status: 'repaired',
      pathname: thumbnailPath,
      adoptedExistingObject: false,
      associationRecorded: true,
    });
    const statements = query.mock.calls.map(([statement]) => String(statement));
    expect(statements[0]).toBe('BEGIN');
    expect(
      statements.filter((statement) => statement.includes('FOR UPDATE')),
    ).toHaveLength(2);
    expect(statements.at(-1)).toBe('COMMIT');
    const uploaded = put.mock.calls[0][1] as Buffer;
    const uploadedMetadata = await sharp(uploaded).metadata();
    expect(uploadedMetadata.exif).toBeUndefined();
    expect(uploadedMetadata.xmp).toBeUndefined();
    expect(uploadedMetadata.iptc).toBeUndefined();
    const updateCall = query.mock.calls.find(([statement]) =>
      String(statement).includes('UPDATE atlas_media'),
    );
    expect(updateCall?.[1]).toEqual([
      thumbnailPath,
      uploaded.length,
      mediaId,
      originalPath,
      null,
      2 * 1024 * 1024,
    ]);
    expect(events).toEqual([
      'BEGIN',
      'LOCK',
      'UPDATE',
      'COMMIT',
      'BEGIN',
      'LOCK',
      'PUT',
      'COMMIT',
    ]);
  });

  it('adopts an interrupted deterministic repair only after validating its bytes', async () => {
    const row = mediaRow({
      thumbnail_path: null,
      thumbnail_byte_size: 2 * 1024 * 1024,
    });
    const source = await sharp({
      create: {
        width: 40,
        height: 30,
        channels: 3,
        background: '#10231d',
      },
    })
      .jpeg()
      .toBuffer();
    row.byte_size = source.length;
    const existingThumbnail = await renderThumbnail(
      source,
      'image/webp',
      sharp,
    );
    const blob = {
      BlobNotFoundError: MissingBlobError,
      head: jest.fn(async (pathname: string) =>
        pathname === originalPath
          ? blobMetadata(pathname, 'image/jpeg', source.length)
          : blobMetadata(pathname, 'image/webp', existingThumbnail.length),
      ),
      get: jest.fn(async (pathname: string) => {
        const bytes = pathname === originalPath ? source : existingThumbnail;
        return {
          statusCode: 200,
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue(bytes);
              controller.close();
            },
          }),
        };
      }),
      put: jest.fn(),
    };
    const query = jest.fn(async (statement: string) => {
      if (
        statement.includes('FROM atlas_media') &&
        statement.includes('FOR UPDATE')
      ) {
        return { rows: [row] };
      }
      if (statement.includes('UPDATE atlas_media')) {
        return { rows: [{ id: mediaId }] };
      }
      return { rows: [] };
    });

    await expect(
      repairThumbnail(
        row,
        {
          status: 'missing_thumbnail',
          issues: ['missing_thumbnail_reference'],
          original: { state: 'present' },
        },
        {
          auth: { storeId: 'atlasstore' },
          blob,
          client: { query },
          sharp,
        },
      ),
    ).resolves.toMatchObject({
      status: 'repaired',
      adoptedExistingObject: true,
      thumbnailByteSize: existingThumbnail.length,
    });
    expect(blob.get).toHaveBeenCalledWith(thumbnailPath, {
      access: 'private',
      storeId: 'atlasstore',
      useCache: false,
    });
    expect(blob.put).not.toHaveBeenCalled();
  });

  it('refuses to adopt a policy-valid deterministic-path object that was not derived from the current original', async () => {
    const row = mediaRow({
      thumbnail_path: null,
      thumbnail_byte_size: 2 * 1024 * 1024,
    });
    const source = await sharp({
      create: {
        width: 40,
        height: 30,
        channels: 3,
        background: '#10231d',
      },
    })
      .jpeg()
      .toBuffer();
    const unrelatedThumbnail = await sharp({
      create: {
        width: 40,
        height: 30,
        channels: 3,
        background: '#ffffff',
      },
    })
      .webp({ quality: 82 })
      .toBuffer();
    row.byte_size = source.length;
    const blob = {
      BlobNotFoundError: MissingBlobError,
      head: jest.fn(async (pathname: string) =>
        pathname === originalPath
          ? blobMetadata(pathname, 'image/jpeg', source.length)
          : blobMetadata(pathname, 'image/webp', unrelatedThumbnail.length),
      ),
      get: jest.fn(async (pathname: string) => {
        const bytes = pathname === originalPath ? source : unrelatedThumbnail;
        return {
          statusCode: 200,
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue(bytes);
              controller.close();
            },
          }),
        };
      }),
      put: jest.fn(),
    };
    const query = jest.fn(async (statement: string) => {
      if (
        statement.includes('FROM atlas_media') &&
        statement.includes('FOR UPDATE')
      ) {
        return { rows: [row] };
      }
      if (statement.includes('UPDATE atlas_media')) {
        return { rows: [{ id: mediaId }] };
      }
      return { rows: [] };
    });

    await expect(
      repairThumbnail(
        row,
        {
          status: 'missing_thumbnail',
          issues: ['missing_thumbnail_reference'],
          original: { state: 'present' },
        },
        {
          auth: { storeId: 'atlasstore' },
          blob,
          client: { query },
          sharp,
        },
      ),
    ).resolves.toMatchObject({ status: 'object-mismatch' });
    expect(
      query.mock.calls.some(([statement]) =>
        String(statement).includes('UPDATE atlas_media'),
      ),
    ).toBe(false);
    expect(query).toHaveBeenCalledWith('ROLLBACK');
    expect(blob.put).not.toHaveBeenCalled();
  });

  it('refuses repair when the locked original metadata changed after the audit', async () => {
    const row = mediaRow({
      thumbnail_path: null,
      thumbnail_byte_size: 2 * 1024 * 1024,
    });
    const blob = {
      BlobNotFoundError: MissingBlobError,
      head: jest.fn(async (pathname: string) => {
        if (pathname === thumbnailPath) throw new MissingBlobError();
        return blobMetadata(pathname, 'image/jpeg', Number(row.byte_size) + 1);
      }),
      get: jest.fn(),
      put: jest.fn(),
    };
    const query = jest.fn(async (statement: string) => {
      if (statement.includes('FOR UPDATE')) return { rows: [row] };
      return { rows: [] };
    });

    await expect(
      repairThumbnail(
        row,
        {
          status: 'missing_thumbnail',
          issues: ['missing_thumbnail_reference'],
          original: { state: 'present' },
        },
        {
          auth: { storeId: 'atlasstore' },
          blob,
          client: { query },
          sharp,
        },
      ),
    ).resolves.toMatchObject({ status: 'original-mismatch' });
    expect(query).toHaveBeenCalledWith('ROLLBACK');
    expect(blob.get).not.toHaveBeenCalled();
    expect(blob.put).not.toHaveBeenCalled();
  });

  it('does not upload when the database association fails', async () => {
    const row = mediaRow({
      thumbnail_path: null,
      thumbnail_byte_size: 2 * 1024 * 1024,
    });
    const source = await sharp({
      create: {
        width: 20,
        height: 20,
        channels: 3,
        background: '#ffffff',
      },
    })
      .jpeg()
      .toBuffer();
    row.byte_size = source.length;
    const blob = {
      BlobNotFoundError: MissingBlobError,
      head: jest.fn(async (pathname: string) => {
        if (pathname === thumbnailPath) throw new MissingBlobError();
        return blobMetadata(pathname, 'image/jpeg', source.length);
      }),
      get: jest.fn(async () => ({
        statusCode: 200,
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue(source);
            controller.close();
          },
        }),
      })),
      put: jest.fn(async () => ({ pathname: thumbnailPath })),
    };
    const query = jest.fn(async (statement: string) => {
      if (statement.includes('FOR UPDATE')) return { rows: [row] };
      if (statement.includes('UPDATE atlas_media')) {
        throw new Error('database unavailable');
      }
      return { rows: [] };
    });

    await expect(
      repairThumbnail(
        row,
        {
          status: 'missing_thumbnail',
          issues: ['missing_thumbnail_reference'],
          original: { state: 'present' },
        },
        {
          auth: { storeId: 'atlasstore' },
          blob,
          client: { query },
          sharp,
        },
      ),
    ).rejects.toThrow('database unavailable');
    expect(query).toHaveBeenCalledWith('ROLLBACK');
    expect(blob.put).not.toHaveBeenCalled();
  });

  it('keeps a failed upload registered so a later audit can retry it', async () => {
    const row = mediaRow({
      thumbnail_path: null,
      thumbnail_byte_size: 2 * 1024 * 1024,
    });
    const source = await sharp({
      create: {
        width: 20,
        height: 20,
        channels: 3,
        background: '#ffffff',
      },
    })
      .jpeg()
      .toBuffer();
    row.byte_size = source.length;
    const events: string[] = [];
    const blob = {
      BlobNotFoundError: MissingBlobError,
      head: jest.fn(async (pathname: string) => {
        if (pathname === thumbnailPath) throw new MissingBlobError();
        return blobMetadata(pathname, 'image/jpeg', source.length);
      }),
      get: jest.fn(async () => ({
        statusCode: 200,
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue(source);
            controller.close();
          },
        }),
      })),
      put: jest.fn(async () => {
        events.push('PUT');
        throw new Error('storage unavailable');
      }),
    };
    let currentRow = { ...row };
    const query = jest.fn(async (statement: string, values?: unknown[]) => {
      if (statement === 'COMMIT') events.push('COMMIT');
      if (statement.includes('FOR UPDATE')) return { rows: [currentRow] };
      if (statement.includes('UPDATE atlas_media')) {
        currentRow = {
          ...currentRow,
          thumbnail_path: values?.[0] as string | null,
          thumbnail_byte_size: values?.[1] as number,
        };
        return { rows: [{ id: mediaId }] };
      }
      return { rows: [] };
    });

    await expect(
      repairThumbnail(
        row,
        {
          status: 'missing_thumbnail',
          issues: ['missing_thumbnail_reference'],
          original: { state: 'present' },
        },
        {
          auth: { storeId: 'atlasstore' },
          blob,
          client: { query },
          sharp,
        },
      ),
    ).resolves.toMatchObject({
      status: 'upload-failed',
      associationRecorded: true,
    });
    expect(events).toEqual(['COMMIT', 'PUT']);
    expect(currentRow.thumbnail_path).toBe(thumbnailPath);
    expect(query).toHaveBeenCalledWith('ROLLBACK');
  });

  it('adopts a concurrent no-overwrite PUT only after exact-byte revalidation', async () => {
    const row = mediaRow({
      thumbnail_path: null,
      thumbnail_byte_size: 2 * 1024 * 1024,
    });
    const source = await sharp({
      create: {
        width: 36,
        height: 24,
        channels: 3,
        background: '#305a46',
      },
    })
      .jpeg()
      .toBuffer();
    row.byte_size = source.length;
    let uploadedThumbnail: Buffer | null = null;
    const blob = {
      BlobNotFoundError: MissingBlobError,
      head: jest.fn(async (pathname: string) => {
        if (pathname === originalPath) {
          return blobMetadata(pathname, 'image/jpeg', source.length);
        }
        if (!uploadedThumbnail) throw new MissingBlobError();
        return blobMetadata(pathname, 'image/webp', uploadedThumbnail.length);
      }),
      get: jest.fn(async (pathname: string) => {
        const bytes = pathname === originalPath ? source : uploadedThumbnail!;
        return {
          statusCode: 200,
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue(bytes);
              controller.close();
            },
          }),
        };
      }),
      put: jest.fn(async (_pathname: string, body: Buffer) => {
        uploadedThumbnail = body;
        throw Object.assign(new Error('object already exists'), {
          name: 'BlobPreconditionFailedError',
        });
      }),
    };
    let currentRow = { ...row };
    const query = jest.fn(async (statement: string, values?: unknown[]) => {
      if (statement.includes('FOR UPDATE')) return { rows: [currentRow] };
      if (statement.includes('UPDATE atlas_media')) {
        currentRow = {
          ...currentRow,
          thumbnail_path: values?.[0] as string | null,
          thumbnail_byte_size: values?.[1] as number,
        };
        return { rows: [{ id: mediaId }] };
      }
      return { rows: [] };
    });

    await expect(
      repairThumbnail(
        row,
        {
          status: 'missing_thumbnail',
          issues: ['missing_thumbnail_reference'],
          original: { state: 'present' },
        },
        {
          auth: { storeId: 'atlasstore' },
          blob,
          client: { query },
          sharp,
        },
      ),
    ).resolves.toMatchObject({
      status: 'repaired',
      adoptedExistingObject: true,
      associationRecorded: true,
    });
    expect(blob.put).toHaveBeenCalledTimes(1);
    expect(blob.get).toHaveBeenCalledWith(thumbnailPath, {
      access: 'private',
      storeId: 'atlasstore',
      useCache: false,
    });
  });

  it('restores a newly added association without deleting a conflicting object', async () => {
    const row = mediaRow({
      thumbnail_path: null,
      thumbnail_byte_size: 2 * 1024 * 1024,
    });
    const source = await sharp({
      create: {
        width: 36,
        height: 24,
        channels: 3,
        background: '#305a46',
      },
    })
      .jpeg()
      .toBuffer();
    const unrelatedThumbnail = await sharp({
      create: {
        width: 36,
        height: 24,
        channels: 3,
        background: '#ffffff',
      },
    })
      .webp({ quality: 82 })
      .toBuffer();
    row.byte_size = source.length;
    let objectAppeared = false;
    const blob = {
      BlobNotFoundError: MissingBlobError,
      head: jest.fn(async (pathname: string) => {
        if (pathname === originalPath) {
          return blobMetadata(pathname, 'image/jpeg', source.length);
        }
        if (!objectAppeared) throw new MissingBlobError();
        return blobMetadata(pathname, 'image/webp', unrelatedThumbnail.length);
      }),
      get: jest.fn(async (pathname: string) => {
        const bytes = pathname === originalPath ? source : unrelatedThumbnail;
        return {
          statusCode: 200,
          stream: new ReadableStream({
            start(controller) {
              controller.enqueue(bytes);
              controller.close();
            },
          }),
        };
      }),
      put: jest.fn(async () => {
        objectAppeared = true;
        throw Object.assign(new Error('object already exists'), {
          name: 'BlobPreconditionFailedError',
        });
      }),
    };
    let currentRow = { ...row };
    const query = jest.fn(async (statement: string, values?: unknown[]) => {
      if (statement.includes('FOR UPDATE')) return { rows: [currentRow] };
      if (statement.includes('UPDATE atlas_media')) {
        currentRow = {
          ...currentRow,
          thumbnail_path: values?.[0] as string | null,
          thumbnail_byte_size: values?.[1] as number,
        };
        return { rows: [{ id: mediaId }] };
      }
      return { rows: [] };
    });

    await expect(
      repairThumbnail(
        row,
        {
          status: 'missing_thumbnail',
          issues: ['missing_thumbnail_reference'],
          original: { state: 'present' },
        },
        {
          auth: { storeId: 'atlasstore' },
          blob,
          client: { query },
          sharp,
        },
      ),
    ).resolves.toMatchObject({
      status: 'object-mismatch',
      associationRecorded: false,
    });
    expect(blob.put).toHaveBeenCalledTimes(1);
    expect(currentRow.thumbnail_path).toBeNull();
    expect(currentRow.thumbnail_byte_size).toBe(2 * 1024 * 1024);
  });
});
