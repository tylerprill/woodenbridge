import { z } from 'zod';

export const ATLAS_MEDIA_MAX_FILES = 6;
export const ATLAS_MEDIA_MAX_BYTES = 10 * 1024 * 1024;
export const ATLAS_MEDIA_MAX_DIMENSION = 20_000;
export const ATLAS_THUMBNAIL_MAX_BYTES = 2 * 1024 * 1024;
export const ATLAS_THUMBNAIL_MAX_DIMENSION = 1024;
export const ATLAS_THUMBNAIL_MIME_TYPE = 'image/webp';
export const ATLAS_THUMBNAIL_QUALITY = 0.82;
export const ATLAS_MEDIA_PAIR_RESERVED_BYTES =
  ATLAS_MEDIA_MAX_BYTES + ATLAS_THUMBNAIL_MAX_BYTES;
export const ATLAS_MEDIA_USER_STORAGE_MAX_BYTES = 512 * 1024 * 1024;
export const ATLAS_MEDIA_ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

const extensionByType = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
} as const;

export const atlasMediaClientPayloadSchema = z.object({
  entryId: z.string().uuid(),
  mediaId: z.string().uuid(),
  pathname: z.string().min(1).max(512),
  thumbnailPathname: z.string().min(1).max(512),
});

export const atlasMediaRegistrationSchema = z.object({
  entryId: z.string().uuid(),
  mediaId: z.string().uuid(),
  pathname: z.string().min(1).max(512),
  thumbnailPathname: z.string().min(1).max(512),
  width: z.number().int().positive().max(ATLAS_MEDIA_MAX_DIMENSION),
  height: z.number().int().positive().max(ATLAS_MEDIA_MAX_DIMENSION),
  altText: z.string().trim().max(180),
});

export const atlasMediaDiscardSchema = z.object({
  entryId: z.string().uuid(),
  mediaId: z.string().uuid(),
  pathname: z.string().min(1).max(512),
  thumbnailPathname: z.string().min(1).max(512),
});

export function atlasMediaPathPrefix(entryId: string) {
  return `atlas/memories/${entryId}/`;
}

export function isAtlasMediaPath(pathname: string, entryId: string) {
  const prefix = atlasMediaPathPrefix(entryId);
  const fileName = pathname.slice(prefix.length);

  return (
    pathname.startsWith(prefix) &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|webp)$/.test(
      fileName,
    )
  );
}

export function isAtlasThumbnailPath(pathname: string, entryId: string) {
  const prefix = atlasMediaPathPrefix(entryId);
  const fileName = pathname.slice(prefix.length);

  return (
    pathname.startsWith(prefix) &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.thumbnail\.webp$/.test(
      fileName,
    )
  );
}

export function isAtlasMediaUploadPath(pathname: string, entryId: string) {
  return (
    isAtlasMediaPath(pathname, entryId) ||
    isAtlasThumbnailPath(pathname, entryId)
  );
}

export function getAtlasMediaPathId(pathname: string) {
  const candidate = pathname.split('/').at(-1)?.split('.')[0];
  const parsed = z.string().uuid().safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

export function areAtlasMediaPathsPaired(
  pathname: string,
  thumbnailPathname: string,
  entryId: string,
) {
  const mediaId = getAtlasMediaPathId(pathname);
  return (
    isAtlasMediaPath(pathname, entryId) &&
    isAtlasThumbnailPath(thumbnailPathname, entryId) &&
    mediaId !== null &&
    mediaId === getAtlasMediaPathId(thumbnailPathname)
  );
}

export function createAtlasMediaPath(
  entryId: string,
  id: string,
  contentType: (typeof ATLAS_MEDIA_ALLOWED_TYPES)[number],
) {
  return `${atlasMediaPathPrefix(entryId)}${id}.${extensionByType[contentType]}`;
}

export function createAtlasThumbnailPath(entryId: string, id: string) {
  return `${atlasMediaPathPrefix(entryId)}${id}.thumbnail.webp`;
}

export function getAtlasThumbnailDimensions(width: number, height: number) {
  const scale = Math.min(
    1,
    ATLAS_THUMBNAIL_MAX_DIMENSION / Math.max(width, height),
  );
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function isAllowedAtlasMediaType(
  contentType: string,
): contentType is (typeof ATLAS_MEDIA_ALLOWED_TYPES)[number] {
  return ATLAS_MEDIA_ALLOWED_TYPES.some((type) => type === contentType);
}
