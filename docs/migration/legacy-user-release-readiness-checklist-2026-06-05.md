# Legacy User Migration And Staged Release Readiness Checklist

Date: 2026-06-05
Issue: ESH-3955
Target branch: `feat/app-local-infra-phase-1`

This document is a release-readiness checklist for moving legacy SafeRide users into the modernized local/owned-stack app. It is not a final release signoff, EAS build approval, production deploy plan, or migration implementation ticket.

## Scope And Human Gates

- RISK_LEVEL: High. The upgrade touches survivor drafts, media references, queued work, auth/session state, privacy settings, decoy access, catalog cache, and local assistant assets.
- ACCESS_PROFILE: Source/documentation review only. No EAS, AWS, Docker reset, production migration, device data access, or long-running job is authorized by this checklist.
- HUMAN_APPROVAL_REQUIRED: APK/AAB generation, production/staging deployment, staged rollout activation, rollback for real users, and final ship/no-ship decision.
- Coordination boundary: Keep using ESH-3868 for final signoff, ESH-3896 for EAS/device execution, and ESH-3897 for the screen QA matrix. This checklist adds the legacy-user migration gate only.

## Source-Evidenced Inventory

| Area | Source files/services | Current storage or API boundary | Migration risk |
| --- | --- | --- | --- |
| App startup migration | `App.tsx`, `src/utils/draftMigration.ts` | `hydrateRuntimeConfig()` then `migrateSecureStoreDraftsIfNeeded()` before app readiness | Migration can fail silently unless device QA proves imported drafts appear before users continue. |
| Legacy drafts | `src/lib/storage.ts`, `src/utils/draftMigration.ts` | SecureStore key `incident_drafts`; migration flag `draft_migration_v1_done` in AsyncStorage | Legacy draft text, location, timestamps, notes, audio URIs, and photo URIs can be lost, duplicated, or skipped. |
| Modern drafts | `src/utils/draftStorage.ts`, `src/utils/localDraftDatabase.ts`, `src/services/draftService.ts`, `apps/api/src/routes/drafts.ts` | AES-GCM SQLite rows plus encrypted active pointer; legacy/fallback AsyncStorage key `incident_drafts`; owned API `/api/drafts` | Device upgrade must prove transactional source migration, device-bound key continuity, and that an older build cannot rewrite rows to plaintext. |
| Offline queue/cache | `src/utils/offlineSync.ts`, `src/services/draftService.ts`, `src/services/caseService.ts` | AsyncStorage `@sync_queue`, `@offline_*` | Queued draft updates, deletes, or submissions can be lost, duplicated, or cleared after auth failure. |
| Media/evidence files | `src/screens/EvidenceDetail.tsx`, `src/hooks/useStealthMode.ts`, `src/services/caseService.ts`, `src/utils/dataExport.ts` | Expo FileSystem/document-picker URIs, `DraftData.mediaFiles[].uri`, signed evidence upload/complete/download APIs | Draft records may survive while local files become unreadable after OS cleanup, reinstall, or permission changes. |
| Auth/session | `src/lib/auth/authClient.ts`, `src/lib/secureStoreAdapter.ts`, `src/context/AuthProvider.tsx` | SecureStore key prefix `saferide_auth_`, stored session key `saferide_local_auth_session`, owned auth endpoints | Expired sessions can force sign-out and may clear sync queue state during replay. |
| Settings/onboarding | `src/lib/storage.ts`, `src/context/OnboardingProvider.tsx`, `src/screens/Settings.tsx` | SecureStore `app_settings`; AsyncStorage `onboarding_state_v1` | Stealth settings are persisted in two places; older settings beyond stealth may be ignored unless explicitly verified. |
| Privacy controls | `src/screens/PrivacyData.tsx`, `src/utils/appReset.ts`, `src/utils/dataExport.ts` | Local drafts, offline queue/cache, local export/share files | Copy must not promise deletion of remote records, shared exports, OS backups, provider copies, or full encryption/redaction. |
| Decoy PIN | `src/utils/decoyPin.ts`, `src/screens/Calculator.tsx` | AsyncStorage `safe_ride_decoy_pin`, `calculator_state` | PIN unlock or calculator plausibility can regress after upgrade. |
| Catalog cache | `src/lib/catalog.ts`, `assets/data/providers.json`, `assets/data/legal_tags.json`, `assets/data/tips.json` | AsyncStorage `@catalog_providers`, `@catalog_legal_tags`, `@catalog_tips`; `/api/providers`, `/api/legal-tags`, `/api/tips` | Cached provider/support content can be stale or mistaken for freshly verified data. |
| Runtime config | `app.config.js`, `src/config/env.ts`, `src/config/runtime/runtimeConfigStore.ts`, `apps/api/src/routes/runtimeConfig.ts` | Expo extra config; AsyncStorage `@saferide_runtime_config_override`; `/api/config/runtime` | Candidate builds can accidentally resolve local/private/stale endpoints. |
| Local assistant assets | `src/config/localAssistant.ts`, `src/services/localAssistantService.ts`, `src/lib/localAssistant/modelRegistry.ts`, `src/lib/localAssistant/modelStorage.ts` | `FileSystem.documentDirectory/models/<model-dir>/`; model manifest/checksums | Model files can be missing, partial, stale, too large for in-memory checksum, or unavailable offline. |
| App identity/version | `app.json`, `app.config.js`, `eas.json` | Name `Safe Ride`, slug `saferide`, version `0.1.0`, package/bundle `com.esheria.saferide.app` | Version or identity changes without release-owner approval can invalidate upgrade or artifact review assumptions. |

## Release-Blocking Checklist

Each blocker must pass on a release-candidate artifact or be explicitly deferred by a human release owner before APK/AAB generation or rollout expansion.

| Gate | Level | Manual verification | Data-loss or safety risk |
| --- | --- | --- | --- |
| Legacy draft import runs once | Blocker | Install over a build with SecureStore `incident_drafts`; confirm startup migration imports drafts and sets `draft_migration_v1_done` only after success. | Older drafts disappear, duplicate, or become unrecoverable. |
| Legacy draft content mapping | Blocker | Verify imported what/where/when details, location coordinates/address, notes, audio/photo URIs, timestamps, and generated media records from `src/utils/draftMigration.ts`. | Survivor loses incident details or evidence references. |
| Existing modern draft preservation | Blocker | Upgrade with existing AsyncStorage `incident_drafts` plus legacy SecureStore drafts; confirm modern drafts are not overwritten. | Current drafts are replaced by imported legacy data. |
| Partial draft save behavior | Blocker | Run `npm test`; manually save across What/Where/Evidence/Pathway and confirm later route/status saves preserve earlier text, location, tags, privacy settings, and media. | Progress updates erase report content. |
| Old settings migration | Blocker | Seed legacy `app_settings` with stealth trigger, haptics, auto-record, emergency contacts, theme, notifications, auto-location, and auto-backup. Confirm preserved, retired, or unsupported fields are documented. | Safety or privacy expectations change silently. |
| Onboarding/stealth consistency | Blocker | Complete onboarding, change stealth settings, restart, sign out/in, and confirm `onboarding_state_v1` and SecureStore `app_settings` agree. | Stealth trigger behavior changes during a safety workflow. |
| Decoy PIN compatibility | Blocker | Configure PIN, upgrade, use normal calculator operations, then enter PIN. Confirm unlock works and calculator state remains plausible. | User cannot leave decoy mode or the decoy exposes SafeRide. |
| Queued draft replay | Blocker | Offline save/update/delete drafts, kill app, relaunch, reconnect, and verify `@sync_queue` replays exactly once. | Queued work is lost, duplicated, or misreported as sent. |
| Queued submission replay | Blocker | Queue a submit item for a draft with and without media; reconnect and verify case creation plus attachment completion or a clear failed state. | User thinks report/evidence was submitted when only local state exists. |
| Auth loss during sync | Blocker | Expire/revoke local auth, reconnect with queued work, and confirm sign-out/queue behavior is visible and does not show success. | Queue is cleared or blocked without recovery guidance. |
| Media URI continuity | Blocker | Capture/import photo, audio, video, and document evidence before upgrade; after upgrade, open previews, export checksums when available, and submit each file. | Draft exists but evidence files cannot be opened or uploaded. |
| Evidence upload completion | Blocker | Smoke `/api/cases/:id/evidence` and `/complete`; confirm uploaded attachments include server hash/size status and failed uploads are visible. | Partial evidence upload is hidden from the user. |
| Privacy setting truth | Blocker | Review all migration, evidence, export, and privacy copy for `blurFaces`, `removeMetadata`, and `encryptFiles`; describe them as requests/preferences unless processing is proven. | App overclaims redaction, metadata removal, encryption, or anonymity. |
| Local delete truth | Blocker | Use Privacy & Data deletion; confirm it clears local drafts, queue/cache, and app reset handlers only. Copy must exclude remote records, shared exports, provider copies, and OS backups. | User relies on deletion beyond the app's control. |
| Catalog freshness | Must-pass | Load catalogs online, go offline, restart, and confirm cached/seed fallback is labelled cautiously with visible update state. | Stale support data appears current or provider-verified. |
| Runtime endpoint gate | Blocker | Resolve candidate Expo config and runtime override; confirm owned HTTPS/WSS endpoints, not localhost, LAN, HTTP, WS, private IP, or Supabase-shaped values. | Artifact ships to wrong backend. |
| API compatibility | Blocker | Smoke `/api/drafts`, `/api/cases`, signed evidence upload/complete/download, `/api/providers`, `/api/tips`, `/api/legal-tags`, and `/api/config/runtime`. | Upgraded app cannot read/write user data. |
| Local assistant assets | Must-pass | Enable local assistant, download/prepare model files, restart offline, and verify ready/error/retry states plus disk-space behavior. | Large local assets fail after upgrade or leave unrecoverable partial downloads. |
| Language/accessibility | Must-pass | Verify migration copy, delete prompts, offline banners, and settings in large text and TalkBack/VoiceOver. Check English-first copy is Kiswahili-ready without unsupported provider/emergency claims. | Users cannot understand or operate migration/recovery states. |

## Must-Pass Commands Before APK/AAB Request

These are local source checks only. They do not start EAS, AWS, Docker, production deployment, or release artifact generation.

```bash
npm test
npx tsc --noEmit
npm --prefix apps/api run typecheck
npm run secrets:scan
git diff --check
```

Record the candidate branch, commit, app version, Android package, iOS bundle ID, EAS project ID, API/auth/storage/WSS endpoint family, local assistant flags, Azure/OpenAI flags, and whether runtime config is bundled, override, or remote.

## Manual Upgrade Rehearsal Matrix

| Scenario | Starting state | Expected result | Evidence to capture |
| --- | --- | --- | --- |
| Clean install | No prior app data | No data-found wording; onboarding starts normally. | Version, first screen, empty draft list. |
| Legacy drafts only | SecureStore `incident_drafts`; no modern drafts | Drafts appear once in modern draft list with text and media references intact. | Before/after draft count, detail screenshot, media open result. |
| Legacy plus modern drafts | SecureStore and AsyncStorage drafts | Both sources remain available without duplicate IDs or overwritten modern records. | Key inventory by backend, visible draft list. |
| Offline draft update/delete | `@sync_queue` has update/delete work | Queue persists over upgrade and resolves accurately after reconnect. | Queue count, API draft result, failure copy if any. |
| Offline submission | Submit queue references local draft and files | Submission completes with attachments or remains queued/failed with clear state. | Case ID, attachment count, upload completion state. |
| Expired session | Stored local auth session cannot refresh | App asks for auth or signs out without claiming sync success; local drafts remain recoverable if intended. | Auth state, queue state, draft access. |
| Media-heavy draft | Photo/audio/video/document URIs | Files preview/hash/upload where readable; unreadable files are listed without deleting the draft. | Per-file result list. |
| Decoy setup | PIN and calculator state configured | Calculator remains plausible and PIN unlock still works. | Calculator behavior, unlock route. |
| Privacy controls | Retention/export/delete/privacy settings touched | Unsupported controls are disabled or clearly scoped; no overbroad encryption/deletion/export claim appears. | Settings screenshots and copy review notes. |
| Local assistant downloaded | Existing model files in document storage | Assistant is ready offline or shows recoverable download/error state. | Model status and retry result. |
| Catalog cache | Cached provider/tip/tag data | Cache or seed fallback is visible and update timestamps refresh online. | Catalog timestamps and offline fallback state. |

## Rollback And Recovery Guidance

Rollback for real users requires human release-owner approval.

1. Stop rollout expansion immediately if any cohort reports missing drafts, broken evidence URIs, lost queued work, unexpected sign-out, or misleading privacy/delete behavior.
2. Keep the previous approved artifact available until upgrade rehearsal passes. Do not ask users to clear app data or reinstall as a first response.
3. If migration fails before `draft_migration_v1_done`, preserve the device and capture non-secret key presence/counts for SecureStore `incident_drafts`, AsyncStorage `incident_drafts`, `@sync_queue`, `@offline_*`, catalog keys, and runtime override.
4. If migration fails after `draft_migration_v1_done`, do not delete local data. Ship a recovery patch that can safely re-read legacy drafts or provide a guided manual recovery path.
5. If media URIs fail, preserve the draft and show a file-unavailable state. Do not remove the draft or state that evidence was uploaded.
6. If auth expires during sync, keep local drafts visible where possible and show a sync attention state. Do not say queued items synchronized unless every item succeeded.
7. If runtime config points to the wrong backend, halt artifact promotion and fix the config/version gate before rollout expansion.
8. `npm run local:reset` is only for local Docker rehearsal data. It is not a user-device, staging, or production rollback action.

## Version Gates

- Migration flag: `draft_migration_v1_done` is v1. Any incompatible mapping change needs a new flag, idempotent rerun behavior, and recovery notes for devices that already set v1.
- Draft schema: Changes to `DraftData` in `src/utils/draftStorage.ts` need tests that preserve unknown fields, partial saves, media dates, and media URI references.
- API schema: `/api/drafts` must accept existing serialized payloads when new fields are added, or the release needs a server-side compatibility migration.
- Queue schema: New queue item types must define replay behavior, max retries, auth failure handling, and user-visible failed states.
- Runtime config: Candidate builds must fail review if release profiles resolve local/private/Supabase-shaped endpoints.
- Local assistant model: New model IDs, storage directories, file manifests, or checksum behavior need disk-space and partial-download recovery checks.
- App identity/version: Version, slug, package, bundle ID, and EAS project changes require human approval and must be reflected in final signoff artifacts.

## Staged Rollout Plan

1. Source gate: run all must-pass source checks and resolve every blocker or assign explicit human deferral.
2. Internal upgrade rehearsal: test clean install and legacy-data upgrade on Android; repeat on iOS if iOS is in scope.
3. Artifact gate: only after explicit approval, generate the selected APK/AAB from a recorded branch, commit, and profile.
4. Device smoke: run the EAS/device runbook and this upgrade matrix on the produced artifact.
5. Limited rollout: release to a small approved test cohort; monitor migration errors, crashes, support tickets, sync failures, and evidence upload failures.
6. Hold gate: do not expand if draft migration, media access, queued sync, auth refresh, privacy/delete copy, or runtime config fail.
7. Expansion: widen only after human review confirms no material survivor-data or safety regressions.
8. Post-rollout review: record outcomes, caveats, and follow-up issues before final release signoff.

## Release Notes And User Copy

Release notes for legacy users should say:

- SafeRide updated how drafts, offline work, and local settings are stored.
- On first launch after update, SafeRide checks this device for older drafts.
- Users should review imported drafts and attached files before sharing or submitting.
- Offline items may need internet access and a valid session before they can sync.
- Provider/support listings can change; users should review saved contact details.
- Local deletion removes local SafeRide drafts, pending offline packets, and cached case data from this device. It does not remove shared exports, remote records, provider copies, or OS backups.

Release notes and migration UI must not claim emergency response, police reporting, legal advice, medical advice, provider handoff, end-to-end encryption, full media encryption, guaranteed redaction, complete anonymity, automatic remote deletion, or secure/court-ready export unless current implementation evidence and human approval support the claim.

Suggested UI copy:

```text
SafeRide is checking this device for older drafts from the previous app version.
```

```text
Older drafts found on this device were added to your draft list. Review each draft and any attached files before sharing or submitting.
```

```text
Some older drafts could not be added. Your existing app data was not cleared. Keep this device available for review by the project team.
```

```text
This draft was imported, but one file could not be opened on this device. The draft text and details are still saved.
```

```text
Some items are still waiting to sync. Connect to the internet and sign in before trying again.
```

```text
This removes local SafeRide drafts, pending offline packets, and cached case data from this device. It does not remove files you already exported, shared, or submitted to another service.
```

## Open Review Risks

- `src/utils/draftMigration.ts` migrates legacy drafts, but this checklist did not find equivalent migration for legacy `app_settings`, `user_data`, emergency contacts, notification preference, auto-location, or auto-backup settings.
- Modern draft, queue, and catalog data on this branch use AsyncStorage; do not describe those payloads as encrypted unless the accepted implementation changes and evidence support it.
- `src/utils/offlineSync.ts` clears the sync queue during invalid-auth sync reset. That behavior needs product/security review and user-visible recovery copy before rollout.
- `src/services/caseService.ts` can create a case while individual attachment uploads fail. Device QA must verify partial-upload failures are visible.
- `src/lib/localAssistant/modelStorage.ts` skips checksum validation for files larger than 64 MB to avoid memory pressure. Release owners need a device-safe integrity strategy or explicit risk acceptance.
- `src/screens/EvidenceDetail.tsx` includes privacy labels for face blur, metadata removal, and evidence encryption; these need release-truth review before migration copy repeats them.

DECISION: PASS_SCRIBE_OUTPUT_READY. The checklist is ready for SafeRide Review Sentinel or Review Runner to validate against implementation and device evidence. It is not a release approval.
