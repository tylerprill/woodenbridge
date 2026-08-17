import 'server-only';

const MINIMUM_SECRET_BYTES = 32;

export function assertSecretStrength(name: string, value: string | undefined) {
  if (!value) throw new Error(`${name} is required.`);

  if (Buffer.byteLength(value, 'utf8') < MINIMUM_SECRET_BYTES) {
    throw new Error(
      `${name} must contain at least 32 bytes of secret material.`,
    );
  }

  return value;
}

export function getAuthSessionSecret() {
  return assertSecretStrength('AUTH_SECRET', process.env.AUTH_SECRET);
}

export function getAuthenticationHmacSecret() {
  const configured = process.env.AUTH_HMAC_SECRET;

  if (configured) return assertSecretStrength('AUTH_HMAC_SECRET', configured);
  if (process.env.NODE_ENV !== 'production') return getAuthSessionSecret();

  throw new Error('AUTH_HMAC_SECRET is required in production.');
}

export function getMediaGrantSecret() {
  const configured = process.env.MEDIA_GRANT_SECRET;

  if (configured) return assertSecretStrength('MEDIA_GRANT_SECRET', configured);
  if (process.env.NODE_ENV !== 'production') return getAuthSessionSecret();

  throw new Error('MEDIA_GRANT_SECRET is required in production.');
}
