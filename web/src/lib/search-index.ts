export type SearchItem = {
  title: string;
  href: string;
  excerpt: string;
  keywords: string;
  priorityTerms?: readonly string[];
};

export const SEARCH_ITEMS: readonly SearchItem[] = [
  {
    title: 'Home',
    href: '/',
    excerpt: 'SafeRide is an Android-first, offline-capable safety companion for safer journeys.',
    keywords: 'saferide safer journeys women nairobi public transport report evidence consent routes accountability android offline',
  },
  {
    title: 'What We Do',
    href: '/what-we-do',
    excerpt: 'SafeRide turns a stressful moment into a controlled reporting workflow.',
    keywords: 'what we do controlled reporting workflow survivors communities evidence route accountability legal framing pathway selection case tracking',
  },
  {
    title: 'How It Works',
    href: '/how-it-works',
    excerpt: 'Capture first, consent before sharing.',
    keywords: 'how it works capture consent sharing draft evidence legal framing pathway referral escalation redaction retention',
  },
  {
    title: 'For Survivors',
    href: '/for-survivors',
    excerpt: 'SafeRide is designed to protect choice, privacy, and pace.',
    keywords: 'survivors privacy choice pace no forced report no hidden upload support pathway local draft delete export retention',
  },
  {
    title: 'Privacy, Safety, and Trust',
    href: '/privacy-safety-trust',
    excerpt: 'Review consent, retention, redaction, deletion, backup, and backend migration claims.',
    keywords: 'privacy safety trust consent retention redaction delete deletion backup export local first backend migration first party api',
    priorityTerms: ['privacy', 'safety', 'trust', 'consent', 'retention', 'redaction', 'delete', 'deletion', 'backup', 'export'],
  },
  {
    title: 'Route Safety Index',
    href: '/route-safety-index',
    excerpt: 'Route safety should use minimized, redacted, consented signals.',
    keywords: 'route safety index anonymous map update aggregate patterns routes transport operator sacco dashboard thresholds',
  },
  {
    title: 'Source & Models',
    href: '/open-source',
    excerpt: 'The repo is the evidence reviewers can inspect.',
    keywords: 'open source github model card gemma api roadmap android supabase prototype repository audit',
  },
  {
    title: 'Partners',
    href: '/partners',
    excerpt: 'SafeRide needs reviewers and operators who can turn workflows into safe field practice.',
    keywords: 'partners pilot sacco support organizations funders regulators safeguarding legal review fida usikimye unicef',
  },
  {
    title: 'Our Story',
    href: '/story',
    excerpt: 'SafeRide grew from everyday transport risk into a local-first safety product.',
    keywords: 'story origin nairobi local first survivor controlled transport risk unicef venture fund',
  },
  {
    title: 'Impact',
    href: '/impact',
    excerpt: 'Measure whether SafeRide changes workflows without creating new risk.',
    keywords: 'impact transparency metrics pilot usability safeguarding completion trust route action field evidence',
  },
  {
    title: 'Guides',
    href: '/blog',
    excerpt: 'Public SafeRide guides on privacy, survivor choice, support pathways, and route safety.',
    keywords: 'guides blog privacy legal support route consent public press field note',
  },
  {
    title: 'How SafeRide keeps a report private until you choose a path',
    href: '/blog/private-reporting-control',
    excerpt: 'Start with a local draft, review what is recorded, and decide what leaves the phone.',
    keywords: 'private reporting control report privacy local draft consent choose path referral anonymous map escalation',
  },
  {
    title: 'Medical, legal, and support steps riders can understand before they report',
    href: '/blog/kenya-support-pathways',
    excerpt: 'Understand support choices in plain language without pressure.',
    keywords: 'kenya support pathways medical legal pep emergency contraception p3 1195 helpline gbv care',
  },
  {
    title: 'How anonymous route signals can improve transport safety without exposing survivors',
    href: '/blog/route-safety-without-exposure',
    excerpt: 'Route accountability should use minimized, aggregated, consented signals.',
    keywords: 'route safety exposure anonymous signals aggregate survivor identity private evidence exact journeys safeguards',
  },
  {
    title: 'Download App',
    href: '/download',
    excerpt: 'Install the SafeRide Android pilot carefully.',
    keywords: 'download app apk android pilot install checklist unknown apps onboarding permissions stealth quick exit checksum signature',
  },
  {
    title: 'Contact',
    href: '/contact',
    excerpt: 'Contact SafeRide about pilot partnerships, safeguarding review, and source or model review.',
    keywords: 'contact saferide pilot partnership safeguarding privacy review open source github funder support organization sacco operator regulator email',
  },
] as const;
