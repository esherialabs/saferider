/* eslint-disable @next/next/no-img-element */
import Link from 'next/link';
import { SITE } from '@/lib/site';

export default function EditorialGrid() {
  return (
    <>
      <section className="stream-section" aria-label="SafeRide programs">
        <div className="mx-auto grid max-w-[1200px] grid-cols-1 gap-0 px-4 py-14 sm:px-6 md:grid-cols-3 md:py-24 lg:px-0">
          {SITE.pillars.map((pillar, index) => (
            <article
              key={pillar.title}
              className={`${pillar.tone} ${pillar.radius} interactive-card relative flex min-h-[20rem] flex-col justify-between border-3 border-black p-8 md:min-h-[23rem] md:p-9 ${
                index === 1 ? 'md:-translate-y-4' : ''
              } ${index === 2 ? 'md:translate-y-8' : ''} ${index > 0 ? 'md:-ml-3' : ''}`}
            >
              <p className="mb-10 text-xs font-semibold uppercase tracking-normal">0{index + 1}</p>
              <h3 className="font-display text-[clamp(2rem,4vw,3.4rem)] font-semibold leading-[0.92] tracking-normal">
                {pillar.title}
              </h3>
              <Link href={pillar.href} className="interactive-button mt-10 inline-flex w-fit items-center gap-2 border-b-3 border-black pb-1 font-bold">
                {pillar.action} <span aria-hidden="true">&rarr;</span>
              </Link>
            </article>
          ))}
        </div>
      </section>

      <section data-testid="editorial-grid" aria-labelledby="force-title" className="pb-6 md:pb-14">
        <div className="mx-auto max-w-[1200px] px-4 pt-12 sm:px-6 lg:px-0">
          <div className="title-shape mb-8 pt-16">
            <h2 id="force-title" className="section-title bg-[#F7EC36] px-2 py-4 pr-8">
              Be a force for safer transport.
            </h2>
          </div>
        </div>
        <div className="mx-auto flex max-w-[1200px] flex-col gap-6 px-4 sm:px-6 md:gap-8 lg:px-0">
          {SITE.editorialCards.map((card, index) => (
            <article
              key={card.title}
              className={`${card.tone} ${card.rounded ?? ''} interactive-card flex min-h-[24rem] flex-col overflow-hidden border-3 border-black md:flex-row ${
                index === 0 ? 'md:w-[88%]' : ''
              } ${index === 1 ? 'md:ml-auto md:w-[78%] md:flex-row-reverse' : ''} ${index === 2 ? 'md:w-[92%]' : ''}`}
            >
              <div className="relative min-h-[17rem] flex-1 overflow-hidden bg-white/25 md:min-h-[24rem] md:w-[45%]">
                <img src={card.image} alt={card.imageAlt} loading="lazy" decoding="async" className="absolute inset-0 h-full w-full object-cover" />
                <div className="absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-white/10" aria-hidden="true" />
                <div className="absolute bottom-6 right-6 h-20 w-20 rounded-tl-[2rem] rounded-br-[2rem] border-3 border-black bg-white/85" aria-hidden="true" />
              </div>
              <div className="flex flex-1 flex-col justify-center p-7 md:p-11">
                <p className="mb-5 text-sm font-semibold uppercase tracking-normal">{card.tag}</p>
                <h3 className="font-display text-[clamp(1.9rem,3.4vw,3.35rem)] font-semibold leading-[0.94] tracking-normal">
                  {card.title}
                </h3>
                <p className="mt-5 max-w-xl text-lg leading-8">{card.body}</p>
                <Link href={card.href} className="interactive-button mt-8 inline-flex w-fit items-center gap-2 border-b-3 border-black pb-1 font-bold">
                  {card.link} <span aria-hidden="true">&rarr;</span>
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
