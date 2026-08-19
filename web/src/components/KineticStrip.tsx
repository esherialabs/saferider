'use client';

import { useEffect, useState } from 'react';

const phrases = [
  'Safer rides for every woman.',
  'Your evidence. Your control.',
  'Report. Refer. Stay safe.',
  'Justice starts with one tap.',
];

export default function KineticStrip() {
  const [activePhrase, setActivePhrase] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setActivePhrase((current) => (current + 1) % phrases.length);
    }, 3000);

    return () => window.clearInterval(interval);
  }, []);

  return (
    <section data-testid="kinetic-strip" className="py-12 text-black md:py-16" aria-label="SafeRide message">
      <div className="mx-auto max-w-content rounded-none bg-[#FF9E5F] px-4 py-10 text-center sm:px-6 md:rounded-[0_2rem] lg:px-8">
        <div className="relative mx-auto h-28 max-w-5xl overflow-hidden md:h-32" aria-live="polite">
          {phrases.map((phrase, index) => {
            const active = activePhrase === index;
            return (
              <span
                key={phrase}
                aria-hidden={!active}
                data-testid={active ? 'kinetic-headline' : undefined}
                className={`absolute inset-0 flex items-center justify-center text-balance font-display text-[clamp(2.25rem,6vw,4.5rem)] font-semibold leading-[0.95] tracking-normal text-green-950 transition-transform duration-700 ${
                  active ? 'visible translate-y-0 opacity-100' : 'invisible translate-y-4 opacity-0'
                }`}
              >
                {phrase}
              </span>
            );
          })}
        </div>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-black/75">An open-source safety app for women using Nairobi&apos;s public transport.</p>
      </div>
    </section>
  );
}
