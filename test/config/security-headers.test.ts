const nextConfig = require('../../next.config.js');

describe('security headers', () => {
  it('allows the Vercel Blob upload API without opening connect-src broadly', async () => {
    const rules = await nextConfig.headers();
    const globalRule = rules.find(
      (rule: { source: string }) => rule.source === '/(.*)',
    );
    const policy = globalRule?.headers.find(
      (header: { key: string }) => header.key === 'Content-Security-Policy',
    )?.value;

    expect(policy).toContain('https://vercel.com/api/blob/');
    expect(policy).toContain('https://*.blob.vercel-storage.com');
    expect(policy).not.toContain('connect-src *');
  });
});
