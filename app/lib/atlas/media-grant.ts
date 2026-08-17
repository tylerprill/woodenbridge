import 'server-only';

import { createHmac, timingSafeEqual } from 'node:crypto';

import {
  areAtlasMediaPathsPaired,
  isAllowedAtlasMediaType,
  isAtlasMediaPath,
} from './media-policy';

const MEDIA_GRANT_VERSION = 1;
const MEDIA_GRANT_LIFETIME_SECONDS = 12 * 60 * 60;
const MAX_MEDIA_GRANT_LENGTH = 4096;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AtlasMediaGrantSource = {
  id: string;
  entryId: string;
  storagePath: string;
  thumbnailPath: string | null;
  mimeType: string;
};

type MediaGrantPayload = {
  v: number;
  m: string;
  s: string;
  e: string;
  p: string;
  t: string | null;
  c: string;
  x: number;
};

function getSecret() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('AUTH_SECRET is not configured.');
  return secret;
}

function sign(value: string) {
  return createHmac('sha256', getSecret())
    .update(`field-atlas:media-grant:v${MEDIA_GRANT_VERSION}:${value}`)
    .digest();
}

function subjectForUser(userId: string) {
  return createHmac('sha256', getSecret())
    .update(`field-atlas:media-subject:v${MEDIA_GRANT_VERSION}:${userId}`)
    .digest('base64url');
}

function grantExpiry(now: number) {
  const currentHour = Math.floor(now / 3600) * 3600;
  return currentHour + MEDIA_GRANT_LIFETIME_SECONDS;
}

function isPayload(value: unknown): value is MediaGrantPayload {
  if (!value || typeof value !== 'object') return false;
  const payload = value as Partial<MediaGrantPayload>;
  return (
    payload.v === MEDIA_GRANT_VERSION &&
    typeof payload.m === 'string' &&
    UUID_PATTERN.test(payload.m) &&
    typeof payload.s === 'string' &&
    payload.s.length === 43 &&
    typeof payload.e === 'string' &&
    UUID_PATTERN.test(payload.e) &&
    typeof payload.p === 'string' &&
    payload.p.length <= 512 &&
    (payload.t === null ||
      (typeof payload.t === 'string' && payload.t.length <= 512)) &&
    typeof payload.c === 'string' &&
    isAllowedAtlasMediaType(payload.c) &&
    typeof payload.x === 'number' &&
    Number.isSafeInteger(payload.x)
  );
}

export function createAtlasMediaGrant(
  source: AtlasMediaGrantSource,
  userId: string,
  now = Math.floor(Date.now() / 1000),
) {
  if (
    !UUID_PATTERN.test(source.id) ||
    !UUID_PATTERN.test(source.entryId) ||
    !isAtlasMediaPath(source.storagePath, source.entryId) ||
    (source.thumbnailPath !== null &&
      !areAtlasMediaPathsPaired(
        source.storagePath,
        source.thumbnailPath,
        source.entryId,
      )) ||
    !isAllowedAtlasMediaType(source.mimeType)
  ) {
    throw new Error('Cannot grant access to invalid Atlas media metadata.');
  }

  const payload: MediaGrantPayload = {
    v: MEDIA_GRANT_VERSION,
    m: source.id,
    s: subjectForUser(userId),
    e: source.entryId,
    p: source.storagePath,
    t: source.thumbnailPath,
    c: source.mimeType,
    x: grantExpiry(now),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${encoded}.${sign(encoded).toString('base64url')}`;
}

export function verifyAtlasMediaGrant(
  grant: string,
  {
    mediaId,
    userId,
    now = Math.floor(Date.now() / 1000),
  }: {
    mediaId: string;
    userId: string;
    now?: number;
  },
): AtlasMediaGrantSource | null {
  if (!grant || grant.length > MAX_MEDIA_GRANT_LENGTH) return null;
  const parts = grant.split('.');
  if (parts.length !== 2) return null;

  try {
    const [encoded, encodedSignature] = parts;
    const suppliedSignature = Buffer.from(encodedSignature, 'base64url');
    const expectedSignature = sign(encoded);
    if (
      suppliedSignature.length !== expectedSignature.length ||
      !timingSafeEqual(suppliedSignature, expectedSignature)
    ) {
      return null;
    }

    const payload: unknown = JSON.parse(
      Buffer.from(encoded, 'base64url').toString('utf8'),
    );
    if (!isPayload(payload)) return null;
    if (
      payload.m !== mediaId ||
      payload.s !== subjectForUser(userId) ||
      payload.x <= now ||
      !isAtlasMediaPath(payload.p, payload.e) ||
      (payload.t !== null &&
        !areAtlasMediaPathsPaired(payload.p, payload.t, payload.e))
    ) {
      return null;
    }

    return {
      id: payload.m,
      entryId: payload.e,
      storagePath: payload.p,
      thumbnailPath: payload.t,
      mimeType: payload.c,
    };
  } catch {
    return null;
  }
}

export function createAuthenticatedAtlasMediaUrls(
  source: AtlasMediaGrantSource,
  userId: string,
) {
  const grant = createAtlasMediaGrant(source, userId);
  const deliveryUrl = `/api/atlas/media/${source.id}?grant=${grant}`;
  return {
    deliveryUrl,
    thumbnailUrl: source.thumbnailPath
      ? `/api/atlas/media/${source.id}?variant=thumbnail&grant=${grant}`
      : deliveryUrl,
  };
}
