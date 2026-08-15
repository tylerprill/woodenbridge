import type { Metadata } from 'next';
import '@/app/global.css';

const siteUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: 'Wooden Bridge — A Field Atlas',
  description:
    'Discover remarkable wooden bridges, the landscapes they cross, and the stories held in every timber.',
  openGraph: {
    title: 'Wooden Bridge — A Field Atlas',
    description:
      'Discover remarkable wooden bridges, the landscapes they cross, and the stories held in every timber.',
    images: [
      {
        url: '/og.png',
        width: 1732,
        height: 909,
        alt: 'Wooden Bridge — A field atlas for the curious',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Wooden Bridge — A Field Atlas',
    description:
      'Discover remarkable wooden bridges, the landscapes they cross, and the stories held in every timber.',
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
