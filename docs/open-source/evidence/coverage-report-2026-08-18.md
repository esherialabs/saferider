# SafeRide coverage evidence — 18 August 2026

## Verification result

The open-source coverage gates passed against source commit
`ed22536d6a0881b023af25c79c4a11e946e5ae4b` on 18 August 2026.

| Gate | Tests | Statements | Branches | Functions | Lines | Result |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Public repository, all measured source | 630 | 35.60% (6,261/17,586) | 33.77% (4,840/14,329) | 34.37% (1,348/3,921) | 36.07% (5,934/16,451) | Passed 15% floor |
| Public critical safety/privacy modules | 41 | 93.59% (307/328) | 90.18% (239/265) | 98.73% (78/79) | 95.75% (271/283) | Passed 80% per-file gate |
| Private integration evidence contracts | 34 | — | 87.50% | 94.17% | 95.62% | Passed 80% gate |

The private integration row is an aggregate result only. Restricted UNICEF
evidence, survivor-related material, and private release controls are not
published in the open-source snapshot.

## Commands

```bash
npm ci
npm run coverage:check:public
```

The private integration repository additionally ran:

```bash
npm run test:coverage:critical:node
```

All 106 public all-source test files passed (630 tests), all seven public
critical test files passed (41 tests), and all 34 private evidence-contract
tests passed.

## Toolchain

- Node.js: `v22.22.0`
- npm: `10.9.4`
- coverage provider: Vitest/V8 for public TypeScript; Node.js test coverage for
  the private integration contracts
- machine-readable companion:
  `docs/open-source/evidence/coverage-report-2026-08-18.json`

GitHub Actions repeats the public gates from a clean checkout. This record
documents the local release-candidate run; it does not claim a remote workflow
run until the canonical public repository reports one.
