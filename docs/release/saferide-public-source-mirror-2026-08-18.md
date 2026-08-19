# SafeRide canonical open-source repository publication

Date: 2026-08-18

Issue lineage: ESH-4198

Integration target: `feat/app-local-infra-phase-1`

Canonical public repository: `https://github.com/esherialabs/saferide`

## Decision

The project owner authorized publication of a clean, history-free snapshot of
the current SafeRide mobile application, owned API, local infrastructure,
website, public-safe AI tooling, schemas, tests, documentation, and release
evidence as the official open-source repository.

The private full-history repository remains restricted and is retained under an
internal repository name. Its private history, credentials, production cloud
configuration, restricted evidence, and submission records are not transferred
to the public repository.

## License boundary

- Public code, tests, schemas, and build tooling: Apache-2.0.
- Enumerated original documentation, educational content, and guardrails:
  CC-BY-4.0.
- Model, adapter, dataset, and benchmark artifacts: terms recorded in
  `MODEL-DATA-LICENSES.md`.
- Fonts, media, partner marks, and brand assets: terms recorded in
  `ASSET-LICENSES.md` and `TRADEMARKS.md`.
- Real-person data, credentials, private security material, partner agreements,
  production records, risk/incident registers, and UNICEF submission records:
  excluded and not licensed.

The public `LICENSE` and `NOTICE` are inserted by the publication generator;
the private integration repository's all-rights-reserved notice is not copied.

## Public engineering evidence

- Mobile and API TypeScript checks pass.
- Website lint, typecheck, production build, and 16-route static-export
  validation pass.
- Secret scanning passes across the reviewed tracked tree.
- Global coverage passes the 15% contractual floor at 35.60% statements,
  33.77% branches, 34.37% functions, and 36.07% lines (630 tests).
- Named critical TypeScript modules pass 80% per-file gates, with aggregate
  93.59% statements, 90.18% branches, 98.73% functions, and 95.75% lines.
- Critical Node evidence modules pass at 95.62% lines, 87.50% branches, and
  94.17% functions.
- API and website production dependency audits report zero vulnerabilities.
- The remaining mobile npm findings are a time-bounded public-source CI
  exception for reviewed Expo/Metro/Xcode build-tool advisories; they do not
  authorize a production or store release.

Public CI uploads coverage and reproducibility artifacts. Tag automation builds
the source archive twice, compares the bytes, and publishes the archive,
SHA-256 ledger, and provenance JSON.

## Android preview retained

Canonical download page:
`https://saferide.esheria.org/download/`

Tested APK SHA-256:
`56b61c7a7002a97aedc0c943a382d0e200ef152aec398ea82720effe235c65f5`

The preview remains controlled testing only. It is not a production,
emergency-service, survivor-facing, Google Play, partner-pilot, or
UNICEF-approved release.

## Ecosystem boundary

- Esheria For Good: `https://esheria.org/`
- SafeRide website: `https://saferide.esheria.org/`
- Canonical source: `https://github.com/esherialabs/saferide`
- Current mobile model:
  `https://huggingface.co/esherialabs/saferide-gemma-4-e2b-v058-original-419806-litertlm`

SafeRide is not part of the commercial `esheria.ai` product site.
