# Contributing to SafeRide

SafeRide handles unusually sensitive safety, evidence, and location workflows.
Contributions must protect people before convenience.

## Public mirror boundary

`esherialabs/saferider` is a clean, history-free source mirror of reviewed
SafeRide code. It grants visibility, not an OSI license or redistribution
rights. External pull requests are not accepted until contribution and code
licensing terms are approved. Use the SafeRide website contact page for general
review feedback and GitHub private vulnerability reporting for security issues.

## Before changing code

- Work from origin/feat/app-local-infra-phase-1 on an existing ESH issue branch.
- Do not target or commit to main, and do not commit directly to the base.
- Read AGENTS.md, the issue comments, and the relevant safety/privacy runbook.
- Use synthetic fixtures only. Never paste survivor, participant, evidence,
  prompt/completion, exact-location, credential, or partner-confidential data.
- Keep one focused issue, branch, worktree, write scope, and verification list.

## Pull requests

Describe behavior, safety/privacy impact, verification, limitations, rollback,
and evidence updates. Link the existing issue. New claims require structured
evidence; screenshots and prose alone are not sufficient. Required independent
review cannot be self-approved.

Run the smallest relevant checks plus typecheck, tests, staged secret scan, and
the affected evidence validator. Release changes also require coverage, SBOM,
dependency, repository-safety, and release-evidence gates.

Do not run deployments, public releases, store submissions, model downloads,
training/export, destructive resets, or production changes unless the issue
explicitly authorizes them.
