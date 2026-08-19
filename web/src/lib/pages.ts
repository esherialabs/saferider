import { PRESS_COVERAGE } from './press';
import { PARENT_ORG } from './site';

export const INTERIOR_PAGES = {
  'what-we-do': {
    updatedAt: '2026-07-28',
    ogImage: '/og/what-we-do.jpg',
    evidenceTitle: 'What the app already does.',
    variant: 'manifesto',
    eyebrow: 'What we do',
    title: 'Private harassment reporting and safer matatu routes.',
    intro:
      'SafeRide supports a complete survivor-controlled journey: discreet entry, private drafts, evidence capture, incident details, support choices, consent review, and case tracking.',
    heroTitle: 'An Android-first safety companion, not a hotline replacement.',
    heroBody:
      'SafeRide helps a rider document what happened, understand Kenyan support options, and decide whether to keep the record private, contribute an anonymous route signal, seek referral support, or prepare an escalation packet.',
    wideHeroTitle: true,
    tone: 'bg-[#50C9F0]',
    accent: 'bg-[#F7EC36]',
    image: '/images/app-dashboard.webp',
    imageAlt: 'SafeRide Android home dashboard with emergency, report, case tracker, support, and learning actions',
    evidence: [
      {
        label: 'Mobile flow',
        title: 'Eight reporting screens are already mapped.',
        body: 'The app includes guided screens for a draft overview, evidence, what happened, where and when, support choices, consent review, and statement review.',
      },
      {
        label: 'Content pack',
        title: 'Rights and support content is local first.',
        body: 'Tips cover PEP, emergency contraception, 1195, P3 forms, evidence handling, counselling, privacy, and follow-up care before any network request is needed.',
      },
      {
        label: 'Pathways',
        title: 'The product separates private evidence from route accountability.',
        body: 'Anonymous map updates, referrals, and escalation packets are different choices, not one forced report path.',
      },
    ],
    stats: [
      { value: '4', label: 'pathways: private, map, referral, escalation' },
      { value: '20', label: 'offline tips and rights cards' },
      { value: '15', label: 'legal tags for incident structure' },
    ],
    cards: [
      {
        title: 'Report flow',
        body: 'The app guides a rider through a draft overview, evidence, incident details, support choices, consent review, and statement review.',
      },
      {
        title: 'Support layer',
        body: 'The app includes tips on PEP, emergency contraception, 1195, P3 forms, evidence handling, psychosocial care, and survivor data control.',
      },
      {
        title: 'Accountability layer',
        body: 'Anonymous map updates and escalation forms are designed to separate survivor-controlled evidence from route-level prevention signals.',
      },
    ],
    stepsTitle: 'The product model',
    steps: [
      'Start with a local draft that can be saved, resumed, edited, or deleted.',
      'Collect optional media, notes, route context, timing, impact, witnesses, and legal tags.',
      'Choose one of four pathways before any support or accountability data is shared.',
      'Review exactly what leaves the device inside the consent gate before continuing.',
    ],
    ctaTitle: 'See how privacy and choice shape the reporting flow.',
    cta: { label: 'See how it works', href: '/how-it-works' },
  },
  'how-it-works': {
    updatedAt: '2026-07-28',
    ogImage: '/og/how-it-works.jpg',
    evidenceTitle: 'How the reporting flow protects riders.',
    variant: 'playbook',
    eyebrow: 'How it works',
    title: 'How to document and report harassment on a matatu — privately.',
    intro:
      'SafeRide assumes a rider may have low signal, low time, and high risk. The workflow therefore starts privately, records only what the user chooses, and delays sharing until the pathway is clear.',
    heroTitle: 'A structured path from incident to next step.',
    heroBody:
      'The reporting flow covers what happened, where and when, evidence, legal framing, pathway choice, consent review, referral selection, escalation details, and case status.',
    tone: 'bg-[#53E17C]',
    accent: 'bg-[#50C9F0]',
    image: '/images/how-it-works-consent-flow.webp',
    imageAlt: 'SafeRide Android incident draft, report steps, and case tracker screens',
    evidence: [
      {
        label: 'Draft state',
        title: 'Progress is saved as the rider moves.',
        body: 'Draft utilities persist incident details, evidence metadata, location context, legal tags, pathway choice, and completion state.',
      },
      {
        label: 'Offline queue',
        title: 'Network-dependent work waits until it can sync.',
        body: 'The mobile app keeps local draft work available and queues share or case actions rather than blocking the rider at the first weak signal.',
      },
      {
        label: 'Consent review',
        title: 'Sharing is a deliberate screen, not a hidden side effect.',
        body: 'Before referral or escalation, the user reviews what will be sent, where it goes, and what redaction level is applied.',
      },
    ],
    stats: [
      { value: '0', label: 'network required to begin a draft' },
      { value: '90', label: 'day default retention note in consent flow' },
      { value: '3', label: 'redaction levels for escalation packets' },
    ],
    cards: [
      {
        title: 'Capture and clarify',
        body: 'The draft can hold patterns, narrative, impact, witness details, route context, timing accuracy, media files, annotations, transcripts, and legal tags.',
      },
      {
        title: 'Pick a pathway',
        body: 'Save privately, share an anonymous map update, get help through a hotline or provider, or escalate for operator/regulator action.',
      },
      {
        title: 'Confirm consent',
        body: 'The consent screen summarizes when, where, what happened, attachments, tags, identity, provider, contact method, statement, and redactions.',
      },
    ],
    stepsTitle: 'The rider journey',
    steps: [
      'Open SafeRide directly or through stealth/decoy entry points when safety requires discretion.',
      'Start or resume a local incident draft and add only the details the rider feels safe recording.',
      'Use legal framing and rights content to understand possible categories without treating the app as legal advice.',
      'Select a pathway and review the consent checklist before a referral, anonymous map update, or escalation is prepared.',
    ],
    ctaTitle: 'Review the pilot before using it in the field.',
    cta: { label: 'Download the pilot', href: '/download' },
  },
  'for-survivors': {
    updatedAt: '2026-07-28',
    ogImage: '/og/for-survivors.jpg',
    evidenceTitle: 'Safety features built for survivors.',
    variant: 'playbook',
    eyebrow: 'For survivors',
    title: 'Support after harassment: your options in Kenya, at your pace.',
    intro:
      'SafeRide is not an emergency service, police service, lawyer, clinic, or counselling provider. It is a private tool for organizing information and deciding what support path feels safe.',
    heroTitle: 'No forced report. No hidden upload. No one-size-fits-all path.',
    heroBody:
      'The app lets a rider keep everything on the phone, share only redacted route information, prepare a limited support brief, or prepare a structured escalation packet.',
    tone: 'bg-[#F88539]',
    accent: 'bg-[#53E17C]',
    image: '/images/survivor-private-draft.webp',
    imageAlt: 'SafeRide Android incident draft and report step checklist screens',
    evidence: [
      {
        label: 'Stealth controls',
        title: 'Safety settings are part of the product surface.',
        body: 'The app includes decoy PIN setup, quick-exit behaviour, app masking concepts, and reminders about visible Android recording indicators.',
      },
      {
        label: 'Data controls',
        title: 'Retention is a choice with risk language.',
        body: 'Privacy screens cover 30-day, 90-day, and keep-until-delete options, plus export, restore, backup, and two-step delete flows.',
      },
      {
        label: 'Support boundaries',
        title: 'The app informs without pretending to be emergency care.',
        body: 'Survivor-facing copy keeps medical, legal, police, counselling, and emergency-service boundaries explicit.',
      },
    ],
    stats: [
      { value: 'Local', label: 'draft-first data handling' },
      { value: '30/90', label: 'day retention options plus keep-until-delete' },
      { value: 'Decoy', label: 'calculator mode and quick-exit support' },
    ],
    cards: [
      {
        title: 'Safety controls',
        body: 'The app includes stealth trigger setup, calculator decoy PIN, quick-exit gesture, app masking, and reminders that Android may show a mic indicator while recording.',
      },
      {
        title: 'Evidence controls',
        body: 'Draft media can track photo, audio, video, or document files with descriptions, annotations, transcripts, metadata, checksums, and privacy settings.',
      },
      {
        title: 'Data controls',
        body: 'Privacy screens cover retention, local encrypted backup, export, restore, and a deliberate two-step delete flow with confirmation language.',
      },
    ],
    stepsTitle: 'What SafeRide will never claim',
    steps: [
      'It will not say a survivor must report to be believed or supported.',
      'It will not claim to replace emergency care, police response, lawyers, clinics, or counsellors.',
      'It will not publish survivor stories, exact journeys, evidence, or identity without explicit safeguarding review.',
      'It will not make route-safety claims before field pilots produce measured evidence.',
    ],
    ctaTitle: 'Understand the privacy controls before sharing anything.',
    cta: { label: 'Review privacy and trust', href: '/privacy-safety-trust' },
  },
  'route-safety-index': {
    updatedAt: '2026-07-28',
    ogImage: '/og/route-safety-index.jpg',
    evidenceTitle: 'How route signals stay anonymous.',
    variant: 'index',
    eyebrow: 'Route Safety Index',
    title: 'Which Nairobi routes are safer? Anonymous data, real accountability.',
    intro:
      "SafeRide's route-safety concept is grounded in the app pathway called Anonymous map update: share redacted where/when and incident type, with no names and no audio.",
    heroTitle: 'Private evidence. Public safety signals.',
    heroBody:
      'The Route Safety Index should only use data that is minimized, aggregated, privacy-reviewed, and useful to operators, civic partners, regulators, and support organizations.',
    tone: 'bg-[#F7EC36]',
    accent: 'bg-[#F88539]',
    image: '/images/route-safety-index-dashboard.webp',
    imageAlt: 'Anonymized route safety dashboard and Nairobi route map reviewed by transport stakeholders',
    evidence: [
      {
        label: 'Anonymous map update',
        title: 'Only redacted route facts belong in public signals.',
        body: 'The pathway is written around where/when and incident type, while excluding names, raw audio, and survivor-identifying details.',
      },
      {
        label: 'Aggregation',
        title: 'Small samples should not become public scores.',
        body: 'Route scoring needs thresholds, time windows, bias notes, and methodology limits before it can responsibly inform operators or regulators.',
      },
      {
        label: 'Action loop',
        title: 'A route index is only useful if partners respond.',
        body: 'The pilot should test whether transport partners can convert aggregate signals into lighting, staffing, reporting, and follow-up changes.',
      },
    ],
    stats: [
      { value: 'No', label: 'names or raw audio in anonymous map updates' },
      { value: 'Coarse', label: 'location and timing before aggregation' },
      { value: 'Pilot', label: 'evidence needed before public scoring' },
    ],
    cards: [
      {
        title: 'Anonymous map update',
        body: 'The pathway copy explicitly limits map contribution to redacted where/when and type, with no names or audio.',
      },
      {
        title: 'Escalation packet',
        body: 'When a rider chooses action, the escalation form supports redaction levels, vehicle plate, SACCO/operator, alias contact, and packet preview.',
      },
      {
        title: 'Case follow-up',
        body: 'Submitted cases can move through status, timeline events, attachment previews, deletion requests, and offline retry states.',
      },
    ],
    stepsTitle: 'Index guardrails before launch',
    steps: [
      'Define minimum sample thresholds so small groups or exact journeys are not exposed.',
      'Separate anonymous route signals from private drafts, evidence files, and referral briefs.',
      'Publish methodology, limitations, and known bias before displaying public scores.',
      'Give operators and civic partners action loops without giving them survivor-identifying data.',
    ],
    ctaTitle: 'Help test route signals without exposing riders.',
    cta: { label: 'Join as a pilot partner', href: '/partners' },
  },
  'open-source': {
    updatedAt: '2026-08-18',
    ogImage: '/og/open-source.jpg',
    evidenceTitle: 'What reviewers can inspect publicly.',
    variant: 'editorial',
    eyebrow: 'Source and model transparency',
    title: 'A production-grade open-source repository with explicit boundaries.',
    intro:
      'SafeRide publishes its reviewed mobile app, website, owned API, local infrastructure, public-safe AI tooling, tests, and release evidence under approved open licenses without exposing restricted people or operational records.',
    heroTitle: 'Public-interest technology needs public accountability.',
    heroBody:
      'The public surface includes the Android client, owned API, local infrastructure, website, on-device assistant configuration, release checksums, model cards, and clear statements about what is tested, restricted, or still pending.',
    tone: 'bg-[#F88539]',
    accent: 'bg-[#50C9F0]',
    image: '/images/open-source-review-desk.webp',
    imageAlt: 'SafeRide source-review desk with repository, Android device, and architecture notes',
    evidence: [
      {
        label: 'Client',
        title: 'The Android client shows the product contract.',
        body: 'Screens, navigation, draft persistence, case tracking, privacy controls, and content packs can be reviewed directly in the repository.',
      },
      {
        label: 'Backend',
        title: 'The owned API and local infrastructure are reviewable.',
        body: 'The mirror includes the current first-party API, Postgres migrations, local services, storage contracts, and privacy controls used by the migration branch.',
      },
      {
        label: 'Assistant',
        title: 'The tested local model path is hash-bound.',
        body: 'The v0.5.8 LiteRT-LM model, immutable revision, byte size, checksum, runtime, and Android testing limits are published without claiming production or survivor-facing approval.',
      },
      {
        label: 'Launch site',
        title: 'The website is part of the audit surface.',
        body: 'Routes, metadata, sitemap, robots policy, contact inbox, and public copy are treated as launch artifacts that reviewers can test, not marketing afterthoughts.',
      },
    ],
    resources: [
      {
        label: 'Source',
        title: 'Canonical GitHub repository',
        body: 'Review, build, test, discuss, and contribute to the Apache-2.0 mobile app, website, owned API, local infrastructure, public AI tooling, and release evidence.',
        href: 'https://github.com/esherialabs/saferide',
      },
      {
        label: 'Model',
        title: 'Gemma 4 mobile model card',
        body: 'Inspect the exact v0.5.8 LiteRT-LM artifact, checksum, Android observation, evaluation boundaries, and required device-matrix caveats.',
        href: 'https://huggingface.co/esherialabs/saferide-gemma-4-e2b-v058-original-419806-litertlm',
      },
      {
        label: 'Install',
        title: 'Android pilot download',
        body: 'Use the pilot carefully, with the safety boundaries and APK handling notes made explicit.',
        href: '/download',
      },
      {
        label: 'Safety',
        title: 'Privacy and trust model',
        body: 'Read the local-first, consent-gate, redaction, retention, deletion, and backend ownership commitments.',
        href: '/privacy-safety-trust',
      },
      {
        label: 'Public guides',
        title: 'Safety and legal notes',
        body: 'Share public-facing explanations of privacy, referral boundaries, and route-safety data with reviewers.',
        href: '/blog',
      },
      {
        label: 'Contact',
        title: 'Review inbox',
        body: 'Send security, safeguarding, legal-content, API, or pilot-review questions to the SafeRide team.',
        href: '/contact',
      },
    ],
    stats: [
      { value: 'Visible', label: 'clean source snapshot for public review' },
      { value: 'Separate', label: 'code, content, model, and dataset terms' },
      { value: 'v0.5.8', label: 'hash-bound LiteRT-LM testing artifact' },
    ],
    cards: [
      {
        title: 'Android client',
        body: 'Expo and React Native power the app screens, navigation, offline draft storage, privacy controls, decoy mode, quick exit, and case workflows.',
      },
      {
        title: 'Local assistant',
        body: 'The Gemma 4 E2B registry binds the exact v0.5.8 LiteRT-LM file, immutable URL, checksum, storage lifecycle, survivor-centred prompt, and fail-closed capability controls.',
      },
      {
        title: 'Backend transition',
        body: 'The current branch includes the first-party SafeRide API and local Postgres/object-storage stack. Older Supabase material is historical and excluded from the public mirror.',
      },
      {
        title: 'Launch transparency',
        body: 'The website publishes canonical release metadata, APK checksum, model links, source-mirror provenance, safety boundaries, sitemap coverage, and contact paths.',
      },
    ],
    stepsTitle: 'What contributors can audit now',
    steps: [
      'Review privacy claims against draft storage, consent screens, data export, decoy PIN, and quick-exit utilities.',
      'Review the first-party API and local-infrastructure migration while preserving local-first behaviour.',
      'Verify the Android preview and on-device model against the published hashes and stated device limits.',
      'Validate legal and support content with Kenyan GBV, medical, legal, and safeguarding experts.',
    ],
    ctaTitle: 'Review the public source, model, and release evidence.',
    cta: { label: 'Read pilot updates', href: '/blog' },
  },
  partners: {
    updatedAt: '2026-07-28',
    ogImage: '/og/partners.jpg',
    evidenceTitle: 'Where partners make the difference.',
    variant: 'editorial',
    eyebrow: 'Partners',
    title: 'Partner with us: GBV organizations, matatu operators, funders.',
    intro:
      'SafeRide is ready for serious review. The next step is safeguarding, privacy, legal, transport, infrastructure, and evaluation work with organizations that understand Kenya.',
    heroTitle: 'Operational partnerships, not extractive pilots.',
    heroBody:
      'We need partners who can test language, referral boundaries, route data methods, escalation workflows, and first-party API design without asking survivors to carry platform risk.',
    tone: 'bg-[#53E17C]',
    accent: 'bg-[#F88539]',
    image: '/images/partners-workshop-table.webp',
    imageAlt: 'SafeRide partner workshop table with anonymized route safety and referral workflow materials',
    evidence: [
      {
        label: 'Support orgs',
        title: 'Referral language needs expert review.',
        body: 'Crisis copy, 1195 guidance, PEP/EC content, P3 explanations, and referral briefs should be reviewed by qualified Kenyan support and legal-aid partners.',
      },
      {
        label: 'Transport',
        title: 'Operators need action routines, not dashboards alone.',
        body: 'Redacted route signals should connect to route changes, training, escalation handling, and follow-up accountability.',
      },
      {
        label: 'Engineering',
        title: 'Backend hardening is safeguarding work.',
        body: 'Authentication, retention, encrypted evidence handling, access controls, moderation, and observability need partner-level scrutiny before scale.',
      },
    ],
    partners: [
      {
        name: 'UNICEF Venture Fund',
        role: 'FemTech and source-transparency support',
        initials: 'UN',
        href: 'https://www.unicefventurefund.org/company/esheria-ventures',
      },
      {
        name: 'Usikimye',
        role: 'Kenya GBV survivor support',
        initials: 'US',
        logo: '/images/partners/usikimye.png',
        href: 'https://www.usikimye.org/',
      },
      {
        name: 'FIDA Kenya',
        role: 'Women lawyers and legal aid',
        initials: 'FK',
        logo: '/images/partners/fida-kenya.png',
        href: 'https://fidakenya.org/',
      },
      {
        name: 'Human Rights Agenda',
        role: 'Coast-based rights organization',
        initials: 'HA',
        logo: '/images/partners/human-rights-agenda.png',
        href: 'https://huria.ngo/',
      },
      {
        name: 'Nairobi West Prison',
        role: 'Kenya justice access deployment site',
        initials: 'NW',
        logo: '/images/partners/nairobi-west-prison.webp',
        href: 'https://esheria.org/stories/when-information-is-freedom-rethinking-justice-from-inside-kenya-s-prisons',
      },
    ],
    press: PRESS_COVERAGE,
    stats: [
      { value: 'GBV', label: 'safeguarding and referral review' },
      { value: 'SACCO', label: 'route and operator workflow validation' },
      { value: 'API', label: 'backend migration and security review' },
    ],
    cards: [
      {
        title: 'Support organizations',
        body: 'Review crisis language, 1195 guidance, PEP/EC content, P3 explanations, referral briefs, and boundaries around legal and psychosocial support.',
      },
      {
        title: 'Transport operators',
        body: 'Validate whether redacted route signals, escalation packets, and follow-up timelines can create safer operational routines.',
      },
      {
        title: 'Engineering partners',
        body: 'Help move from the Supabase prototype to an owned API with authentication, moderation, retention, encrypted evidence, observability, and RLS-equivalent access controls.',
      },
    ],
    stepsTitle: 'Partnership criteria',
    steps: [
      'No partner receives raw survivor evidence or exact journeys without explicit user choice and safeguarding approval.',
      'Every pilot must define referral escalation boundaries, data retention, deletion, and incident response before launch.',
      'Transport partners must commit to action loops, not just dashboards.',
      'Technical partners must preserve offline-first behaviour while reducing backend and secret-management risk.',
    ],
    ctaTitle: 'Build a responsible Kenya pilot with us.',
    cta: { label: 'Start a partner inquiry', href: '/contact' },
  },
  story: {
    updatedAt: '2026-07-28',
    ogImage: '/og/story.jpg',
    evidenceTitle: 'The evidence behind the story.',
    variant: 'manifesto',
    eyebrow: 'Our story',
    title: 'Built in Nairobi, for the rides women take every day.',
    intro:
      'Esheria built SafeRide for public transport harassment, private evidence handling, Kenyan legal and support guidance, and route-level accountability that still needs careful field validation.',
    heroTitle: 'Nairobi-first, survivor-controlled, open for review.',
    heroBody:
      'The work is practical: make it easier to record facts, understand rights, find support, preserve agency, and create prevention signals without turning survivor experiences into marketing material.',
    tone: 'bg-[#F88539]',
    accent: 'bg-[#F7EC36]',
    image: '/images/story-origin-nairobi.webp',
    imageAlt: 'Nairobi public transport scene introducing the SafeRide origin story',
    evidence: [
      {
        label: 'Origin',
        title: 'The story starts with daily transit risk.',
        body: 'SafeRide focuses on public transport harassment, evidence control, and practical support pathways for Nairobi riders.',
      },
      {
        label: 'Principle',
        title: 'The product should never mine trauma for growth.',
        body: 'Public claims, visuals, and metrics need to stay traceable to product behaviour or pilot evidence, not dramatic survivor storytelling.',
      },
      {
        label: 'Review',
        title: 'Open work invites challenge before scale.',
        body: 'The website, roadmap, content packs, mobile flows, and UNICEF Venture Fund presentation are presented as reviewable artifacts rather than a finished institutional promise.',
      },
    ],
    presentationImages: [
      {
        src: '/images/pictures/UNI986641.webp',
        alt: 'SafeRide CEO speaking with attendees during a UNICEF Venture Fund presentation',
        caption: 'Founder presentation and reviewer discussion during the UNICEF Venture Fund meet.',
      },
    ],
    stats: [
      { value: 'Android', label: 'first implementation target' },
      { value: 'Offline', label: 'design assumption for stressful commutes' },
      { value: 'Open', label: 'public accountability posture' },
    ],
    cards: [
      {
        title: 'Built for the first minutes',
        body: 'The app creates a draft and gives structured prompts before a user has to decide whether to report, refer, map, or escalate.',
      },
      {
        title: 'Built for discretion',
        body: 'Stealth trigger setup, calculator decoy mode, quick exit, app masking, and local retention choices reflect real-world safety constraints.',
      },
      {
        title: 'Built for accountability',
        body: 'Route-level insights, case tracking, public source documentation, and a first-party API keep the product focused on measurable safety improvements.',
      },
    ],
    stepsTitle: 'What guides the work',
    steps: [
      'Do not sensationalize survivor experience for visual design, metrics, or fundraising.',
      'Make safety, privacy, and route-accountability claims traceable to product behaviour or pilot evidence.',
      'Treat backend ownership, retention, encryption, and observability as safeguarding work.',
      'Keep the public work reviewable so partners can challenge and improve it.',
    ],
    ctaTitle: 'See how Esheria is building SafeRide in the open.',
    cta: { label: 'See the public-good stack', href: '/open-source' },
    contextLink: { label: 'Visit Esheria, the organization behind SafeRide', href: PARENT_ORG.url },
  },
  impact: {
    updatedAt: '2026-07-28',
    ogImage: '/og/impact.jpg',
    evidenceTitle: 'What a responsible pilot measures.',
    variant: 'index',
    eyebrow: 'Impact and transparency',
    title: 'Measuring real safety, not hype.',
    intro:
      'The product is ready for structured review, but impact still depends on field evidence: completion, comprehension, privacy confidence, referral usefulness, route action, and infrastructure safety.',
    heroTitle: 'Measure behaviour, not hype.',
    heroBody:
      'A responsible pilot should track whether women can safely start reports, understand consent, use legal/support content, preserve evidence, and whether partners act on aggregate route signals.',
    tone: 'bg-[#F7EC36]',
    accent: 'bg-[#53E17C]',
    image: '/images/impact-route-action.webp',
    imageAlt: 'Transport safety review session focused on route action and accountability',
    evidence: [
      {
        label: 'Usability',
        title: 'Measure whether the flow works under stress.',
        body: 'Completion, abandonment, comprehension, and recovery from offline states matter more than broad claims about safety outcomes.',
      },
      {
        label: 'Safeguarding',
        title: 'Measure whether guidance stays within boundaries.',
        body: 'Tips, referrals, and assistant responses should be reviewed for overpromising, unsafe escalation, and unclear data-sharing language.',
      },
      {
        label: 'Accountability',
        title: 'Measure whether partners actually change routes.',
        body: 'The Route Safety Index should be judged by partner response and corrective action, not only by data collection.',
      },
    ],
    stats: [
      { value: 'Completion', label: 'draft-to-pathway conversion and abandonment' },
      { value: 'Trust', label: 'user confidence in consent and data controls' },
      { value: 'Action', label: 'operator or support response to route patterns' },
    ],
    cards: [
      {
        title: 'Product evidence',
        body: 'Measure whether the draft, evidence, legal framing, pathway, consent, and case tracker screens are usable under low-signal and high-stress conditions.',
      },
      {
        title: 'Safeguarding evidence',
        body: 'Review whether tips, provider choices, referral briefs, and AI guidance avoid overpromising and point users toward qualified human support.',
      },
      {
        title: 'Infrastructure evidence',
        body: 'Publish what changed as SafeRide moves from prototype infrastructure to Esheria-controlled services with production-grade safeguards.',
      },
    ],
    stepsTitle: 'Transparency commitments',
    steps: [
      'Separate implemented features from field-validated outcomes.',
      'Report unresolved risks around evidence encryption, backend migration, CI debt, and content review.',
      'Use privacy-safe analytics only when approved and never capture incident details in analytics.',
      'Publish non-sensitive pilot learnings, methodology limits, and corrective actions.',
    ],
    ctaTitle: 'Judge SafeRide by measured safety and partner action.',
    cta: { label: 'Review the safety model', href: '/privacy-safety-trust' },
  },
  'privacy-safety-trust': {
    updatedAt: '2026-07-28',
    ogImage: '/og/privacy-safety-trust.jpg',
    evidenceTitle: 'How privacy is enforced in the product.',
    variant: 'playbook',
    eyebrow: 'Privacy, safety, and trust',
    title: 'Your report stays private until you decide otherwise.',
    intro:
      'SafeRide keeps drafts local, asks for consent before sharing, and gives riders retention, export, and delete choices.',
    heroTitle: 'Local first. Shared by choice.',
    heroBody:
      'Before referral, map update, or escalation, the app summarizes what leaves the device and what stays private.',
    tone: 'bg-[#53E17C]',
    accent: 'bg-[#50C9F0]',
    image: '/images/privacy-controls-product.webp',
    imageAlt: 'SafeRide Android permissions and privacy settings screens',
    evidence: [
      {
        label: 'Consent',
        title: 'The consent gate is the privacy contract.',
        body: 'The app is structured so referral, map update, and escalation paths require a review step before data leaves the device.',
      },
      {
        label: 'Retention',
        title: 'Longer storage is treated as higher risk.',
        body: 'Retention choices, backup, export, and deletion copy explain control without hiding the safety tradeoffs.',
      },
      {
        label: 'Infrastructure',
        title: 'Backend restraint is part of user trust.',
        body: 'The public roadmap keeps local-first behaviour while moving sensitive services under Esheria-controlled production infrastructure.',
      },
    ],
    stats: [
      { value: 'Consent', label: 'before referral, map update, or escalation' },
      { value: 'Redact', label: 'none, light, or heavy escalation options' },
      { value: 'Owned', label: 'Esheria-controlled production services' },
    ],
    cards: [
      {
        title: 'Sensitive drafts',
        body: 'Drafts can include media, transcripts, checksums, legal tags, location accuracy, and pathway choices, so the product must keep review and deletion controls prominent.',
      },
      {
        title: 'Referral boundaries',
        body: 'The app can route a sanitized brief to hotline, GBV centre, legal aid, counselling, or fallback number flows, but it must not impersonate these services.',
      },
      {
        title: 'Backend ownership',
        body: 'Prototype documentation remains useful for review, while production planning moves toward Esheria-controlled services with stronger authentication, encryption, retention, and access controls.',
      },
    ],
    stepsTitle: 'Launch safeguards',
    steps: [
      'Review all public claims for safety, privacy, medical, legal, and emergency-service overpromising.',
      'Approve retention, deletion, backup, analytics, evidence encryption, and support-provider language before public onboarding.',
      'Document the first-party API migration path before collecting sensitive production data.',
      'Never publish survivor stories, exact route details, or evidence screenshots without explicit safeguarding review.',
    ],
    ctaTitle: 'Review what stays private and what can be shared.',
    cta: { label: 'Read how it works', href: '/how-it-works' },
  },
} as const;
