import { z } from 'zod';

export const ATLAS_MEDIA_MAX_FILES = 6;
export const ATLAS_MEDIA_MAX_BYTES = 10 * 1024 * 1024;
export const ATLAS_MEDIA_MAX_DIMENSION = 20_000;
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
});

export const atlasMediaRegistrationSchema = z.object({
  entryId: z.string().uuid(),
  pathname: z.string().min(1).max(512),
  width: z.number().int().positive().max(ATLAS_MEDIA_MAX_DIMENSION),
  height: z.number().int().positive().max(ATLAS_MEDIA_MAX_DIMENSION),
  altText: z.string().trim().max(180),
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

export function createAtlasMediaPath(
  entryId: string,
  id: string,
  contentType: (typeof ATLAS_MEDIA_ALLOWED_TYPES)[number],
) {
  return `${atlasMediaPathPrefix(entryId)}${id}.${extensionByType[contentType]}`;
}

export function isAllowedAtlasMediaType(
  contentType: string,
): contentType is (typeof ATLAS_MEDIA_ALLOWED_TYPES)[number] {
  return ATLAS_MEDIA_ALLOWED_TYPES.some((type) => type === contentType);
}
