# SafeRide sanitized public source mirror

Date: 2026-08-18

Issue: ESH-4198

Target branch: `feat/app-local-infra-phase-1`
Public repository: `https://github.com/esherialabs/saferider`

## Decision

The project owner authorized replacement of the stale 2025 public repository
with a clean, history-free source snapshot of the current SafeRide mobile,
owned API, local infrastructure, website, and release-metadata implementation.

This is a source-visibility decision, not an OSI license decision. Application
code and product content remain all rights reserved. The v0.5.8 model, adapter,
dataset, and model-card documentation retain their separately approved terms.

## Excluded material

The mirror generator excludes private Git history, APK/AAB/model binaries,
debug and production keys, ignored environment files, internal agent material,
restricted security evidence, UNICEF submission material, private artifact
bucket/version records, production cloud infrastructure, training datasets,
notebooks, and account-specific web resource records. GitHub Actions are not
copied or enabled.

## Required verification

- Generate from the exact merged integration commit.
- Confirm the output contains only Git-tracked allowlisted files.
- Reject forbidden binary and credential extensions.
- Run the SafeRide secret scanner inside the generated mirror.
- Record source commit, file count, total bytes, and SHA-256 ledger.
- Force-replace only the stale `esherialabs/saferider` repository, which had no
  stars, forks, issues, pull requests, tags, or releases at review time.
- Enable secret scanning, push protection, private vulnerability reporting,
  branch protection, and disable GitHub Actions on the public mirror.

## Boundary

The public mirror does not authorize production deployment, Google Play
submission, UNICEF submission, use of real survivor data, or publication of
the private AAB or private release-bucket objects.
