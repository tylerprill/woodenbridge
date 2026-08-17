const NONCE_PATTERN = /^[A-Za-z0-9+/_=-]{16,128}$/;

export const CSP_NONCE_HEADER = 'x-nonce';

export function createContentSecurityPolicy({
  isDevelopment,
  nonce,
}: {
  isDevelopment: boolean;
  nonce: string;
}) {
  if (!NONCE_PATTERN.test(nonce)) {
    throw new Error('A valid per-request CSP nonce is required.');
  }

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDevelopment ? " 'unsafe-eval'" : ''}`,
    "script-src-attr 'none'",
    "style-src 'self'",
    `style-src-elem 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' blob: data: https://tiles.openfreemap.org",
    "font-src 'self'",
    `connect-src 'self' https://tiles.openfreemap.org https://vercel.com/api/blob/ https://*.blob.vercel-storage.com${isDevelopment ? ' ws: wss:' : ''}`,
    "worker-src 'self' blob:",
    "child-src 'self' blob:",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "manifest-src 'self'",
    ...(isDevelopment ? [] : ['upgrade-insecure-requests']),
  ].join('; ');
}
