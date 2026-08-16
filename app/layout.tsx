import type { Metadata } from 'next';
import '@/app/global.css';

const siteUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: 'Field Atlas — Your travels, thoughtfully mapped',
  description:
    'Pin the places you have traveled, add photos and field notes, and keep every journey in one personal atlas.',
  openGraph: {
    title: 'Field Atlas — Your travels, thoughtfully mapped',
    description:
      'Pin the places you have traveled, add photos and field notes, and keep every journey in one personal atlas.',
    images: [
      {
        url: '/og.png',
        width: 1732,
        height: 909,
        alt: 'Field Atlas — Your travels, thoughtfully mapped',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Field Atlas — Your travels, thoughtfully mapped',
    description:
      'Pin the places you have traveled, add photos and field notes, and keep every journey in one personal atlas.',
    images: ['/og.png'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
