# Public architecture

SafeRide is an Android-first React Native/Expo application with an owned API,
offline-first storage, a local development stack, a static website, and an
optional on-device LiteRT-LM assistant.

## Components

| Component | Location | Responsibility |
| --- | --- | --- |
| Mobile application | `src/`, `App.tsx`, `android/`, `ios/` | Report drafts, evidence references, consent, cases, support, and local AI UX. |
| Owned API | `apps/api/` | Auth boundaries, drafts, cases, catalogs, signed evidence storage operations, chat history, and audit events. |
| Local infrastructure | `infra/local/`, `infra/postgres/` | Postgres, MinIO, Redis, local auth, API, WebSocket gateway, metrics, and dashboards. |
| Website | `web/` | Public project information, limitations, release links, and documentation entry points. |
| On-device AI | `src/lib/localAssistant/`, `plugins/`, `config/ai/` | Manifest-bound model download, integrity verification, local LiteRT-LM runtime, and fail-closed capability controls. |
| Public-safe AI tooling | `scripts/`, selected `docs/qa/`, `schemas/` | Synthetic-data validation, training/evaluation contracts, model cards, and release evidence. |

## Data boundary

Drafts and workflow state are local by default. Network actions occur only for
configured API services and explicit user-selected operations. Real survivor
records, evidence, exact locations, credentials, consent/event logs, and
production telemetry are not part of the public repository or test fixtures.

## AI boundary

The Android testing profiles can download the immutable SafeRide v0.5.8
LiteRT-LM artifact from its public Hugging Face repository and verify its
SHA-256 before local use. Generic production and prerelease profiles remain
fail-closed unless their exact configuration and evidence are approved.

The assistant provides bounded guidance and does not replace emergency,
medical, legal, counselling, police, or safeguarding professionals.

## Publication boundary

The public repository is generated from reviewed tracked files. Private Git
history, cloud account configuration, restricted evidence, real-person data,
large binaries, and signing material remain outside the public snapshot. See
`../../PUBLIC-MIRROR.md` for the exact boundary.
