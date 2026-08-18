# Localization Readiness: Kiswahili And Sheng

Date: 2026-06-05

RISK_LEVEL: high

ACCESS_PROFILE: repository inspection and scoped documentation/code changes only

HUMAN_APPROVAL_REQUIRED: yes

DECISION: BLOCKED_NEEDS_EVIDENCE

## Current Release State

English is the only enabled app language in this release branch. `LanguageAccessibility` lists Kiswahili (`sw`) and Sheng (`sh`) for roadmap visibility, but both remain unavailable and cannot be selected.

No reviewed Kiswahili or Sheng string files, locale bundles, review metadata, source dates, or human-approval records were found in `src/`, `assets/`, `docs/`, or `web/`. The branch also does not contain a real i18n loader, app-wide language persistence, or downloadable language-pack source.

## Pack Model

For this release branch, Kiswahili and Sheng must be treated as unavailable. If language support is enabled later, the safest initial model is bundled reviewed packs with versioned source metadata. Truly downloadable packs should stay disabled until product and engineering define package signing or integrity checks, offline cache behavior, rollback behavior, review metadata, and privacy expectations for pack fetches.

## Required Release Surfaces

Before Kiswahili or Sheng can be enabled, reviewed strings must cover these release-facing surfaces:

- Onboarding, first-run empty state, permission gates, and account/auth screens.
- Home, navigation labels, route names, toasts, errors, empty states, and loading states.
- Report flow: incident details, location/time, evidence detail, legal framing, pathway selection, consent gate, statement review, and escalation forms.
- Safety controls: quick exit, stealth trigger setup, decoy PIN/calculator, haptics, high contrast, and accessibility previews.
- Privacy/data controls: local backup, retention, delete/reset, export, sync queue, media handling, and consent summaries.
- Support surfaces: provider directory, referral picker, tips/rights education, chat/offline fallback, local assistant unavailable states, and support-resource boundaries.
- Case surfaces: case tracker, case detail, timeline, attachment previews, follow-up answers, retry queues, and export/share flows.

## Human Review Owners

Enablement needs documented approval from:

- A Kiswahili linguist or translator with Kenyan survivor-support context.
- A Sheng reviewer familiar with Nairobi/Kenya usage and code-switching risk.
- Safeguarding/content reviewer for survivor-centered tone and harm-minimizing wording.
- Kenyan legal-aid reviewer for legal references, P3/OB language, rights education, and non-advice boundaries.
- Product owner for language-pack scope, fallback rules, and release gating.
- Engineering owner for i18n loading, persistence, pack integrity, and offline behavior.
- Accessibility/QA reviewer for large text, TalkBack, speech behavior, and layout fit.

## Enablement Blockers

- No human-reviewed Kiswahili or Sheng release-facing strings with provenance.
- No approved fallback policy for screens with partial translation coverage.
- No final PM-approved decision for future bundled vs. downloadable rollout; this pass documents bundled-only as the safest interim path and keeps downloads unavailable.
- No app-wide language preference persistence tied to real localized content.
- No complete surface inventory mapped to source string keys.
- No QA evidence for translated copy with dynamic type, TalkBack, small screens, and offline mode.
- No source metadata model for support numbers, provider names, legal references, medical time windows, review dates, and owner approvals.

## Tests Needed Before Enablement

- Unavailable languages cannot be selected.
- Only languages with reviewed resources appear as enabled.
- Selecting an enabled language changes visible copy consistently across release-facing surfaces.
- English fallback, if allowed for a partial pack, is clearly labeled and does not mix unreviewed safety/legal copy into production.
- Selected language and accessibility settings persist app-wide only after the behavior is real.
- Missing, corrupt, stale, or rolled-back packs fail closed to English without data loss.
- Layout and accessibility checks pass for long translated strings, dynamic type, TalkBack labels, and small Android screens.

## Verification Added In This Pass

`src/config/languageAvailability.ts` centralizes the release language metadata, and `src/config/__tests__/languageAvailability.test.ts` verifies that only English is selectable while Kiswahili and Sheng remain unavailable.
