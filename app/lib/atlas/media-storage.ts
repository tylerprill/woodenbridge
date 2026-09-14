import 'server-only';

import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';

import {
  BlobNotFoundError,
  del,
  get,
  head,
  type GetBlobResult,
  type HeadBlobResult,
} from '@vercel/blob';

import {
  ATLAS_MEDIA_MAX_BYTES,
  ATLAS_THUMBNAIL_MAX_BYTES,
  getAtlasThumbnailContentType,
  isAllowedAtlasMediaType,
  isAtlasMediaPath,
  isAtlasThumbnailPath,
} from './media-policy';

const E2E_DATABASE_NAME = 'field_atlas_e2e';
const E2E_STORAGE_DIRECTORY_PATTERN =
  /^field-atlas-e2e-media(?:-[A-Za-z0-9._-]+)?$/;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const PRIVATE_MEDIA_CACHE = 'private, max-age=2592000';

type Environment = NodeJS.ProcessEnv;

export type E2EAtlasMediaStorageConfiguration = {
  appOrigin: string;
  root: string;
};

export type PutE2EAtlasMediaObjectInput = {
  pathname: string;
  contentType: string;
  bytes: Uint8Array;
};

export class AtlasMediaStorageConflictError extends Error {
  constructor() {
    super('That private media object already exists.');
    this.name = 'AtlasMediaStorageConflictError';
  }
}

function parseLoopbackUrl(value: string, label: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid URL.`);
  }

  if (
    parsed.protocol !== 'http:' ||
    !LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase()) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`${label} must be an HTTP loopback origin.`);
  }

  return parsed.origin;
}

function assertE2EDatabaseUrl(value: string | undefined, label: string) {
  if (!value) throw new Error(`${label} is required for E2E media storage.`);

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid PostgreSQL URL.`);
  }

  const overridesAuthorityHost = Array.from(parsed.searchParams.keys()).some(
    (key) => key.toLowerCase() === 'host',
  );
  if (
    !['postgres:', 'postgresql:'].includes(parsed.protocol) ||
    !LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase()) ||
    parsed.pathname !== `/${E2E_DATABASE_NAME}` ||
    overridesAuthorityHost
  ) {
    throw new Error(
      `${label} must target the loopback ${E2E_DATABASE_NAME} database.`,
    );
  }
}

async function resolveStorageRoot(environment: Environment) {
  const rawRoot = environment.E2E_MEDIA_STORAGE_ROOT?.trim();
  if (!rawRoot || !isAbsolute(rawRoot)) {
    throw new Error('E2E_MEDIA_STORAGE_ROOT must be an absolute path.');
  }

  const allowedParent = resolve(environment.RUNNER_TEMP?.trim() || tmpdir());
  const requestedRoot = resolve(rawRoot);
  const relativeRoot = relative(allowedParent, requestedRoot);
  if (
    !relativeRoot ||
    relativeRoot === '..' ||
    relativeRoot.startsWith(`..${sep}`) ||
    isAbsolute(relativeRoot) ||
    relativeRoot.includes(sep) ||
    !E2E_STORAGE_DIRECTORY_PATTERN.test(basename(requestedRoot))
  ) {
    throw new Error(
      'E2E_MEDIA_STORAGE_ROOT must name a dedicated direct child of the trusted temporary directory.',
    );
  }

  let boundary;
  try {
    boundary = await lstat(allowedParent);
  } catch {
    throw new Error('The E2E media temp boundary must be a real directory.');
  }
  if (!boundary.isDirectory() || boundary.isSymbolicLink()) {
    throw new Error('The E2E media temp boundary must be a real directory.');
  }

  try {
    const existing = await lstat(requestedRoot);
    if (!existing.isDirectory() || existing.isSymbolicLink()) {
      throw new Error(
        'E2E_MEDIA_STORAGE_ROOT must be a regular temporary directory.',
      );
    }
    if ((existing.mode & 0o077) !== 0) {
      throw new Error(
        'E2E_MEDIA_STORAGE_ROOT must not be accessible by other users.',
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }

  return requestedRoot;
}

export function isE2EAtlasMediaStorageEnabled(
  environment: Environment = process.env,
) {
  return environment.E2E_MEDIA_STORAGE_ADAPTER === 'filesystem';
}

export async function getE2EAtlasMediaStorageConfiguration(
  environment: Environment = process.env,
): Promise<E2EAtlasMediaStorageConfiguration> {
  if (!isE2EAtlasMediaStorageEnabled(environment)) {
    throw new Error(
      'Refusing local media storage without E2E_MEDIA_STORAGE_ADAPTER=filesystem.',
    );
  }
  if (environment.E2E_DATABASE_ADAPTER !== 'pg') {
    throw new Error(
      'E2E media storage requires the isolated PostgreSQL E2E adapter.',
    );
  }
  if (environment.NEXT_PUBLIC_E2E_MEDIA_STORAGE_ADAPTER !== 'filesystem') {
    throw new Error(
      'E2E media storage requires the matching public filesystem adapter.',
    );
  }
  if (environment.VERCEL === '1' || environment.VERCEL_ENV) {
    throw new Error('E2E media storage cannot run in a Vercel environment.');
  }

  assertE2EDatabaseUrl(environment.DATABASE_URL, 'DATABASE_URL');
  assertE2EDatabaseUrl(environment.POSTGRES_URL, 'POSTGRES_URL');

  const appOrigin = parseLoopbackUrl(environment.APP_URL ?? '', 'APP_URL');
  const authOrigin = parseLoopbackUrl(environment.AUTH_URL ?? '', 'AUTH_URL');
  if (authOrigin !== appOrigin) {
    throw new Error('APP_URL and AUTH_URL must use the same E2E origin.');
  }

  return { appOrigin, root: await resolveStorageRoot(environment) };
}

function atlasPathDetails(pathname: string) {
  const segments = pathname.split('/');
  const entryId = segments.length === 4 ? segments[2] : '';
  const isThumbnail = isAtlasThumbnailPath(pathname, entryId);
  const isOriginal = isAtlasMediaPath(pathname, entryId);
  if (!isThumbnail && !isOriginal) {
    throw new Error('Invalid Atlas media storage pathname.');
  }

  const contentType = isThumbnail
    ? getAtlasThumbnailContentType(pathname)
    : pathname.endsWith('.jpg')
      ? ('image/jpeg' as const)
      : pathname.endsWith('.png')
        ? ('image/png' as const)
        : pathname.endsWith('.webp')
          ? ('image/webp' as const)
          : null;
  if (!contentType || (!isThumbnail && !isAllowedAtlasMediaType(contentType))) {
    throw new Error('Invalid Atlas media storage pathname.');
  }

  return {
    contentType,
    maximumBytes: isThumbnail
      ? ATLAS_THUMBNAIL_MAX_BYTES
      : ATLAS_MEDIA_MAX_BYTES,
  };
}

function objectName(pathname: string) {
  atlasPathDetails(pathname);
  return `${createHash('sha256').update(pathname).digest('hex')}.blob`;
}

async function prepareLocalStorage(environment: Environment = process.env) {
  const configuration = await getE2EAtlasMediaStorageConfiguration(environment);
  await mkdir(configuration.root, { mode: 0o700, recursive: true });
  const root = await lstat(configuration.root);
  if (
    !root.isDirectory() ||
    root.isSymbolicLink() ||
    (root.mode & 0o077) !== 0
  ) {
    throw new Error('The E2E media storage root is not secure.');
  }
  return configuration;
}

async function localObjectMetadata(
  pathname: string,
  environment: Environment = process.env,
): Promise<HeadBlobResult> {
  const details = atlasPathDetails(pathname);
  const configuration = await prepareLocalStorage(environment);
  const filePath = join(configuration.root, objectName(pathname));
  let bytes: Buffer;
  let fileStat;
  try {
    const file = await open(
      filePath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const openedStat = await file.stat();
      if (!openedStat.isFile()) throw new Error('Invalid E2E media object.');
      bytes = await file.readFile();
      fileStat = openedStat;
    } finally {
      await file.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new BlobNotFoundError();
    }
    throw error;
  }

  const encodedPath = encodeURIComponent(pathname);
  const url = `${configuration.appOrigin}/api/atlas/media/e2e-object?pathname=${encodedPath}`;
  return {
    pathname,
    contentType: details.contentType,
    size: bytes.byteLength,
    uploadedAt: fileStat.mtime,
    etag: `"${createHash('sha256').update(bytes).digest('hex')}"`,
    contentDisposition: `inline; filename="${basename(pathname)}"`,
    cacheControl: PRIVATE_MEDIA_CACHE,
    url,
    downloadUrl: `${url}&download=1`,
  };
}

export function getAtlasBlobToken() {
  const token = process.env.ATLAS_BLOB_READ_WRITE_TOKEN;
  if (!token) {
    throw new Error('ATLAS_BLOB_READ_WRITE_TOKEN is not configured.');
  }
  return token;
}

export async function headAtlasMediaObject(pathname: string) {
  if (!isE2EAtlasMediaStorageEnabled()) {
    return head(pathname, { token: getAtlasBlobToken() });
  }
  return localObjectMetadata(pathname);
}

export async function readAtlasMediaObject(
  pathname: string,
  options: { ifNoneMatch?: string } = {},
): Promise<GetBlobResult | null> {
  if (!isE2EAtlasMediaStorageEnabled()) {
    return get(pathname, {
      access: 'private',
      token: getAtlasBlobToken(),
      ifNoneMatch: options.ifNoneMatch,
    });
  }

  let metadata: HeadBlobResult;
  try {
    metadata = await localObjectMetadata(pathname);
  } catch (error) {
    if (error instanceof BlobNotFoundError) return null;
    throw error;
  }
  const headers = new Headers({
    'Cache-Control': metadata.cacheControl,
    'Content-Disposition': metadata.contentDisposition,
    ETag: metadata.etag,
    'Last-Modified': metadata.uploadedAt.toUTCString(),
  });
  if (options.ifNoneMatch === metadata.etag) {
    return {
      statusCode: 304,
      stream: null,
      headers,
      blob: { ...metadata, contentType: null, size: null },
    };
  }

  const configuration = await prepareLocalStorage();
  const file = await open(
    join(configuration.root, objectName(pathname)),
    constants.O_RDONLY | constants.O_NOFOLLOW,
  );
  let bytes: Buffer;
  try {
    const openedStat = await file.stat();
    if (!openedStat.isFile()) throw new Error('Invalid E2E media object.');
    bytes = await file.readFile();
  } finally {
    await file.close();
  }
  headers.set('Content-Length', String(bytes.byteLength));
  headers.set('Content-Type', metadata.contentType);
  return {
    statusCode: 200,
    stream: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(bytes));
        controller.close();
      },
    }),
    headers,
    blob: metadata,
  };
}

export async function putE2EAtlasMediaObject({
  pathname,
  contentType,
  bytes,
}: PutE2EAtlasMediaObjectInput) {
  const details = atlasPathDetails(pathname);
  if (
    details.contentType !== contentType ||
    bytes.byteLength < 1 ||
    bytes.byteLength > details.maximumBytes
  ) {
    throw new Error('Invalid E2E Atlas media object.');
  }

  const configuration = await prepareLocalStorage();
  const filePath = join(configuration.root, objectName(pathname));
  let file;
  try {
    file = await open(
      filePath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      0o600,
    );
    await file.writeFile(bytes);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new AtlasMediaStorageConflictError();
    }
    if (file) await unlink(filePath).catch(() => undefined);
    throw error;
  } finally {
    await file?.close();
  }

  return localObjectMetadata(pathname);
}

export async function deleteAtlasMediaObjects(pathnames: string[]) {
  if (!pathnames.length) return;
  if (!isE2EAtlasMediaStorageEnabled()) {
    await del(pathnames, { token: getAtlasBlobToken() });
    return;
  }

  const configuration = await prepareLocalStorage();
  await Promise.all(
    pathnames.map(async (pathname) => {
      const filePath = join(configuration.root, objectName(pathname));
      try {
        const file = await lstat(filePath);
        if (!file.isFile()) throw new Error('Invalid E2E media object.');
        await unlink(filePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
    }),
  );
}
