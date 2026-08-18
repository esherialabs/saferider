'use client';

import Link from 'next/link';

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="grid min-h-screen place-items-center bg-green-900 px-4 text-center text-white">
      <div className="max-w-xl">
        <p className="font-display text-sm font-bold uppercase tracking-normal text-green-300">Something went wrong</p>
        <h1 className="mt-5 font-display text-5xl font-semibold">SafeRide could not load this page.</h1>
        <p className="mt-5 text-white/70">{error.message || 'Please try again or return home.'}</p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <button type="button" className="border-3 border-white px-6 py-3 font-display font-bold text-white hover:bg-white hover:text-green-900" onClick={reset}>
            Try Again
          </button>
          <Link href="/" className="bg-white px-6 py-3 font-display font-bold text-green-900 hover:bg-green-50">
            Go Home
          </Link>
        </div>
      </div>
    </main>
  );
}
