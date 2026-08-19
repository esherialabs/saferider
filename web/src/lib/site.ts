import { GUIDES } from '@/content/guides';
import { ANDROID_RELEASE } from '@/lib/android-release';

export const PRODUCTION_ORIGIN = 'https://saferide.esheria.org';

// SafeRide is an Esheria For Good initiative. It is intentionally separate
// from the commercial esheria.ai product site.
export const PARENT_ORG = {
  name: 'Esheria For Good',
  legalName: 'Esheria Ventures Limited',
  schemaId: 'https://esheria.org/#organization',
  url: 'https://esheria.org/',
} as const;

export const BRAND_NAME = 'SafeRide by Esheria For Good';

const configuredSiteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? PRODUCTION_ORIGIN).replace(/\/+$/, '');

export const SITE = {
  name: 'SafeRide',
  operatorLegalName: 'Esheria Ventures Limited',
  tagline: 'Safer journeys for every woman.',
  description:
    'An Android-first, offline-capable safety companion helping women document harassment, understand Kenyan support pathways, and choose exactly what leaves their device.',
  url: configuredSiteUrl,
  github: process.env.NEXT_PUBLIC_GITHUB_URL ?? 'https://github.com/esherialabs/saferide',
  huggingface:
    process.env.NEXT_PUBLIC_HUGGINGFACE_URL ??
    ANDROID_RELEASE.model.huggingFaceUrl,
  apkUrl:
    process.env.NEXT_PUBLIC_APK_URL ??
    ANDROID_RELEASE.artifact.downloadUrl,
  contactEmail: 'saferide@esheria.org',
  cta: {
    primary: { label: 'Download APK', href: '/download' },
    secondary: { label: 'Get Involved', href: '/contact' },
    nav: { label: 'Download App', href: '/download' },
    donate: { label: 'Fund the Pilot', href: '/contact' },
  },
  nav: {
    primaryCta: { label: 'Download', href: '/download' },
    links: [
      {
        label: 'What We Do',
        href: '/what-we-do',
        children: [
          { label: 'How It Works', href: '/how-it-works' },
          { label: 'For Survivors', href: '/for-survivors' },
          { label: 'Privacy & Trust', href: '/privacy-safety-trust' },
          { label: 'Route Safety Index', href: '/route-safety-index' },
          { label: 'Impact', href: '/impact' },
        ],
      },
      { label: 'Source & Models', href: '/open-source' },
      { label: 'Our Story', href: '/story' },
      { label: 'Partners', href: '/partners' },
      { label: 'Blog', href: '/blog' },
    ],
  },
  kinetic: ['drafts local', 'consent explicit', 'routes accountable'],
  heroAccordion: [
    {
      eyebrow: 'For survivors',
      label: 'Report safely',
      headline: 'Start a private report before the signal returns.',
      body:
        'The mobile app creates a private draft first, then helps a rider review evidence, location, support, and consent choices without forcing an upload.',
      cta: { label: 'How it works', href: '/how-it-works' },
      tone: 'bg-[#F06C13]',
      imageTone: 'from-[#ffd166] via-[#ff9e5f] to-[#f06c13]',
      motif: 'audio waveform',
      image: '/images/matatu-interior.webp',
      imageSrcSet: '/images/matatu-interior-640.webp 640w, /images/matatu-interior-768.webp 768w, /images/matatu-interior-960.webp 960w, /images/matatu-interior.webp 1248w',
      imageWidth: 1248,
      imageHeight: 848,
      imageAlt: 'Women students riding inside a Nairobi matatu with faces anonymized',
    },
    {
      eyebrow: 'For communities',
      label: 'Map risk',
      headline: 'Four pathways: keep private, map anonymously, seek referral, or escalate.',
      body:
        'SafeRide separates personal evidence from anonymous route signals so a rider can help reveal safety patterns without exposing names, audio, or exact journeys.',
      cta: { label: 'See the index', href: '/route-safety-index' },
      tone: 'bg-[#EE9D00]',
      imageTone: 'from-[#53e17c] via-[#50c9f0] to-[#118ab2]',
      motif: 'route map',
      image: '/images/route-safety-bus.webp',
      imageSrcSet: '/images/route-safety-bus-640.webp 640w, /images/route-safety-bus-768.webp 768w, /images/route-safety-bus-960.webp 960w, /images/route-safety-bus.webp 998w',
      imageWidth: 998,
      imageHeight: 848,
      imageAlt: 'SafeRide-branded matatu at a Nairobi stage during a route safety pilot',
    },
    {
      eyebrow: 'Source transparency',
      label: 'Review the stack',
      headline: 'Safety technology reviewers can inspect.',
      body:
        'The Apache-2.0 public repository includes the current Android app, website, owned API, privacy controls, on-device AI integration, tests, and reproducible release evidence.',
      cta: { label: 'View the stack', href: '/open-source' },
      tone: 'bg-[#EED800]',
      imageTone: 'from-[#f7ec36] via-[#06d6a0] to-[#1b4332]',
      motif: 'open code',
      image: '/images/app-and-brand.webp',
      imageSrcSet: '/images/app-and-brand-640.webp 640w, /images/app-and-brand-768.webp 768w, /images/app-and-brand-960.webp 960w, /images/app-and-brand.webp 1024w',
      imageWidth: 1024,
      imageHeight: 768,
      imageAlt: 'SafeRide Android home, report, and support screens from the current app',
    },
  ],
  pillars: [
    {
      title: 'Capture evidence without signal, pressure, or shame',
      action: 'For survivors',
      href: '/for-survivors',
      tone: 'bg-[#50C9F0]',
      radius: 'rounded-t-[2rem]',
    },
    {
      title: 'Offline tips, legal tags, and referral choices',
      action: 'How it works',
      href: '/how-it-works',
      tone: 'bg-[#53E17C]',
      radius: 'rounded-bl-[2rem]',
    },
    {
      title: 'Route signals with survivor identity removed',
      action: 'Route Safety Index',
      href: '/route-safety-index',
      tone: 'bg-[#F7EC36]',
      radius: 'rounded-tr-[2rem]',
    },
  ],
  impact: [
    { value: 0, suffix: '', label: 'forced uploads before a rider chooses a pathway' },
    { value: 4, suffix: '', label: 'survivor-controlled pathways: private, map, referral, escalation' },
    { value: 3, suffix: '', label: 'redaction modes before an escalation packet is shared' },
  ],
  editorialCards: [
    {
      tag: 'PILOT READINESS',
      title: 'The pilot flow covers the journey from a private draft to a consent decision',
      body: 'Riders can move through evidence, incident details, support choices, consent review, and case tracking without treating every draft as a formal report.',
      link: 'Partner with us',
      href: '/partners',
      tone: 'bg-[#F88539]',
      side: 'left',
      rounded: '',
      image: '/images/operator-pilot.webp',
      imageAlt: 'SafeRide route safety team inspecting a matatu before a pilot',
    },
    {
      tag: 'PRIVACY-FIRST AI',
      title: 'The Android testing preview runs the tuned assistant locally on the phone',
      body: 'The v0.5.8 preview downloads and verifies the LiteRT-LM model for local text guidance. It remains a controlled testing build, with transcription, tagging, production use, and lower-memory device support still gated.',
      link: 'Read the model plan',
      href: '/open-source',
      tone: 'bg-[#53E17C]',
      side: 'right',
      rounded: 'rounded-tr-[5rem]',
      image: '/images/app-dashboard.webp',
      imageAlt: 'SafeRide Android home dashboard with emergency, report, case tracker, support, and learning actions',
    },
    {
      tag: 'ACCOUNTABILITY DATA',
      title: 'Kenyan support information is available before a rider chooses a service',
      body: 'The app includes practical information about medical care, P3 forms, the 1195 helpline, GBV centres, legal aid, and evidence safety, with review still required before a live pilot.',
      link: 'Explore the index',
      href: '/route-safety-index',
      tone: 'bg-[#50C9F0]',
      side: 'left',
      rounded: '',
      image: '/images/legal-aid-guidance.webp',
      imageAlt: 'SafeRide practical guidance and legal aid illustration',
    },
  ],
  community: [
    {
      name: 'Mobile App',
      role: 'Private reporting flow',
      quote:
        'SafeRide creates a draft first, tracks completed reporting steps, and only moves to sharing after a pathway and consent review.',
      tone: 'from-[#f88539] to-[#ffd166]',
      image: '/images/how-it-works-consent-flow.webp',
      imageAlt: 'SafeRide Android incident draft, report steps, and case tracker screens',
    },
    {
      name: 'Legal Content Pack',
      role: 'Rights and support guidance',
      quote:
        'The local tips explain PEP and emergency contraception windows, the 1195 helpline, P3 forms, evidence handling, and referral boundaries.',
      tone: 'from-[#53e17c] to-[#50c9f0]',
      image: '/images/legal-support-options.webp',
      imageAlt: 'SafeRide Android support chat with 1195, provider search, and saved guidance options',
    },
    {
      name: 'Trusted Infrastructure',
      role: 'Safer production path',
      quote:
        'The production plan keeps sensitive records under Esheria-controlled infrastructure, with authentication, encryption, retention, deletion, and access rules reviewed as safeguarding decisions.',
      tone: 'from-[#f7ec36] to-[#06d6a0]',
      image: '/images/community-route-review.webp',
      imageAlt: 'SafeRide team reviewing anonymized route signals on a Nairobi route map',
    },
    {
      name: 'UNICEF Venture Fund Meet',
      role: 'Founder presentation',
      quote:
        'SafeRide was presented to UNICEF Venture Fund reviewers as a privacy-first transport safety workflow, with survivor choice and route accountability kept separate.',
      tone: 'from-[#50c9f0] to-[#f7ec36]',
      image: '/images/pictures/UNI988186_presenter.webp',
      imageAlt: 'SafeRide CEO presenting SafeRide at a UNICEF Venture Fund meet',
    },
  ],
  updates: GUIDES,
} as const;

export type SitePath = '/' | `/${string}`;

/**
 * Single URL policy for every absolute URL the site emits (canonical, sitemap,
 * Open Graph, JSON-LD): SITE.url origin + path with a trailing slash, matching
 * the static export's `trailingSlash: true` serving form.
 */
export function canonicalUrl(path: SitePath = '/'): string {
  const normalized = path.endsWith('/') ? path : `${path}/`;
  return `${SITE.url}${normalized}`;
}
