import Link from 'next/link';
import Footer from '@/components/Footer';
import Nav from '@/components/Nav';
import { ANDROID_RELEASE, formatBytes } from '@/lib/android-release';
import { JsonLd, breadcrumbSchema, faqPageSchema, graph, softwareApplicationSchema } from '@/lib/json-ld';
import { pageMetadata } from '@/lib/metadata';
import { SITE } from '@/lib/site';

export const metadata = pageMetadata({
  title: 'Download SafeRide v0.5.8 for Android',
  absoluteTitle: true,
  description:
    'Download the signed SafeRide v0.5.8 Android testing preview for arm64 devices, verify its SHA-256 checksum, and review model storage and safety limits.',
  path: '/download',
});

const installSteps = [
  `Use an arm64 Android ${ANDROID_RELEASE.minimumApi}/8.0 or newer physical device with at least 8–10 GB free before setup.`,
  'Download the signed APK and compare its SHA-256 value before allowing “Install unknown apps” for your trusted browser or file manager.',
  'Open SafeRide, complete onboarding, review permissions, and configure stealth and quick-exit settings before testing.',
  'Do not enter real survivor evidence during unsupervised testing; use synthetic reports until safeguarding review approves live pilots.',
];

const pilotNotes = [
  'This is a public testing preview, not a production, emergency-service, survivor-facing, UNICEF-approved, or Google Play release.',
  `The first local-AI setup downloads ${formatBytes(ANDROID_RELEASE.model.sizeBytes)} and requires about ${formatBytes(ANDROID_RELEASE.model.freeStorageBytes)} free. Use stable Wi-Fi and keep the device charging.`,
  'The tested flow supports pause, resume after a Wi-Fi change, checksum verification, restart without re-downloading, and subsequent synthetic chat.',
  'The required lower-memory Android device matrix and broader release approvals remain incomplete.',
];

const downloadFaqs = [
  {
    question: 'What platform does the SafeRide pilot support?',
    answer: `This APK supports arm64-v8a physical devices on Android ${ANDROID_RELEASE.minimumApi}/8.0 or newer. iOS is not included.`,
  },
  {
    question: 'Should testers enter real survivor evidence?',
    answer: 'No. Use synthetic reports until safeguarding review approves live pilot use.',
  },
  {
    question: 'Why is the model download much larger than the APK?',
    answer: `The signed APK is ${formatBytes(ANDROID_RELEASE.artifact.sizeBytes)}, while the separate on-device LiteRT-LM model is ${formatBytes(ANDROID_RELEASE.model.sizeBytes)}. The model downloads once, is verified locally, and should remain available after restart.`,
  },
] as const;

export default function Page() {
  return (
    <>
      <Nav />
      <main id="main-content" className="bg-white pt-20">
        <JsonLd
          id="download-structured-data"
          data={graph([
            breadcrumbSchema([{ name: 'Download App', path: '/download' }]),
            softwareApplicationSchema(),
            faqPageSchema([...downloadFaqs]),
          ])}
        />
        <section className="mx-auto max-w-[1200px] px-4 py-14 sm:px-6 lg:px-0 lg:py-20">
          <p className="mb-4 text-sm font-semibold uppercase tracking-normal">Download App</p>
          <h1 className="max-w-5xl font-display text-[clamp(2.75rem,7vw,5.75rem)] font-semibold leading-[0.9] tracking-normal">
            Download SafeRide for Android.
          </h1>
          <p className="mt-8 max-w-3xl text-xl leading-8 text-green-950/80 md:text-2xl md:leading-9">
            {ANDROID_RELEASE.releaseName} is the signed, checksum-bound build that passed clean-install and same-certificate upgrade smoke. Use it only for controlled testing with synthetic data.
          </p>
          <div className="mt-10 flex flex-wrap gap-4">
            <Link href={SITE.apkUrl} target="_blank" rel="noreferrer" className="inline-flex border-3 border-black bg-[#53E17C] px-6 py-4 font-display font-semibold text-green-950 transition hover:-translate-x-1 hover:-translate-y-1 hover:shadow-[5px_5px_0_#0D1B12]">
              Download Android APK
            </Link>
            <Link href={ANDROID_RELEASE.artifact.checksumUrl} target="_blank" rel="noreferrer" className="inline-flex border-3 border-black bg-[#F7EC36] px-6 py-4 font-display font-semibold text-green-950 transition hover:-translate-x-1 hover:-translate-y-1 hover:shadow-[5px_5px_0_#0D1B12]">
              Download SHA-256
            </Link>
            <Link href="/privacy-safety-trust" className="inline-flex border-3 border-black bg-white px-6 py-4 font-display font-semibold text-green-950 transition hover:-translate-x-1 hover:-translate-y-1 hover:shadow-[5px_5px_0_#0D1B12]">
              Review safety notes
            </Link>
          </div>
        </section>

        <section className="border-y-3 border-black bg-[#50C9F0] py-12 md:py-16" aria-labelledby="release-details">
          <div className="mx-auto max-w-[1200px] px-4 sm:px-6 lg:px-0">
            <p className="text-sm font-semibold uppercase tracking-normal">Current testing artifact</p>
            <h2 id="release-details" className="mt-3 font-display text-[clamp(2.25rem,5vw,4rem)] font-semibold leading-[0.9] tracking-normal">
              Verify the exact build before installing.
            </h2>
            <dl className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ['Release', ANDROID_RELEASE.releaseName],
                ['App version', `${ANDROID_RELEASE.appVersion} (code ${ANDROID_RELEASE.versionCode})`],
                ['APK size', formatBytes(ANDROID_RELEASE.artifact.sizeBytes)],
                ['Architecture', ANDROID_RELEASE.abis.join(', ')],
              ].map(([label, value]) => (
                <div key={label} className="border-3 border-black bg-white p-5 shadow-[5px_5px_0_#0D1B12]">
                  <dt className="text-xs font-semibold uppercase tracking-normal text-green-800">{label}</dt>
                  <dd className="mt-2 text-lg font-semibold leading-6">{value}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-6 border-3 border-black bg-white p-6">
              <p className="text-xs font-semibold uppercase tracking-normal text-green-800">APK SHA-256</p>
              <code className="mt-3 block break-all text-sm leading-6 sm:text-base">{ANDROID_RELEASE.artifact.sha256}</code>
              <p className="mt-4 text-sm leading-6 text-green-950/75">
                Source commit <code>{ANDROID_RELEASE.artifact.sourceCommit.slice(0, 12)}</code>; package <code>{ANDROID_RELEASE.packageId}</code>; {ANDROID_RELEASE.artifact.signatureScheme} verified.
              </p>
              <Link href="/releases/saferide-v0.5.8-android.json" target="_blank" className="mt-4 inline-flex font-semibold underline underline-offset-4">
                View canonical release metadata
              </Link>
            </div>
          </div>
        </section>

        <section className="border-b-3 border-black bg-[#F88539] py-12 md:py-16">
          <div className="mx-auto grid max-w-[1200px] gap-6 px-4 sm:px-6 md:grid-cols-2 lg:px-0">
            <div className="border-3 border-black bg-white p-6 shadow-[6px_6px_0_#0D1B12]">
              <h2 className="font-display text-4xl font-semibold leading-none tracking-normal">Install checklist</h2>
              <ol className="mt-6 grid gap-4">
                {installSteps.map((step, index) => (
                  <li key={step} className="flex gap-4 text-lg leading-7">
                    <span className="grid h-9 w-9 shrink-0 place-items-center border-3 border-black bg-[#F7EC36] font-display font-semibold">{index + 1}</span>
                    <span>{step}</span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="border-3 border-black bg-white p-6 shadow-[6px_6px_0_#0D1B12]">
              <h2 className="font-display text-4xl font-semibold leading-none tracking-normal">Pilot caveats</h2>
              <ul className="mt-6 grid gap-4">
                {pilotNotes.map((note) => (
                  <li key={note} className="border-l-4 border-green-900 pl-4 text-lg leading-7">{note}</li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-[1200px] px-4 py-16 sm:px-6 lg:px-0" aria-labelledby="download-trust">
          <div className="grid gap-6 md:grid-cols-[0.42fr_0.58fr]">
            <div>
              <p className="text-sm font-semibold uppercase tracking-normal text-green-700">APK trust</p>
              <h2 id="download-trust" className="mt-3 font-display text-[clamp(2.25rem,5vw,4rem)] font-semibold leading-[0.9] tracking-normal">
                Verify before field use.
              </h2>
              <p className="mt-5 text-lg leading-8 text-green-950/75">
                Treat every APK as sensitive software. This page publishes the exact version, byte size, source commit, and SHA-256 needed to detect a stale or modified download.
              </p>
            </div>
            <div className="grid gap-4">
              {downloadFaqs.map((item) => (
                <article key={item.question} className="border-3 border-black p-6">
                  <h3 className="font-display text-2xl font-semibold leading-none tracking-normal">{item.question}</h3>
                  <p className="mt-4 text-lg leading-7 text-green-950/75">{item.answer}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
