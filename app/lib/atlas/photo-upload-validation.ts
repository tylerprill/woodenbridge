import { ATLAS_IMPORT_PHOTO_LIMITS } from './photo-import-client';

export const ACCEPTED_ATLAS_PHOTO_EXTENSIONS = [
  'jpg',
  'jpeg',
  'png',
  'webp',
  'heic',
  'heif',
] as const;

export const ACCEPTED_ATLAS_PHOTO_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
]);

function photoExtension(file: Pick<File, 'name'>) {
  return file.name.split('.').at(-1)?.toLowerCase() ?? '';
}

export function getAtlasPhotoFileProblem(
  file: Pick<File, 'name' | 'size' | 'type'>,
) {
  if (
    !ACCEPTED_ATLAS_PHOTO_MIME_TYPES.has(file.type.toLowerCase()) &&
    !ACCEPTED_ATLAS_PHOTO_EXTENSIONS.includes(
      photoExtension(file) as (typeof ACCEPTED_ATLAS_PHOTO_EXTENSIONS)[number],
    )
  ) {
    return 'Choose a JPG, PNG, WebP, HEIC, or HEIF photograph.';
  }
  if (!file.size || file.size > ATLAS_IMPORT_PHOTO_LIMITS.sourceMaxBytes) {
    return 'Choose a photograph smaller than 25 MB.';
  }
  return null;
}
