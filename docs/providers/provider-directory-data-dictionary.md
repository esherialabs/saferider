# Provider directory data dictionary

The normative shape is `schemas/provider-directory.schema.json`. The pack is
public support-directory metadata only; it must never contain survivor records,
referral payloads, attendance, receipt state, case identifiers, exact private
locations, or free-text notes about an individual.

| Field | Meaning and gate |
| --- | --- |
| `packId`, `version` | Stable pack identity and immutable semantic version. Reusing a version with different bytes is rejected. |
| `status` | `candidate` is review-only, `active` is promotion-eligible, and `revoked` is never loadable. |
| `updatedAt`, `expiresAt` | UTC pack freshness boundary. An expired remote pack is rejected; an expired bundled candidate is shown as expired and remains non-actionable. |
| `stableId` | Stable non-person provider identifier; it must not be a database UUID generated on refresh. |
| `serviceCategory` | Controlled service category used by filtering and display. |
| `coverage` | Country, coverage kind, named public areas, and a plain-language coverage caveat. Exact survivor location is prohibited. |
| `hours` | Sourced availability statement plus its independent verification state. |
| `eligibility` | Sourced eligibility statement. SafeRide does not decide eligibility; `verified` requires an accountable reviewer and date. |
| `contacts` | Public provider channels. Each value binds to one source and has its own reviewer gate. Pending, expired, or revoked contacts are not actionable in the app. |
| `languages`, `services` | Controlled public service metadata; these are not claims that an appointment is available. |
| `sources` | HTTPS public-source references and access timestamps. A source link alone is not an approval. |
| record `status` | Only `active` records with current, verified contact/eligibility/hours evidence can expose contact actions. |
| record `updatedAt`, `expiresAt` | Per-provider freshness boundary. Expired entries remain non-actionable even if a pack is current. |
| manifest `packSha256` | SHA-256 of the pack under `sorted-json-v1` canonicalization. Both mobile and repository validators recompute it. |
| manifest `attestation` | Hash-bound release-owner evidence. A pending, expired, revoked, or mismatched attestation blocks distribution. |
| manifest `partnerValidation` | Hash-bound validation by at least one accountable provider partner. It cannot be replaced by source links or an internal test. |
| manifest `changelog` | Human-readable, non-sensitive pack changes. |
| manifest `rollback` | Last-known-good cache reference and optional previous immutable pack identity. |
| manifest `release` | Distribution decision, staged rollout percentage, and immutable source revision. |
| rollout `closedLoopClaims` | Both provider receipt and appointment attendance stay `false`; a directory listing or contact action is not a closed-loop provider integration. |

The checked-in v1 pack is intentionally a candidate. Its source URLs are
preserved from the legacy catalog, but no human or partner review is invented.
Accordingly every contact and eligibility statement is pending, rollout is zero,
and the app must not present a contact action from this pack.
