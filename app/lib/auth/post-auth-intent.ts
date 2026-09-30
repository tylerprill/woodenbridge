export const NEW_MEMORY_INTENT = 'new-memory';

export type PostAuthIntent = typeof NEW_MEMORY_INTENT;

export function getPostAuthIntent(value: unknown): PostAuthIntent | undefined {
  return value === NEW_MEMORY_INTENT ? NEW_MEMORY_INTENT : undefined;
}

export function getPostAuthDestination(value: unknown) {
  return getPostAuthIntent(value) ? '/dashboard?new=memory' : '/dashboard';
}

export function withPostAuthIntent(path: string, value: unknown) {
  const intent = getPostAuthIntent(value);

  if (!intent) return path;

  const separator = path.includes('?') ? '&' : '?';
  return `${path}${separator}intent=${intent}`;
}
