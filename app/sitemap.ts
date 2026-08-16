import type { MetadataRoute } from 'next';

import { SITE_URL } from '@/app/lib/site-config';

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: SITE_URL.href,
      changeFrequency: 'monthly',
      priority: 1,
    },
  ];
}
