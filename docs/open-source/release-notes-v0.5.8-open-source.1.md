# SafeRide v0.5.8-open-source.1

This is the first canonical SafeRide open-source source release.

## Included

- Android/Expo mobile application source and ongoing iOS integration
- owned SafeRide API and local PostgreSQL/Redis development infrastructure
- SafeRide public website source
- public-safe local-AI download, verification, lifecycle, training, export, and
  evaluation code
- Apache-2.0 code licensing and CC-BY-4.0 original content licensing
- contribution, conduct, security, governance, architecture, and maintainer
  documentation
- public issue and pull-request templates
- CI definitions, test/coverage evidence, dependency policy, CycloneDX SBOM,
  secret scanning, and deterministic source-archive tooling

## Verified source gates

- mobile TypeScript: passed
- owned API typecheck: passed
- secret scan: passed
- public repository validator: passed
- production API dependency audit: 0 vulnerabilities
- production website dependency audit: 0 vulnerabilities
- all-source coverage: 630 tests; 33.77% branches and 36.07% lines
- critical safety/privacy coverage: 41 tests; 90.18% branches and 95.75% lines
- static website build/export validation: passed

GitHub-hosted jobs were configured but could not start during publication
because the organization Actions budget blocked runner allocation. No remote
job is represented as executed or passed; the local clean-checkout evidence is
published under `docs/open-source/evidence/`.

## Distribution

- source repository: `https://github.com/esherialabs/saferide`
- release: `https://github.com/esherialabs/saferide/releases/tag/v0.5.8-open-source.1`
- canonical Android download/checksum page:
  `https://saferide.esheria.org/download/`

The release does not publish credentials, signing keys, survivor information,
private partner material, production environment values, restricted UNICEF
records, or private release artifacts.
