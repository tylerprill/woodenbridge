import { headers } from 'next/headers';

import { CSP_NONCE_HEADER } from '@/app/lib/security/content-security-policy';
import {
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
  SOCIAL_IMAGE,
} from '@/app/lib/site-config';

const websiteJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  '@id': `${SITE_URL.href}#website`,
  name: SITE_NAME,
  url: SITE_URL.href,
  description: SITE_DESCRIPTION,
  image: new URL(SOCIAL_IMAGE.url, SITE_URL).href,
  inLanguage: 'en-US',
};

export async function WebsiteJsonLd() {
  const nonce = (await headers()).get(CSP_NONCE_HEADER) ?? undefined;

  return (
    <script
      nonce={nonce}
      type="application/ld+json"
      dangerouslySetInnerHTML={{
        __html: JSON.stringify(websiteJsonLd).replace(/</g, '\\u003c'),
      }}
    />
  );
}
