import type { MetadataRoute } from 'next';

import { SITE_URL } from '@/app/lib/site-config';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: ['/dashboard', '/dashboard/'],
    },
    sitemap: new URL('/sitemap.xml', SITE_URL).href,
    host: SITE_URL.origin,
  };
}
