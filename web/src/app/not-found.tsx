import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Page not found',
  robots: { index: false, follow: false },
  alternates: { canonical: null },
  openGraph: undefined,
  twitter: undefined,
};

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-green-900 px-4 text-center text-white">
      <div>
        <p className="font-accent text-8xl font-semibold text-green-400">404</p>
        <h1 className="mt-6 font-display text-4xl font-semibold">Page not found</h1>
        <p className="mt-4 text-white/70">This SafeRide page is not available yet.</p>
        <Link href="/" className="mt-8 inline-flex border-3 border-white px-6 py-3 font-display font-bold text-white hover:bg-white hover:text-green-900">
          Back to Home
        </Link>
      </div>
    </main>
  );
}
