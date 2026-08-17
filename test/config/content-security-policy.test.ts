import { createContentSecurityPolicy } from '@/app/lib/security/content-security-policy';

function directive(policy: string, name: string) {
  return policy
    .split(';')
    .map((value) => value.trim())
    .find((value) => value === name || value.startsWith(`${name} `));
}

describe('per-request content security policy', () => {
  const nonce = 'vV6h8z6f4yF0YlMJzVOT4Q==';

  it('uses a strict production script policy without unsafe-inline or eval', () => {
    const policy = createContentSecurityPolicy({
      nonce,
      isDevelopment: false,
    });
    const scripts = directive(policy, 'script-src');

    expect(scripts).toContain("'self'");
    expect(scripts).toContain(`'nonce-${nonce}'`);
    expect(scripts).toContain("'strict-dynamic'");
    expect(scripts).not.toContain("'unsafe-inline'");
    expect(scripts).not.toContain("'unsafe-eval'");
    expect(directive(policy, 'script-src-attr')).toBe("script-src-attr 'none'");
    expect(policy).toContain('upgrade-insecure-requests');
  });

  it('allows only the development evaluator needed by React debugging', () => {
    const policy = createContentSecurityPolicy({
      nonce,
      isDevelopment: true,
    });

    expect(directive(policy, 'script-src')).toContain("'unsafe-eval'");
    expect(directive(policy, 'script-src')).not.toContain("'unsafe-inline'");
    expect(policy).not.toContain('upgrade-insecure-requests');
  });

  it('restricts style elements while retaining required React style attributes', () => {
    const policy = createContentSecurityPolicy({
      nonce,
      isDevelopment: false,
    });

    expect(directive(policy, 'style-src')).toBe("style-src 'self'");
    expect(directive(policy, 'style-src-elem')).toContain(`'nonce-${nonce}'`);
    expect(directive(policy, 'style-src-attr')).toBe(
      "style-src-attr 'unsafe-inline'",
    );
  });

  it('retains only the product endpoints required by maps and private uploads', () => {
    const policy = createContentSecurityPolicy({
      nonce,
      isDevelopment: false,
    });
    const connections = directive(policy, 'connect-src');

    expect(connections).toContain('https://tiles.openfreemap.org');
    expect(connections).toContain('https://vercel.com/api/blob/');
    expect(connections).toContain('https://*.blob.vercel-storage.com');
    expect(connections).not.toContain('connect-src *');
    expect(directive(policy, 'frame-src')).toBe("frame-src 'none'");
    expect(directive(policy, 'object-src')).toBe("object-src 'none'");
  });

  it('rejects malformed nonces before constructing a header', () => {
    expect(() =>
      createContentSecurityPolicy({
        nonce: "bad'; script-src *",
        isDevelopment: false,
      }),
    ).toThrow('A valid per-request CSP nonce is required.');
  });
});
