# SafeRide Public Website

Next.js 16 site for the SafeRide public launch branch. The site is intentionally content-led: public claims should stay traceable to the mobile app, local data packs, backend handoff notes, and launch readiness docs in this repository.

## Key Content Files

- `src/content/guides.ts` - long-form guide content, dates, sources, editorial boundaries, and related links.
- `src/lib/site.ts` - homepage data, navigation, organization/brand constants, and the guide index.
- `src/lib/pages.ts` - interior route content for product, survivor, privacy, route-safety, open-source, partner, story, and impact pages.
- `IMAGE_PROMPTS.md` - exact image prompts and safety guardrails for missing launch assets.
- `REPO_AUDIT.md` - repo-content audit summary used to update the website.
- `API_ROADMAP.md` - documentation-only direction for moving from the Supabase prototype to a first-party API.
- `LAUNCH_CHECKLIST.md` - launch smoke tests, non-claims, approvals, and risks.

## Local Development

```bash
npm --prefix web install
npm --prefix web exec playwright install chromium
npm --prefix web run dev
```

Open the local URL printed by Next.

## Validation

Run from the repository root:

```bash
npm --prefix web run lint
npm --prefix web run typecheck
npm --prefix web run build
npm --prefix web run build:static
npm --prefix web run validate:static
npm --prefix web run manifest:static
npm --prefix web run verify:static
```

For the Playwright smoke suite, build first, start the Next server, then run:

```bash
cd web
npm run e2e
```

Set `PLAYWRIGHT_BASE_URL` when testing against a non-default local or preview server.

## SEO and Content Governance

- Keep every canonical URL in trailing-slash form through `canonicalUrl()`.
- Bump a route's `updatedAt` when its visible content materially changes; blog guides keep separate `publishedAt` and `updatedAt` values.
- Do not publish medical, legal, emergency, or survivor-support guidance without a named safeguarding review. Source time-sensitive claims from official or qualified organizations.
- Keep private evidence, survivor narratives, exact journeys, and credentials out of pages, logs, test fixtures, screenshots, and analytics.
- New guides need a specific reader intent, an honest editorial boundary, useful internal next steps, and source links where claims require verification. Word count is not an acceptance criterion.
- SafeRide is a brand operated by Esheria. Keep the parent entity ID aligned with `https://esheria.ai/#org`, use the sanitized public source mirror at `https://github.com/esherialabs/saferider`, and do not describe the all-rights-reserved app code as OSI-licensed.
- The canonical Android preview record is `public/releases/saferide-v0.5.8-android.json`. Website copy, JSON-LD, download links, checksums, GitHub release notes, and Hugging Face project links must remain aligned with that record.
- Production deployment is manual from `feat/app-local-infra-phase-1`. The workflow must pass static-export validation, Playwright against the export, manifest verification, production smoke tests, and deployed-file hash verification.

## Image Assets

The homepage references six launch visuals under `web/public/images/`. If they are missing or invalid, `next start` will log image optimizer warnings during browser tests. Generate the assets from `IMAGE_PROMPTS.md`, then rerun build and Playwright.

## Backend Note

The mobile repo still contains Supabase prototype integration and documentation. The current product direction is to move to a first-party SafeRide API, documented here only. Do not change app services, Supabase migrations, or Edge Functions as part of website-only content updates.
