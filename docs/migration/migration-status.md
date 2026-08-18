# Migration Status

Date: 2026-05-29

## Completed In This Branch

- Secret externalization baseline moved to an app/infrastructure branch.
- Local Docker Compose stack added for Postgres, MinIO, Redis, local auth, API, WebSocket, Prometheus, and Grafana.
- Owned API scaffold added under `apps/api`.
- REST contracts scaffolded for drafts, cases, evidence upload, chat, and catalog.
- Evidence signed-upload flow includes manifest, MIME/size validation, SHA-256 verification, retention metadata, and antivirus placeholder status.
- Runtime config store added for endpoint switching without app rebuild.
- Pre-commit secret scan hook added.
- Mobile auth adapter uses local local auth session semantics and SecureStore persistence.
- Catalog reads use owned API with cache/seed fallback.
- Draft reads/writes/deletes use owned API with AsyncStorage and offline replay fallback.
- Offline draft replay routes through the owned API.
- Offline submit replay retains queued survivor data on auth loss or max-retry failure with local recovery metadata and user-facing retry copy.
- Case creation, case detail/list, evidence signed upload, server-side SHA-256 completion, and signed download use the owned API/MinIO path.
- Partial evidence upload failure after case creation keeps the draft queued with the owned API case ID, failed media status, and retryable upload state instead of presenting full success.
- Chat persistence uses owned API endpoints.
- Chat realtime uses Socket.IO rooms fed by API-published Redis events.
- Hosted backend client dependencies, legacy function code, and direct client database/storage fallback paths have been removed.

## Not Complete Yet

- Full Expo Go end-to-end testing on a physical device still needs Docker Desktop running on the current LAN.
- Case export/download paths need a final device-level pass against MinIO signed download URLs.
- Offline case submission replay now has focused unit coverage for auth-loss retention, max-retry retention, duplicate submit dedupe, and partial evidence retry. Physical device replay still needs airplane-mode/auth-invalid rehearsal.
- Remote legal-chat LLM handling is currently unavailable unless implemented behind the owned API.
- Native media processors for face blur, raw metadata stripping, and raw evidence file encryption are not complete in this Expo build; UI and QA copy should treat these as saved requests/status until implemented and reviewed.
- Legacy-user upgrade readiness is documented in `docs/migration/legacy-user-release-readiness-checklist-2026-06-05.md`; the checklist still requires device upgrade rehearsal and human approval before any APK/AAB or staged rollout decision.

## Next Implementation Order

1. Start Docker Desktop and run `npm run local:up`.
2. Run Expo Go through signup/login, catalog, drafts, case submission, evidence upload/download, and chat.
3. Add targeted retry tests for offline draft and case replay.
4. Keep legal-chat assistant inference local to the phone unless a future issue explicitly reintroduces backend assistant support.
