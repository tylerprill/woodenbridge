require('dotenv').config({ path: '.env.local', override: false, quiet: true });
require('dotenv').config({ path: '.env', override: false, quiet: true });

const { createHash } = require('node:crypto');
const { BlobNotFoundError, get, head, put } = require('@vercel/blob');
const { db } = require('@vercel/postgres');
const sharp = require('sharp');

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ORIGINAL_FILE_PATTERN =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.(jpg|png|webp)$/;
const THUMBNAIL_FILE_PATTERN =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.thumbnail\.(jpg|webp)$/;
const CONTENT_TYPE_BY_EXTENSION = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};
const ATLAS_MEDIA_MAX_BYTES = 10 * 1024 * 1024;
const ATLAS_THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024;
const ATLAS_THUMBNAIL_MAX_DIMENSION = 1024;
const LEGACY_THUMBNAIL_SIZE_SENTINEL = ATLAS_THUMBNAIL_MAX_BYTES;
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_CONCURRENCY = 4;
const MAX_BATCH_SIZE = 500;
const MAX_CONCURRENCY = 8;
const MAX_REPAIR_LIMIT = 100;
const CACHE_SECONDS = 30 * 24 * 60 * 60;

function usage() {
  return `Usage: npm run media:integrity -- [options]

Read-only by default. The command enumerates registered Atlas media and checks
the exact private original and thumbnail paths without listing unrelated Blob
objects.

Options:
  --media-id=<uuid>              Inspect one media record.
  --user-id=<uuid>               Inspect media owned by one user ID.
  --limit=<number>               Stop after this many records.
  --batch-size=<number>          Database keyset page size (default 100, max 500).
  --concurrency=<number>         Concurrent record probes (default 4, max 8).
  --json                         Emit one machine-readable JSON report.
  --verbose                      Include private storage paths in the report.
  --repair-missing-thumbnails    Regenerate repairable missing thumbnails.
  --confirm-database=<name>      Exact database name required for repair.
  --confirm-database-user=<user> Exact database user required for repair.
  --confirm-database-endpoint=<fingerprint>
                                 Reported database endpoint fingerprint required for repair.
  --confirm-store=<id>           Exact normalized Blob store ID required for repair.
  --help                         Show this help.

Repair additionally requires --limit (maximum ${MAX_REPAIR_LIMIT}). Originals
are never regenerated or deleted, and existing Blob objects are never
overwritten.`;
}

function optionValue(argument, name) {
  const prefix = `${name}=`;
  return argument.startsWith(prefix) ? argument.slice(prefix.length) : null;
}

function positiveInteger(value, name, maximum = Number.MAX_SAFE_INTEGER) {
  if (!/^\d+$/.test(value))
    throw new Error(`${name} must be a positive integer.`);
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${name} must be between 1 and ${maximum}.`);
  }
  return parsed;
}

function uuid(value, name) {
  if (!UUID_PATTERN.test(value)) throw new Error(`${name} must be a UUID.`);
  return value.toLowerCase();
}

function parseOptions(arguments_) {
  const options = {
    batchSize: DEFAULT_BATCH_SIZE,
    concurrency: DEFAULT_CONCURRENCY,
    confirmDatabase: null,
    confirmDatabaseEndpoint: null,
    confirmDatabaseUser: null,
    confirmStore: null,
    help: false,
    json: false,
    limit: null,
    mediaId: null,
    repairMissingThumbnails: false,
    userId: null,
    verbose: false,
  };

  for (const argument of arguments_) {
    if (argument === '--help') options.help = true;
    else if (argument === '--json') options.json = true;
    else if (argument === '--verbose') options.verbose = true;
    else if (argument === '--repair-missing-thumbnails') {
      options.repairMissingThumbnails = true;
    } else if (optionValue(argument, '--media-id') !== null) {
      options.mediaId = uuid(optionValue(argument, '--media-id'), '--media-id');
    } else if (optionValue(argument, '--user-id') !== null) {
      options.userId = uuid(optionValue(argument, '--user-id'), '--user-id');
    } else if (optionValue(argument, '--limit') !== null) {
      options.limit = positiveInteger(
        optionValue(argument, '--limit'),
        '--limit',
      );
    } else if (optionValue(argument, '--batch-size') !== null) {
      options.batchSize = positiveInteger(
        optionValue(argument, '--batch-size'),
        '--batch-size',
        MAX_BATCH_SIZE,
      );
    } else if (optionValue(argument, '--concurrency') !== null) {
      options.concurrency = positiveInteger(
        optionValue(argument, '--concurrency'),
        '--concurrency',
        MAX_CONCURRENCY,
      );
    } else if (optionValue(argument, '--confirm-database') !== null) {
      options.confirmDatabase = optionValue(argument, '--confirm-database');
    } else if (optionValue(argument, '--confirm-database-user') !== null) {
      options.confirmDatabaseUser = optionValue(
        argument,
        '--confirm-database-user',
      );
    } else if (optionValue(argument, '--confirm-database-endpoint') !== null) {
      options.confirmDatabaseEndpoint = optionValue(
        argument,
        '--confirm-database-endpoint',
      );
    } else if (optionValue(argument, '--confirm-store') !== null) {
      options.confirmStore = normalizeStoreId(
        optionValue(argument, '--confirm-store'),
      );
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }

  if (options.repairMissingThumbnails && options.limit === null) {
    throw new Error('Thumbnail repair requires an explicit --limit.');
  }
  if (
    options.repairMissingThumbnails &&
    options.limit !== null &&
    options.limit > MAX_REPAIR_LIMIT
  ) {
    throw new Error(
      `Thumbnail repair --limit must not exceed ${MAX_REPAIR_LIMIT}.`,
    );
  }
  return options;
}

/** @param {Record<string, string | undefined>} environment */
function databaseEndpointFingerprint(environment = process.env) {
  // @vercel/postgres connects through POSTGRES_URL. DATABASE_URL remains a
  // useful fallback for injected adapters and environments that mirror the
  // application's canonical runtime variable.
  const connectionString =
    environment.POSTGRES_URL?.trim() || environment.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error(
      'POSTGRES_URL or DATABASE_URL is required to identify the database endpoint.',
    );
  }

  let connection;
  try {
    connection = new URL(connectionString);
  } catch {
    throw new Error('The configured database URL is invalid.');
  }
  if (
    !['postgres:', 'postgresql:'].includes(connection.protocol) ||
    !connection.hostname
  ) {
    throw new Error('The configured database URL must use PostgreSQL.');
  }

  const endpoint = `${connection.hostname.toLowerCase()}:${connection.port || '5432'}`;
  return `sha256:${createHash('sha256').update(endpoint).digest('hex')}`;
}

function normalizeStoreId(value) {
  const normalized = String(value || '').startsWith('store_')
    ? String(value).slice(6)
    : String(value || '');
  if (!/^[A-Za-z0-9]+$/.test(normalized)) {
    throw new Error('The Atlas Blob store ID is invalid.');
  }
  return normalized;
}

function tokenStoreId(token) {
  const match = /^vercel_blob_rw_([^_]+)_(.+)$/.exec(token);
  if (!match) throw new Error('ATLAS_BLOB_READ_WRITE_TOKEN is invalid.');
  return match[1];
}

/** @param {Record<string, string | undefined>} environment */
function blobTarget(environment = process.env) {
  const rawStoreId = environment.ATLAS_BLOB_STORE_ID?.trim();
  const oidcToken = environment.VERCEL_OIDC_TOKEN?.trim();
  const readWriteToken = environment.ATLAS_BLOB_READ_WRITE_TOKEN?.trim();

  // An operator-provided token is stable for local audits. A pulled
  // VERCEL_OIDC_TOKEN can be stale while still looking syntactically valid;
  // preferring it would misclassify every object as missing.
  if (readWriteToken) {
    const storeId = tokenStoreId(readWriteToken);
    if (rawStoreId && normalizeStoreId(rawStoreId) !== storeId) {
      throw new Error(
        'ATLAS_BLOB_STORE_ID does not match ATLAS_BLOB_READ_WRITE_TOKEN.',
      );
    }
    return { auth: { token: readWriteToken }, storeId };
  }
  if (rawStoreId && oidcToken) {
    const storeId = normalizeStoreId(rawStoreId);
    return { auth: { storeId }, storeId };
  }
  if (rawStoreId) {
    throw new Error('Atlas Blob OIDC requires VERCEL_OIDC_TOKEN.');
  }
  throw new Error('Atlas Blob storage is not configured.');
}

function mediaPathDetails(pathname, entryId, kind) {
  if (typeof pathname !== 'string' || !UUID_PATTERN.test(entryId)) return null;
  const prefix = `atlas/memories/${entryId}/`;
  if (!pathname.startsWith(prefix)) return null;
  const fileName = pathname.slice(prefix.length);
  const match =
    kind === 'original'
      ? ORIGINAL_FILE_PATTERN.exec(fileName)
      : THUMBNAIL_FILE_PATTERN.exec(fileName);
  if (!match) return null;
  return {
    contentType: CONTENT_TYPE_BY_EXTENSION[match[2].toLowerCase()],
    mediaPathId: match[1].toLowerCase(),
  };
}

function rowPathDetails(row) {
  const original = mediaPathDetails(row.storage_path, row.entry_id, 'original');
  const thumbnail = row.thumbnail_path
    ? mediaPathDetails(row.thumbnail_path, row.entry_id, 'thumbnail')
    : null;
  const issues = [];
  if (!original) issues.push('invalid_original_path');
  if (row.thumbnail_path && !thumbnail) issues.push('invalid_thumbnail_path');
  if (original && original.mediaPathId !== String(row.id).toLowerCase()) {
    issues.push('original_path_media_id_mismatch');
  }
  if (original && original.contentType !== row.mime_type) {
    issues.push('original_path_mime_mismatch');
  }
  if (original && thumbnail && original.mediaPathId !== thumbnail.mediaPathId) {
    issues.push('unpaired_paths');
  }
  return { issues, original, thumbnail };
}

function isMissingBlobError(error, BlobNotFound = BlobNotFoundError) {
  return error instanceof BlobNotFound;
}

function diagnosticCode(error) {
  const name = error && typeof error.name === 'string' ? error.name : '';
  return /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(name) ? name : 'BlobProbeError';
}

async function probePath(pathname, blob, auth) {
  try {
    const object = await blob.head(pathname, auth);
    return {
      state: 'present',
      contentType: object.contentType,
      size: Number(object.size),
    };
  } catch (error) {
    if (isMissingBlobError(error, blob.BlobNotFoundError)) {
      return { state: 'missing' };
    }
    return { state: 'error', code: diagnosticCode(error) };
  }
}

function primaryStatus(issues) {
  if (issues.includes('probe_error')) return 'probe_error';
  if (
    issues.some((issue) =>
      [
        'invalid_original_path',
        'invalid_thumbnail_path',
        'original_path_media_id_mismatch',
        'original_path_mime_mismatch',
        'unpaired_paths',
      ].includes(issue),
    )
  ) {
    return 'invalid_metadata';
  }
  if (
    issues.includes('entry_owner_mismatch') ||
    issues.includes('deleted_entry_has_media') ||
    issues.includes('missing_entry_association')
  ) {
    return 'database_mismatch';
  }
  if (issues.includes('both_objects_missing')) return 'both_missing';
  if (issues.includes('missing_original_object')) return 'missing_original';
  if (
    issues.includes('missing_thumbnail_reference') ||
    issues.includes('missing_thumbnail_object')
  ) {
    return 'missing_thumbnail';
  }
  if (issues.some((issue) => issue.endsWith('_mismatch'))) {
    return 'metadata_mismatch';
  }
  if (issues.some((issue) => issue.endsWith('_out_of_policy'))) {
    return 'metadata_mismatch';
  }
  return 'healthy';
}

function isPolicyByteSize(value, maximum) {
  return Number.isSafeInteger(value) && value >= 1 && value <= Number(maximum);
}

async function inspectRow(row, blob, auth, verbose = false) {
  const paths = rowPathDetails(row);
  const issues = [...paths.issues];
  const notes = [];
  let original = { state: 'not-probed' };
  let thumbnail = row.thumbnail_path
    ? { state: 'not-probed' }
    : { state: 'unregistered' };

  if (!row.entry_user_id) issues.push('missing_entry_association');
  else if (row.entry_user_id !== row.user_id) {
    issues.push('entry_owner_mismatch');
  }
  if (row.entry_deleted_at) issues.push('deleted_entry_has_media');

  const recordedOriginalSize = Number(row.byte_size);
  const recordedThumbnailSize = Number(row.thumbnail_byte_size);
  const recordedOriginalSizeIsValid = isPolicyByteSize(
    recordedOriginalSize,
    ATLAS_MEDIA_MAX_BYTES,
  );
  const recordedThumbnailSizeIsValid = isPolicyByteSize(
    recordedThumbnailSize,
    ATLAS_THUMBNAIL_MAX_BYTES,
  );
  if (!recordedOriginalSizeIsValid) {
    issues.push('original_recorded_byte_size_out_of_policy');
  }
  if (!recordedThumbnailSizeIsValid) {
    issues.push('thumbnail_recorded_byte_size_out_of_policy');
  }

  const pathStructureIsSafe = !paths.issues.some((issue) =>
    [
      'invalid_original_path',
      'invalid_thumbnail_path',
      'unpaired_paths',
    ].includes(issue),
  );
  if (pathStructureIsSafe) {
    original = await probePath(row.storage_path, blob, auth);
    if (row.thumbnail_path) {
      thumbnail = await probePath(row.thumbnail_path, blob, auth);
    }

    if (original.state === 'error' || thumbnail.state === 'error') {
      issues.push('probe_error');
    } else if (
      original.state === 'missing' &&
      (thumbnail.state === 'missing' || thumbnail.state === 'unregistered')
    ) {
      issues.push('both_objects_missing');
      if (thumbnail.state === 'unregistered') {
        issues.push('missing_thumbnail_reference');
      } else {
        issues.push('missing_thumbnail_object');
      }
    } else {
      if (original.state === 'missing') {
        issues.push('missing_original_object');
        if (thumbnail.state === 'present') issues.push('orphan_thumbnail');
      }
      if (thumbnail.state === 'unregistered') {
        issues.push('missing_thumbnail_reference');
      } else if (thumbnail.state === 'missing') {
        issues.push('missing_thumbnail_object');
      }
    }

    if (original.state === 'present') {
      if (original.contentType !== row.mime_type) {
        issues.push('original_content_type_mismatch');
      }
      const originalObjectSizeIsValid = isPolicyByteSize(
        original.size,
        ATLAS_MEDIA_MAX_BYTES,
      );
      if (!originalObjectSizeIsValid) {
        issues.push('original_object_byte_size_out_of_policy');
      } else if (
        recordedOriginalSizeIsValid &&
        original.size !== recordedOriginalSize
      ) {
        issues.push('original_byte_size_mismatch');
      }
    }
    if (thumbnail.state === 'present' && paths.thumbnail) {
      if (thumbnail.contentType !== paths.thumbnail.contentType) {
        issues.push('thumbnail_content_type_mismatch');
      }
      const thumbnailObjectSizeIsValid = isPolicyByteSize(
        thumbnail.size,
        ATLAS_THUMBNAIL_MAX_BYTES,
      );
      if (!thumbnailObjectSizeIsValid) {
        issues.push('thumbnail_object_byte_size_out_of_policy');
      } else if (recordedThumbnailSizeIsValid) {
        if (
          recordedThumbnailSize === LEGACY_THUMBNAIL_SIZE_SENTINEL &&
          thumbnail.size !== recordedThumbnailSize
        ) {
          notes.push('legacy_thumbnail_size_unverified');
        } else if (thumbnail.size !== recordedThumbnailSize) {
          issues.push('thumbnail_byte_size_mismatch');
        }
      }
    }
  }

  const result = {
    id: row.id,
    entryId: row.entry_id,
    userId: row.user_id,
    status: primaryStatus(issues),
    issues: Array.from(new Set(issues)),
    notes,
    original,
    thumbnail,
  };
  if (verbose) {
    result.storagePath = row.storage_path;
    result.thumbnailPath = row.thumbnail_path;
  }
  return result;
}

async function mapWithConcurrency(items, concurrency, task) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await task(items[index], index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
  return results;
}

async function loadRegisteredMedia(client, options) {
  const rows = [];
  let cursor = null;
  await client.query(
    'BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY',
  );
  try {
    await client.query("SET LOCAL statement_timeout = '30s'");
    const identity = await client.query(
      'SELECT current_database() AS database_name, current_user AS database_user',
    );
    while (options.limit === null || rows.length < options.limit) {
      const remaining =
        options.limit === null ? null : options.limit - rows.length;
      const pageSize = Math.min(
        options.batchSize,
        remaining ?? options.batchSize,
      );
      const page = await client.query(
        `
          SELECT
            media.id::text,
            media.entry_id::text,
            media.user_id::text,
            media.storage_path,
            media.thumbnail_path,
            media.mime_type,
            media.width,
            media.height,
            media.byte_size,
            media.thumbnail_byte_size,
            media.created_at,
            entry.user_id::text AS entry_user_id,
            entry.deleted_at AS entry_deleted_at
          FROM atlas_media AS media
          LEFT JOIN atlas_entries AS entry ON entry.id = media.entry_id
          WHERE ($1::uuid IS NULL OR media.id > $1::uuid)
            AND ($2::uuid IS NULL OR media.id = $2::uuid)
            AND ($3::uuid IS NULL OR media.user_id = $3::uuid)
          ORDER BY media.id
          LIMIT $4
        `,
        [cursor, options.mediaId, options.userId, pageSize],
      );
      rows.push(...page.rows);
      if (page.rows.length < pageSize) break;
      cursor = page.rows.at(-1).id;
    }
    await client.query('COMMIT');
    return {
      databaseName: identity.rows[0].database_name,
      databaseUser: identity.rows[0].database_user,
      rows,
    };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

function derivedThumbnailPath(row) {
  const original = mediaPathDetails(row.storage_path, row.entry_id, 'original');
  if (!original)
    throw new Error('Cannot derive a thumbnail from an invalid path.');
  return `atlas/memories/${row.entry_id}/${original.mediaPathId}.thumbnail.webp`;
}

async function streamBytes(
  result,
  maximumBytes = ATLAS_MEDIA_MAX_BYTES,
  label = 'original',
) {
  if (!result || result.statusCode !== 200 || !result.stream) {
    throw new Error(`The ${label} object was not available for repair.`);
  }
  const bytes = Buffer.from(await new Response(result.stream).arrayBuffer());
  if (!bytes.length || bytes.length > maximumBytes) {
    throw new Error(`The ${label} object is outside the Atlas media policy.`);
  }
  return bytes;
}

async function verifyThumbnail(thumbnail, contentType, sharpFactory = sharp) {
  if (!thumbnail.length || thumbnail.length > ATLAS_THUMBNAIL_MAX_BYTES) {
    throw new Error('The regenerated thumbnail is outside the media policy.');
  }
  const metadata = await sharpFactory(thumbnail).metadata();
  const expectedFormat = contentType === 'image/jpeg' ? 'jpeg' : 'webp';
  if (
    metadata.format !== expectedFormat ||
    !Number.isSafeInteger(metadata.width) ||
    !Number.isSafeInteger(metadata.height) ||
    metadata.width < 1 ||
    metadata.height < 1 ||
    metadata.width > ATLAS_THUMBNAIL_MAX_DIMENSION ||
    metadata.height > ATLAS_THUMBNAIL_MAX_DIMENSION ||
    metadata.exif ||
    metadata.xmp ||
    metadata.iptc
  ) {
    throw new Error(
      'The regenerated thumbnail did not pass the public derivative policy.',
    );
  }
  return metadata;
}

async function renderThumbnail(source, contentType, sharpFactory = sharp) {
  let pipeline = sharpFactory(source, {
    failOn: 'error',
    limitInputPixels: 25_000_000,
  })
    .rotate()
    .resize({
      width: ATLAS_THUMBNAIL_MAX_DIMENSION,
      height: ATLAS_THUMBNAIL_MAX_DIMENSION,
      fit: 'inside',
      withoutEnlargement: true,
    });
  pipeline =
    contentType === 'image/jpeg'
      ? pipeline.jpeg({ quality: 82, mozjpeg: true })
      : pipeline.webp({ quality: 82, effort: 4, smartSubsample: true });
  const thumbnail = await pipeline.toBuffer();
  await verifyThumbnail(thumbnail, contentType, sharpFactory);
  return thumbnail;
}

async function compareThumbnailObject(
  pathname,
  object,
  expectedThumbnail,
  contentType,
  context,
) {
  if (
    object.contentType !== contentType ||
    !Number.isSafeInteger(object.size) ||
    object.size < 1 ||
    object.size > ATLAS_THUMBNAIL_MAX_BYTES
  ) {
    return { status: 'object-race' };
  }

  const existing = await context.blob.get(pathname, {
    access: 'private',
    ...context.auth,
    useCache: false,
  });
  const existingBytes = await streamBytes(
    existing,
    ATLAS_THUMBNAIL_MAX_BYTES,
    'thumbnail',
  );
  if (existingBytes.length !== object.size) {
    return { status: 'object-race' };
  }
  try {
    await verifyThumbnail(existingBytes, contentType, context.sharp);
  } catch {
    return { status: 'object-mismatch' };
  }
  if (!existingBytes.equals(expectedThumbnail)) {
    return { status: 'object-mismatch' };
  }
  return { status: 'matching', thumbnailByteSize: object.size };
}

async function lockThumbnailRepairRow(client, mediaId, pathname) {
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('atlas-thumbnail-repair:' || $1, 0))",
    [pathname],
  );
  const locked = await client.query(
    `
      SELECT
        id::text,
        entry_id::text,
        user_id::text,
        storage_path,
        thumbnail_path,
        mime_type,
        byte_size,
        thumbnail_byte_size
      FROM atlas_media
      WHERE id = $1
      FOR UPDATE
    `,
    [mediaId],
  );
  return locked.rows[0];
}

function repairRowMatchesSnapshot(current, row) {
  return Boolean(
    current &&
    current.entry_id === row.entry_id &&
    current.user_id === row.user_id &&
    current.storage_path === row.storage_path &&
    current.thumbnail_path === row.thumbnail_path &&
    Number(current.thumbnail_byte_size) === Number(row.thumbnail_byte_size),
  );
}

function repairRowMatchesAssociation(current, row, pathname, byteSize) {
  return Boolean(
    current &&
    current.entry_id === row.entry_id &&
    current.user_id === row.user_id &&
    current.storage_path === row.storage_path &&
    current.mime_type === row.mime_type &&
    Number(current.byte_size) === Number(row.byte_size) &&
    current.thumbnail_path === pathname &&
    Number(current.thumbnail_byte_size) === byteSize,
  );
}

async function restoreThumbnailAssociation(
  client,
  current,
  row,
  pathname,
  thumbnailByteSize,
) {
  const restored = await client.query(
    `
      UPDATE atlas_media
      SET thumbnail_path = $1, thumbnail_byte_size = $2
      WHERE id = $3
        AND storage_path = $4
        AND thumbnail_path = $5
        AND thumbnail_byte_size = $6
      RETURNING id
    `,
    [
      row.thumbnail_path,
      Number(row.thumbnail_byte_size),
      current.id,
      current.storage_path,
      pathname,
      thumbnailByteSize,
    ],
  );
  if (!restored.rows[0]) {
    throw new Error('The locked media row changed during repair recovery.');
  }
}

async function repairThumbnail(row, finding, context) {
  const repairableIssues = new Set([
    'missing_thumbnail_reference',
    'missing_thumbnail_object',
  ]);
  if (
    finding.status !== 'missing_thumbnail' ||
    finding.original.state !== 'present' ||
    finding.issues.some((issue) => !repairableIssues.has(issue))
  ) {
    return { id: row.id, status: 'not-repairable' };
  }

  const pathname = row.thumbnail_path || derivedThumbnailPath(row);
  const details = mediaPathDetails(pathname, row.entry_id, 'thumbnail');
  if (!details) return { id: row.id, status: 'not-repairable' };

  let expectedThumbnail;
  let thumbnailByteSize;
  let adoptedExistingObject = false;

  // Phase one makes the deterministic database association durable before a
  // new Blob can exist. A crash, connection loss, or media deletion after this
  // commit therefore leaves either a retryable missing object or a path that
  // the deletion trigger can enqueue; it cannot leave an untracked upload.
  try {
    await context.client.query('BEGIN');
    const current = await lockThumbnailRepairRow(
      context.client,
      row.id,
      pathname,
    );
    if (!repairRowMatchesSnapshot(current, row)) {
      await context.client.query('ROLLBACK');
      return { id: row.id, status: 'database-race' };
    }

    const currentPaths = rowPathDetails(current);
    if (currentPaths.issues.length) {
      await context.client.query('ROLLBACK');
      return { id: row.id, status: 'not-repairable' };
    }
    const currentOriginal = await probePath(
      current.storage_path,
      context.blob,
      context.auth,
    );
    if (currentOriginal.state !== 'present') {
      await context.client.query('ROLLBACK');
      return {
        id: row.id,
        status:
          currentOriginal.state === 'error' ? 'probe-failed' : 'not-repairable',
      };
    }
    if (
      currentOriginal.contentType !== current.mime_type ||
      !Number.isSafeInteger(currentOriginal.size) ||
      currentOriginal.size < 1 ||
      currentOriginal.size > ATLAS_MEDIA_MAX_BYTES ||
      currentOriginal.size !== Number(current.byte_size)
    ) {
      await context.client.query('ROLLBACK');
      return { id: row.id, status: 'original-mismatch' };
    }

    const currentThumbnail = await probePath(
      pathname,
      context.blob,
      context.auth,
    );
    if (currentThumbnail.state === 'error') {
      await context.client.query('ROLLBACK');
      return { id: row.id, status: 'probe-failed' };
    }

    const original = await context.blob.get(current.storage_path, {
      access: 'private',
      ...context.auth,
      useCache: false,
    });
    const source = await streamBytes(original);
    if (source.length !== currentOriginal.size) {
      throw new Error('The original changed while its thumbnail was repaired.');
    }
    expectedThumbnail = await renderThumbnail(
      source,
      details.contentType,
      context.sharp,
    );

    if (currentThumbnail.state === 'present') {
      const comparison = await compareThumbnailObject(
        pathname,
        currentThumbnail,
        expectedThumbnail,
        details.contentType,
        context,
      );
      if (comparison.status !== 'matching') {
        await context.client.query('ROLLBACK');
        return { id: row.id, status: comparison.status };
      }
      thumbnailByteSize = comparison.thumbnailByteSize;
      adoptedExistingObject = true;
    } else {
      thumbnailByteSize = expectedThumbnail.length;
    }

    const updated = await context.client.query(
      `
        UPDATE atlas_media
        SET thumbnail_path = $1, thumbnail_byte_size = $2
        WHERE id = $3
          AND storage_path = $4
          AND thumbnail_path IS NOT DISTINCT FROM $5
          AND thumbnail_byte_size = $6
        RETURNING id
      `,
      [
        pathname,
        thumbnailByteSize,
        current.id,
        current.storage_path,
        current.thumbnail_path,
        Number(current.thumbnail_byte_size),
      ],
    );
    if (!updated.rows[0]) {
      throw new Error('The locked media row changed during thumbnail repair.');
    }
    await context.client.query('COMMIT');

    if (adoptedExistingObject) {
      return {
        id: row.id,
        status: 'repaired',
        pathname,
        thumbnailByteSize,
        adoptedExistingObject: true,
        associationRecorded: true,
      };
    }
  } catch (error) {
    await context.client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }

  // Phase two reacquires both locks. If deletion won the gap after the first
  // commit, the row is gone and no upload occurs; otherwise deletion remains
  // blocked until the no-overwrite PUT finishes. A concurrent PUT is adopted
  // only after the same policy and byte-for-byte checks used above.
  try {
    await context.client.query('BEGIN');
    const current = await lockThumbnailRepairRow(
      context.client,
      row.id,
      pathname,
    );
    if (
      !repairRowMatchesAssociation(current, row, pathname, thumbnailByteSize)
    ) {
      await context.client.query('ROLLBACK');
      return {
        id: row.id,
        status: 'database-race',
        associationRecorded: current?.thumbnail_path === pathname,
      };
    }

    let currentThumbnail = await probePath(
      pathname,
      context.blob,
      context.auth,
    );
    if (currentThumbnail.state === 'error') {
      await context.client.query('ROLLBACK');
      return {
        id: row.id,
        status: 'probe-failed',
        associationRecorded: true,
      };
    }

    if (currentThumbnail.state === 'present') {
      const comparison = await compareThumbnailObject(
        pathname,
        currentThumbnail,
        expectedThumbnail,
        details.contentType,
        context,
      );
      if (comparison.status !== 'matching') {
        await restoreThumbnailAssociation(
          context.client,
          current,
          row,
          pathname,
          thumbnailByteSize,
        );
        await context.client.query('COMMIT');
        return {
          id: row.id,
          status: comparison.status,
          associationRecorded: Boolean(row.thumbnail_path),
        };
      }
      adoptedExistingObject = true;
    } else {
      try {
        await context.blob.put(pathname, expectedThumbnail, {
          access: 'private',
          ...context.auth,
          contentType: details.contentType,
          addRandomSuffix: false,
          allowOverwrite: false,
          maximumSizeInBytes: ATLAS_THUMBNAIL_MAX_BYTES,
          cacheControlMaxAge: CACHE_SECONDS,
        });
      } catch (uploadError) {
        currentThumbnail = await probePath(
          pathname,
          context.blob,
          context.auth,
        );
        if (currentThumbnail.state === 'present') {
          const comparison = await compareThumbnailObject(
            pathname,
            currentThumbnail,
            expectedThumbnail,
            details.contentType,
            context,
          );
          if (comparison.status !== 'matching') {
            await restoreThumbnailAssociation(
              context.client,
              current,
              row,
              pathname,
              thumbnailByteSize,
            );
            await context.client.query('COMMIT');
            return {
              id: row.id,
              status: comparison.status,
              associationRecorded: Boolean(row.thumbnail_path),
            };
          }
          adoptedExistingObject = true;
        } else {
          await context.client.query('ROLLBACK');
          return {
            id: row.id,
            status: 'upload-failed',
            code: diagnosticCode(uploadError),
            associationRecorded: true,
          };
        }
      }
    }

    await context.client.query('COMMIT');
    return {
      id: row.id,
      status: 'repaired',
      pathname,
      thumbnailByteSize,
      adoptedExistingObject,
      associationRecorded: true,
    };
  } catch (error) {
    await context.client.query('ROLLBACK').catch(() => undefined);
    return {
      id: row.id,
      status: 'failed',
      code: diagnosticCode(error),
      associationRecorded: true,
    };
  }
}

function summarize(findings, repairs) {
  const statuses = {};
  const issues = {};
  for (const finding of findings) {
    statuses[finding.status] = (statuses[finding.status] || 0) + 1;
    for (const issue of finding.issues)
      issues[issue] = (issues[issue] || 0) + 1;
  }
  const repairStatuses = {};
  for (const repair of repairs) {
    repairStatuses[repair.status] = (repairStatuses[repair.status] || 0) + 1;
  }
  return {
    inspected: findings.length,
    healthy: statuses.healthy || 0,
    findings: findings.length - (statuses.healthy || 0),
    statuses,
    issues,
    repairs: repairStatuses,
  };
}

function assertRepairTarget(options, target) {
  if (options.confirmDatabase !== target.databaseName) {
    throw new Error(
      `Repair confirmation must include --confirm-database=${target.databaseName}.`,
    );
  }
  if (options.confirmDatabaseUser !== target.databaseUser) {
    throw new Error(
      `Repair confirmation must include --confirm-database-user=${target.databaseUser}.`,
    );
  }
  if (options.confirmDatabaseEndpoint !== target.databaseEndpointFingerprint) {
    throw new Error(
      `Repair confirmation must include --confirm-database-endpoint=${target.databaseEndpointFingerprint}.`,
    );
  }
  if (options.confirmStore !== target.storeId) {
    throw new Error(
      `Repair confirmation must include --confirm-store=${target.storeId}.`,
    );
  }
}

function printHumanReport(report, logger = console) {
  logger.log(
    `Atlas media integrity: ${report.summary.inspected} inspected, ${report.summary.healthy} healthy, ${report.summary.findings} requiring attention.`,
  );
  logger.log(
    `Target: database ${report.target.databaseName}; user ${report.target.databaseUser}; endpoint ${report.target.databaseEndpointFingerprint}; Blob store ${report.target.storeId}.`,
  );
  for (const finding of report.records) {
    if (finding.status === 'healthy') continue;
    const paths = report.verbose
      ? ` original=${finding.storagePath} thumbnail=${finding.thumbnailPath || 'none'}`
      : '';
    logger.log(
      `[${finding.status}] ${finding.id}: ${finding.issues.join(', ')}${paths}`,
    );
  }
  for (const repair of report.repairs) {
    const association =
      repair.associationRecorded && repair.status !== 'repaired'
        ? ' (thumbnail path remains registered for retry)'
        : '';
    logger.log(`[repair:${repair.status}] ${repair.id}${association}`);
  }
}

async function run(options, dependencies = {}) {
  const database = dependencies.database || db;
  const blobSdk = dependencies.blob || {
    BlobNotFoundError,
    get,
    head,
    put,
  };
  const image = dependencies.sharp || sharp;
  const environment = dependencies.environment || process.env;
  const targetBlob = dependencies.blobTarget || blobTarget(environment);
  const endpointFingerprint = databaseEndpointFingerprint(environment);
  const readClient = await database.connect();
  let snapshot;
  try {
    snapshot = await loadRegisteredMedia(readClient, options);
  } finally {
    readClient.release();
  }

  if (options.mediaId && snapshot.rows.length === 0) {
    throw new Error(`Atlas media ${options.mediaId} was not found.`);
  }

  const target = {
    databaseName: snapshot.databaseName,
    databaseUser: snapshot.databaseUser,
    databaseEndpointFingerprint: endpointFingerprint,
    storeId: targetBlob.storeId,
  };
  if (options.repairMissingThumbnails) assertRepairTarget(options, target);

  const records = await mapWithConcurrency(
    snapshot.rows,
    options.concurrency,
    (row) => inspectRow(row, blobSdk, targetBlob.auth, options.verbose),
  );
  const repairs = [];
  if (options.repairMissingThumbnails) {
    const writeClient = await database.connect();
    try {
      for (let index = 0; index < snapshot.rows.length; index += 1) {
        const finding = records[index];
        if (finding.status !== 'missing_thumbnail') continue;
        try {
          repairs.push(
            await repairThumbnail(snapshot.rows[index], finding, {
              auth: targetBlob.auth,
              blob: blobSdk,
              client: writeClient,
              sharp: image,
            }),
          );
        } catch (error) {
          repairs.push({
            id: snapshot.rows[index].id,
            status: 'failed',
            code: diagnosticCode(error),
          });
        }
      }
    } finally {
      writeClient.release();
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    mode: options.repairMissingThumbnails
      ? 'repair-missing-thumbnails'
      : 'audit',
    target,
    filters: {
      limit: options.limit,
      mediaId: options.mediaId,
      userId: options.userId,
    },
    verbose: options.verbose,
    summary: summarize(records, repairs),
    records,
    repairs,
  };
  return report;
}

function reportExitCode(report) {
  if (
    report.summary.statuses.probe_error ||
    report.summary.repairs.failed ||
    report.summary.repairs['database-race'] ||
    report.summary.repairs['not-repairable'] ||
    report.summary.repairs['original-mismatch'] ||
    report.summary.repairs['object-race'] ||
    report.summary.repairs['object-mismatch'] ||
    report.summary.repairs['probe-failed'] ||
    report.summary.repairs['upload-failed']
  ) {
    return 1;
  }
  return report.summary.findings ? 2 : 0;
}

async function main(arguments_ = process.argv.slice(2)) {
  const options = parseOptions(arguments_);
  if (options.help) {
    console.log(usage());
    return 0;
  }
  let report;
  try {
    report = await run(options);
  } finally {
    await db.end();
  }
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else printHumanReport(report);

  return reportExitCode(report);
}

module.exports = {
  ATLAS_MEDIA_MAX_BYTES,
  ATLAS_THUMBNAIL_MAX_BYTES,
  LEGACY_THUMBNAIL_SIZE_SENTINEL,
  assertRepairTarget,
  blobTarget,
  databaseEndpointFingerprint,
  derivedThumbnailPath,
  inspectRow,
  loadRegisteredMedia,
  main,
  mapWithConcurrency,
  mediaPathDetails,
  parseOptions,
  printHumanReport,
  probePath,
  reportExitCode,
  renderThumbnail,
  repairThumbnail,
  rowPathDetails,
  run,
  summarize,
  usage,
  verifyThumbnail,
};

if (require.main === module) {
  main()
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      console.error(`Atlas media integrity failed: ${error.message}`);
      process.exitCode = 1;
    });
}
