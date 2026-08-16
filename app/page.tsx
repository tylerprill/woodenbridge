import type { Metadata } from 'next';

import { getVerifiedSession } from '@/app/lib/auth/session';
import {
  SITE_DESCRIPTION,
  SITE_NAME,
  SITE_TITLE,
  SOCIAL_IMAGE,
} from '@/app/lib/site-config';
import { AmbientBackground } from '@/components/home/ambient-background';
import { FeaturedBridges } from '@/components/home/featured-bridges';
import { FieldJournal } from '@/components/home/field-journal';
import { HeroSection } from '@/components/home/hero-section';
import { HomeFooter } from '@/components/home/home-footer';
import { SiteHeader } from '@/components/home/site-header';
import { WebsiteJsonLd } from '@/components/seo/website-json-ld';

export const metadata: Metadata = {
  alternates: {
    canonical: '/',
  },
  keywords: [
    'personal travel map',
    'travel journal app',
    'photo travel journal',
    'map your travels',
    'visited places map',
  ],
  openGraph: {
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: '/',
    siteName: SITE_NAME,
    locale: 'en_US',
    type: 'website',
    images: [SOCIAL_IMAGE],
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [SOCIAL_IMAGE],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
      'max-video-preview': -1,
    },
  },
};

export default async function HomePage() {
  const session = await getVerifiedSession();
  const user = session?.user;

  return (
    <div className="home-shell">
      <WebsiteJsonLd />
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <AmbientBackground />
      <SiteHeader user={user} />
      <main id="main-content">
        <HeroSection />
        <FeaturedBridges />
        <FieldJournal />
      </main>
      <HomeFooter isLoggedIn={Boolean(user)} />
    </div>
  );
}
