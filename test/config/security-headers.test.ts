const nextConfig = require('../../next.config.js');
const { createSecurityHeaders } = require('../../config/security-headers.js');

function toHeaderMap(headers: Array<{ key: string; value: string }>) {
  return new Map(headers.map(({ key, value }) => [key, value]));
}

describe('static response security headers', () => {
  it('keeps CSP out of the static global rule so Proxy can supply one nonce per request', async () => {
    const rules = await nextConfig.headers();
    const globalRule = rules.find(
      (rule: { source: string }) => rule.source === '/(.*)',
    );
    const headers = toHeaderMap(globalRule?.headers ?? []);

    expect(headers.has('Content-Security-Policy')).toBe(false);
    expect(headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
    expect(headers.get('Origin-Agent-Cluster')).toBe('?1');
    expect(headers.get('Referrer-Policy')).toBe(
      'strict-origin-when-cross-origin',
    );
    expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headers.get('X-Frame-Options')).toBe('DENY');
    expect(headers.get('X-Permitted-Cross-Domain-Policies')).toBe('none');
  });

  it('enables HSTS only in production and explicitly scopes passkey capability', () => {
    const production = toHeaderMap(
      createSecurityHeaders({ isProduction: true }),
    );
    const development = toHeaderMap(
      createSecurityHeaders({ isProduction: false }),
    );

    expect(production.get('Strict-Transport-Security')).toBe(
      'max-age=63072000; includeSubDomains; preload',
    );
    expect(development.has('Strict-Transport-Security')).toBe(false);
    expect(production.get('Permissions-Policy')).toContain(
      'publickey-credentials-create=(self)',
    );
    expect(production.get('Permissions-Policy')).toContain(
      'publickey-credentials-get=(self)',
    );
    expect(production.get('Permissions-Policy')).toContain('camera=()');
    expect(production.get('Permissions-Policy')).toContain('geolocation=()');
  });

  it('sandboxes API responses that are opened as top-level documents', async () => {
    const rules = await nextConfig.headers();
    const apiRule = rules.find(
      (rule: { source: string }) => rule.source === '/api/:path*',
    );
    const headers = toHeaderMap(apiRule?.headers ?? []);
    const policy = headers.get('Content-Security-Policy');

    expect(policy).toContain("default-src 'none'");
    expect(policy).toContain("base-uri 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain('sandbox');
  });

  it.each(['/reset-password', '/verify-email'])(
    'keeps recovery state private on %s',
    async (source) => {
      const rules = await nextConfig.headers();
      const rule = rules.find(
        (candidate: { source: string }) => candidate.source === source,
      );
      const headers = toHeaderMap(rule?.headers ?? []);

      expect(headers.get('Referrer-Policy')).toBe('no-referrer');
      expect(headers.get('Cache-Control')).toBe('no-store, max-age=0');
    },
  );
});
