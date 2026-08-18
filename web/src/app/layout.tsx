import type { Metadata } from 'next';
import { JsonLd, siteStructuredData } from '@/lib/json-ld';
import { BRAND_NAME, SITE, canonicalUrl } from '@/lib/site';
import './globals.css';

const siteTitle = "SafeRide — Women's Safety App for Public Transport in Kenya";
const siteDescription =
  'Document harassment safely, understand your support options in Kenya, and choose exactly what leaves your phone. Free, offline-first, open source.';
const socialImage = `${SITE.url}/og.png`;

export const metadata: Metadata = {
  title: { default: siteTitle, template: '%s - SafeRide' },
  description: siteDescription,
  metadataBase: new URL(SITE.url),
  manifest: '/site.webmanifest',
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon.ico', sizes: 'any' },
      { url: '/icon.png', type: 'image/png', sizes: '192x192' },
    ],
    shortcut: '/favicon.ico',
    apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
  },
  openGraph: {
    type: 'website',
    locale: 'en_KE',
    url: canonicalUrl('/'),
    siteName: BRAND_NAME,
    title: siteTitle,
    description: siteDescription,
    images: [{ url: socialImage, width: 1200, height: 628, alt: 'SafeRide' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: siteTitle,
    description: siteDescription,
    images: [socialImage],
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preload" href="/fonts/MozillaHeadline-SemiBold.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
        <link rel="preload" href="/fonts/MozillaText-Regular.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body className="font-body antialiased">
        <JsonLd id="site-structured-data" data={siteStructuredData()} />
        {children}
      </body>
    </html>
  );
}
