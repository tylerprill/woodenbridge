export const SITE_NAME = 'Field Atlas';

export const SITE_TITLE = 'Field Atlas | Personal Travel Map & Photo Journal';

export const SITE_DESCRIPTION =
  'Create a personal travel map with pins, photos, and field notes. Field Atlas keeps every place you have visited in one private, beautiful travel journal.';

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
