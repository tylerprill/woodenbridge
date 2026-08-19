import { getSiteManifestHref } from '@/app/lib/site-config';

describe('site manifest metadata', () => {
  it('keeps the installable manifest on production and local deployments', () => {
    expect(getSiteManifestHref('production')).toBe('/manifest.webmanifest');
    expect(getSiteManifestHref('development')).toBe('/manifest.webmanifest');
    expect(getSiteManifestHref(undefined)).toBe('/manifest.webmanifest');
  });

  it('omits the manifest link from Vercel previews protected by SSO', () => {
    expect(getSiteManifestHref('preview')).toBeUndefined();
  });
});
