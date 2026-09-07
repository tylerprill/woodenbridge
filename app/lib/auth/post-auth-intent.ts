export const PHOTO_IMPORT_INTENT = 'photo-import';

export type PostAuthIntent = typeof PHOTO_IMPORT_INTENT;

export function getPostAuthIntent(value: unknown): PostAuthIntent | undefined {
  return value === PHOTO_IMPORT_INTENT ? PHOTO_IMPORT_INTENT : undefined;
}

export function getPostAuthDestination(value: unknown) {
  return getPostAuthIntent(value) ? '/dashboard/import' : '/dashboard';
}

export function withPostAuthIntent(path: string, value: unknown) {
  const intent = getPostAuthIntent(value);

  if (!intent) return path;

  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}intent=${intent}`;
}
