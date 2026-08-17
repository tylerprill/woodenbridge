import {
  assertSecretStrength,
  getAuthenticationHmacSecret,
  getMediaGrantSecret,
} from '@/app/lib/auth/secrets';

const originalEnvironment = process.env;

describe('authentication secret separation', () => {
  afterEach(() => {
    process.env = originalEnvironment;
  });

  it('rejects missing and undersized secrets', () => {
    expect(() => assertSecretStrength('TEST_SECRET', undefined)).toThrow(
      'TEST_SECRET is required.',
    );
    expect(() => assertSecretStrength('TEST_SECRET', 'x'.repeat(31))).toThrow(
      'at least 32 bytes',
    );
    expect(assertSecretStrength('TEST_SECRET', 'x'.repeat(32))).toHaveLength(
      32,
    );
  });

  it('requires purpose-specific secrets in production', () => {
    process.env = {
      ...originalEnvironment,
      NODE_ENV: 'production',
      AUTH_SECRET: 'a'.repeat(32),
    };
    delete process.env.AUTH_HMAC_SECRET;
    delete process.env.MEDIA_GRANT_SECRET;

    expect(() => getAuthenticationHmacSecret()).toThrow(
      'AUTH_HMAC_SECRET is required in production.',
    );
    expect(() => getMediaGrantSecret()).toThrow(
      'MEDIA_GRANT_SECRET is required in production.',
    );
  });

  it('permits the session secret fallback only outside production', () => {
    process.env = {
      ...originalEnvironment,
      NODE_ENV: 'test',
      AUTH_SECRET: 'development-only-secret-material'.padEnd(32, '!'),
    };
    delete process.env.AUTH_HMAC_SECRET;
    delete process.env.MEDIA_GRANT_SECRET;

    expect(getAuthenticationHmacSecret()).toBe(process.env.AUTH_SECRET);
    expect(getMediaGrantSecret()).toBe(process.env.AUTH_SECRET);
  });
});
