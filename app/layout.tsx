import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import Script from 'next/script';
import { connection } from 'next/server';

import '@/app/global.css';
import { NAVIGATION_GUARD_BOOTSTRAP } from '@/app/lib/navigation-guard';
import { CSP_NONCE_HEADER } from '@/app/lib/security/content-security-policy';
import {
  getSiteManifestHref,
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TITLE,
  SITE_URL,
} from '@/app/lib/site-config';

export const metadata: Metadata = {
  metadataBase: SITE_URL,
  title: SITE_TITLE,
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  authors: [{ name: SITE_NAME, url: SITE_URL }],
  creator: SITE_NAME,
  publisher: SITE_NAME,
  category: 'travel',
  manifest: getSiteManifestHref(),
  verification: process.env.GOOGLE_SITE_VERIFICATION
    ? { google: process.env.GOOGLE_SITE_VERIFICATION }
    : undefined,
};

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: '#f5f2e9',
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // A fresh CSP nonce is generated in Proxy for every document request.
  // Waiting for the request is required for Next.js to nonce its framework
  // scripts; without this, statically generated auth pages would be blocked.
  await connection();
  const nonce = (await headers()).get(CSP_NONCE_HEADER) ?? undefined;

  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        {children}
        <Script
          id="field-atlas-navigation-guard"
          nonce={nonce}
          strategy="beforeInteractive"
        >
          {NAVIGATION_GUARD_BOOTSTRAP}
        </Script>
      </body>
    </html>
  );
}
