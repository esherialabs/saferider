import { SITE } from '@/lib/site';

export default function ImpactNumbers() {
  return (
    <section data-testid="impact-numbers" className="border-y-3 border-black bg-white py-16 text-black md:py-24" aria-labelledby="impact-heading">
      <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-0">
        <div className="grid gap-8 md:grid-cols-[0.95fr_1.4fr] md:items-end">
          <div>
            <p className="font-display text-sm font-semibold uppercase tracking-normal text-green-700">Impact</p>
            <h2 id="impact-heading" className="mt-3 font-display text-[clamp(2.75rem,7vw,5.75rem)] font-semibold leading-[0.9] tracking-normal">
              Safety before scale.
            </h2>
          </div>
          <p className="max-w-2xl text-xl leading-8 text-black/72 md:justify-self-end">
            These are product guardrails, not vanity metrics: SafeRide should first prove that a rider can keep control of what is captured, redacted, shared, and deleted.
          </p>
        </div>

        <div className="mt-12 grid overflow-hidden border-3 border-black md:grid-cols-3">
          {SITE.impact.map((stat, index) => (
            <article
              key={stat.label}
              className={`interactive-card min-h-[24rem] border-b-3 border-black p-6 last:border-b-0 md:border-b-0 md:border-r-3 md:p-8 md:last:border-r-0 ${
                index === 0 ? 'bg-[#F88539]' : ''
              } ${index === 1 ? 'bg-[#F7EC36]' : ''} ${index === 2 ? 'bg-[#53E17C]' : ''}`}
            >
              <p
                data-testid={`impact-stat-value-${index + 1}`}
                className="font-display text-[clamp(7rem,16vw,13rem)] font-semibold leading-[0.78] tracking-normal text-black"
              >
                {stat.value}
                {stat.suffix ? <span className="align-baseline text-[0.35em]">{stat.suffix}</span> : null}
              </p>
              <h3 className="mt-10 max-w-sm font-display text-[clamp(1.75rem,3vw,2.35rem)] font-semibold leading-[0.95] tracking-normal text-black">
                {stat.label}
              </h3>
              <p className="mt-8 text-sm font-semibold uppercase tracking-normal text-black/65">0{index + 1}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
