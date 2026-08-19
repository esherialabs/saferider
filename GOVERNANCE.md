# Governance

SafeRide is an Esheria For Good open-source project stewarded by Esheria
Ventures Limited. Governance is public, role-based, and evidence-bound.

## Roles

- **Accountable maintainer:** Franklin Sagini (`@fsagini`) owns repository
  administration, release coordination, and final conflict resolution.
- **Backup maintainer role:** the Esheria Ventures Limited engineering lead may
  restore access, coordinate continuity, and appoint an acting maintainer.
- **Domain reviewers:** privacy/security, safeguarding/product, mobile/API,
  machine learning, legal/language, accessibility, and release owners review
  changes within their expertise.
- **Contributors:** anyone participating through public issues, discussions,
  documentation, testing, design, or code contributions.

Code ownership never replaces an independent review required for safety,
privacy, security, model behavior, or release claims. A contributor may not
self-approve a required independent gate.

## Decisions

Routine changes use public issues and pull requests. Maintainers seek lazy
consensus and normally allow at least seven calendar days for substantial
architecture or governance proposals. When consensus is not reached, the
accountable maintainer records the decision and rationale publicly.

Changes to safety behavior, privacy processing, model use, licensing,
repository visibility, artifact distribution, or release claims require:

1. a public-safe issue and risk statement;
2. a focused reviewed change;
3. relevant automated and human verification;
4. an evidence or decision record; and
5. approval by the accountable domain owner.

Urgent security and safeguarding fixes may be developed privately and disclosed
after mitigation. Unresolved conflicts fail closed: the affected capability
remains disabled and the associated claim remains blocked.

## Community roadmap and releases

The public GitHub project board is the roadmap for open work. Issues and release
milestones must distinguish implemented behavior, evidence-only work, and
external blockers. Tagged releases include release notes, checksums, coverage
evidence, and reproducible source-build records.

External contributions target the public repository. Maintainers reconcile
accepted changes with the private release-integration repository and publish a
clean, reviewed snapshot without private history or restricted records.

## Conduct and appeals

The `CODE_OF_CONDUCT.md` applies to all project spaces. A participant may ask
the backup maintainer role to review a conduct or governance decision when the
accountable maintainer has a conflict of interest.
