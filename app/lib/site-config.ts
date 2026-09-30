export const SITE_NAME = 'Field Atlas';

export const SITE_TITLE = 'Field Atlas | Personal Travel Map & Photo Journal';

export const SITE_DESCRIPTION =
  'Place a private Memory, add its photos and details, and connect Memories into a mapped Journey with Field Atlas.';

export function getSiteManifestHref(
  deploymentEnvironment = process.env.VERCEL_ENV,
) {
  // Vercel Deployment Protection redirects preview asset requests through its
  // SSO endpoint. A protected preview therefore cannot load a same-origin web
  // manifest, and widening manifest-src to the SSO origin would weaken CSP for
  // a response that is HTML rather than a manifest. Production remains fully
  // installable; previews simply omit the manifest link.
  return deploymentEnvironment === 'preview'
    ? undefined
    : '/manifest.webmanifest';
}

function normalizeSiteUrl(value: string) {
  const url =
    value.startsWith('http://') || value.startsWith('https://')
      ? value
      : `https://${value}`;

  return new URL(url);
}

export const SITE_URL = normalizeSiteUrl(
  process.env.APP_URL ??
    process.env.VERCEL_PROJECT_PRODUCTION_URL ??
    process.env.VERCEL_URL ??
    'http://localhost:3000',
);

export const SOCIAL_IMAGE = {
  url: '/og.png',
  width: 1731,
  height: 909,
  alt: 'Field Atlas, a personal travel map and photo journal',
} as const;
