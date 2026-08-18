---
pretty_name: SafeRide Synthetic Bilingual Safety Guidance Dataset v0.5.8
language:
  - en
  - sw
license: cc-by-4.0
task_categories:
  - text-generation
tags:
  - saferide
  - bilingual
  - conversational
  - safety-guidance
  - synthetic-data
  - research-preview
size_categories:
  - 1K<n<10K
source_datasets:
  - original
configs:
  - config_name: original-419806-unique
    data_files:
      - split: train
        path: data/combined-unique-train.jsonl
  - config_name: original-419806-weighted
    data_files:
      - split: train
        path: data/weighted-train.jsonl
---

# SafeRide Synthetic Bilingual Safety Guidance Dataset v0.5.8

This research and development dataset contains synthetic English and Kiswahili
chat conversations. It was designed to help a language model practice cautious,
agency-preserving safety guidance, useful refusal behavior, and responses that
avoid inventing facts. It contains no real survivor reports or production
records. The frozen dataset is publicly available under Creative Commons
Attribution 4.0 International (CC BY 4.0). Public availability does not
establish real-world safety, effectiveness, or production readiness.

## Key facts

| Field | Value |
| --- | --- |
| Unique rows | 1,904 |
| Weighted training examples | 1,992 |
| Languages | English and Kiswahili, 952 unique rows each |
| Content source | Synthetic only |
| Available split | Train only |
| Access | Public research dataset |
| Primary artifact SHA-256 | `669835b5f680b2198cf06d8c23a02d2e9aba2acba816c6283a0cdbbf8586a15e` |

## Intended uses

Researchers and developers may use this dataset to:

- reproduce the training input for the linked SafeRide v0.5.8 PEFT adapter;
- study bilingual, synthetic conversational safety data under controlled
  research conditions;
- audit the documented data composition, weighting, and training lineage; and
- develop and evaluate safer response patterns before any real-world testing.

## Out-of-scope and responsible-use boundaries

CC BY 4.0 permits reuse, adaptation, and redistribution with attribution. The
following are product and safety boundaries, not additional copyright-license
restrictions. Public availability must not be treated as authorization for:

- use as evidence that a model is safe, effective, culturally appropriate, or
  useful to survivors in the real world;
- direct legal, medical, counselling, emergency, investigative, or eligibility
  decisions;
- training systems for surveillance, coercion, profiling, or decisions about
  an identifiable person; or
- adding real survivor narratives, evidence, audio, transcripts, locations,
  credentials, production logs, or other personal or confidential data.

Reusers must provide attribution, link to CC BY 4.0, indicate changes, and must
not imply endorsement by Esheria Ventures Limited, SafeRide, or UNICEF.

## Loading the dataset

The repository is public. No Hugging Face credential is required to load the
immutable training revision.

```python
from datasets import load_dataset

repo_id = "esherialabs/saferide-gemma-4-e2b-v058-original-419806-training-data"
artifact_revision = "ab43518babcf6255fddf7ae0087f7ce78a84a707"
training_data = load_dataset(
    repo_id,
    "original-419806-weighted",
    split="train",
    revision=artifact_revision,
)
```

This example is syntax-checked. The immutable JSONL files and their public
metadata are separately checksum-verified at the revision shown above.

## Configurations and weighting

The repository exposes two configurations:

- `original-419806-unique` contains 1,904 deduplicated conversations and is the
  clearest configuration for inspection and analysis.
- `original-419806-weighted` contains the exact 1,992-example sequence used for
  training. It repeats a small set of targeted synthetic mitigation examples so
  those patterns have greater influence during the single training epoch.

Use the weighted configuration to reproduce training. Its additional 88
entries are repeated examples, not 88 new conversations. Use the unique
configuration when calculating corpus composition or reviewing distinct rows.

## Dataset structure

Each JSON Lines record is one synthetic conversation with these top-level
fields:

| Field | Description |
| --- | --- |
| `id` | Stable row identifier. |
| `datasetId` | Source dataset version. |
| `schema`, `schemaVersion` | Record-format identifiers. |
| `candidateId` | Synthetic candidate identifier used during curation. |
| `stage` | Curation stage recorded by the source pipeline. |
| `split` | Always `train` in this release. |
| `messages` | Ordered chat messages with `role` and `content` fields. |
| `metadata` | Language, scenario, risk, category, strategy, and review metadata. |
| `authoring` | How and when the synthetic row was produced and attested. |

The observed role sequences are:

- `system` → `user` → `assistant` for 1,376 single-turn rows; and
- `system` → `user` → `assistant` → `user` → `assistant` for 528
  multi-turn rows.

The `metadata` object contains `appState`, `conversationForm`,
`generatorVersion`, `language`, `longResponseReason`, `primaryCategory`,
`prohibitedDataScreen`, `responseSkeletonId`, `responseStrategy`,
`reviewLedgerRefs`, `reviewStatus`, `reviewableContentSha256`, `riskLevel`,
`scenarioFamilyId`, `secondaryTags`, `semanticClusterId`, `sourceKind`,
`sourcePolicyRefs`, `systemPromptSha256`, and `userGoalCode`.

The `authoring` object contains `authorIdentityRef`, `authoringPromptSha256`,
`configurationSha256`, `createdAt`, `method`, `scenarioFamilyId`, `status`,
`syntheticOnlyAttested`, `termsAssessmentRef`, `toolId`, and `toolRevision`.
Hashes and identifiers support audit and deduplication. They do not replace a
review of the released row content or its associated policies.

### System-message disclosure warning

Every row contains a system-role message. The contents are intentionally not
reproduced in this card, but they are part of the public JSONL files. SafeRide
completed its prompt, policy, privacy, security, and intellectual-property
disclosure review for this release on August 13, 2026. Reusers remain
responsible for assessing the messages and resulting behavior for their own
context.

## Composition statistics

All counts below describe the 1,904 unique rows, not the weighted training
sequence.

### Language and conversation form

| Dimension | Count |
| --- | ---: |
| English | 952 |
| Kiswahili | 952 |
| Single-turn conversations | 1,376 |
| Multi-turn conversations | 528 |

### Synthetic risk labels

These are authoring labels used to shape dataset coverage. They are not
assessments of a real person or incident.

| Label | Count |
| --- | ---: |
| Critical | 302 |
| High | 450 |
| Medium | 424 |
| Low | 424 |
| Not assigned | 304 |

### High-level categories

| Category | Count |
| --- | ---: |
| Coercion | 160 |
| Emergency guidance | 160 |
| Fabricated-information avoidance | 160 |
| Jailbreak and instruction extraction | 160 |
| Legal boundaries | 160 |
| Medical boundaries | 160 |
| No-new-facts behavior | 160 |
| Privacy | 160 |
| Product-truth boundaries | 160 |
| Tone and agency | 160 |
| Not assigned | 304 |

## Creation and curation

The corpus combines several synthetic-only source lineages. Of the unique rows,
1,600 are repository-authored synthetic conversations, 120 are
repository-pipeline-authored synthetic conversations, 112 are deterministic
synthetic mitigation rows, and 72 are deterministic human-authored synthetic
mitigation rows.

Source files were accepted only after deterministic schema, role, split,
identity, length, lineage, and checksum checks. Duplicate identifiers were
rejected, and the final unique file was byte-bound before the weighted training
sequence was produced. Review controls differed by source lineage; this card
does not claim that every row received an independent human language or domain
review.

Development prompts, evaluation holdouts, and post-training continuation data
are excluded. No held-out material was used for optimizer updates.

## Personal and sensitive information

The dataset was designed and attested as synthetic-only. It intentionally
excludes real survivor records, evidence, exact locations, credentials, private
communications, and production telemetry. Synthetic-only status reduces but
does not eliminate disclosure and misuse risk. The project completed its
privacy and content disclosure review for this public release on August 13,
2026; future versions require their own review.

## Biases and limitations

- Synthetic conversations do not demonstrate real-world usefulness, safety, or
  outcomes for survivors.
- Kiswahili coverage has not completed independent language review.
- The corpus cannot represent the full cultural, regional, disability,
  socioeconomic, legal, medical, or safeguarding diversity of real situations.
- Sheng is not included or supported by this release.
- The dataset has only a training split and is not itself an evaluation
  benchmark.
- Repeated mitigation examples intentionally alter training frequency and can
  increase both desired behavior and unwanted over-refusal.
- Results depend on the base model, chat template, system policy, decoding
  settings, and downstream safeguards; the dataset alone cannot establish a
  safe application.

## Versioning and maintenance

The training files are frozen at immutable Hugging Face revision
`ab43518babcf6255fddf7ae0087f7ce78a84a707`. Documentation-only commits are
recorded separately and do not change that artifact revision. Any row-level
change requires a new dataset version, new hashes, and new model evaluation.

The repository is public. Public visibility does not change the immutable data
revision, license, limitations, or need for language, privacy, security, and
provenance review.

### Historical freeze metadata

The immutable training revision was originally frozen while the repository was
private. Its hash-bound `MANIFEST.json` and `docs/GOVERNANCE.md` therefore retain
historical private-only wording. Those files remain unchanged for auditability.
`PUBLIC_RELEASE.md` records the later approval that supersedes only that access
status; it does not rewrite the frozen data, hashes, lineage, or limitations.

## License, citation, maintainers, and contact

The frozen dataset is licensed by **Esheria Ventures Limited** under the
[Creative Commons Attribution 4.0 International license](https://creativecommons.org/licenses/by/4.0/).
The license permits sharing and adaptation, including commercial reuse, when
users provide appropriate credit, link to the license, and indicate changes.
It does not grant rights to third-party material, trademarks, confidential
evaluation content, real survivor data, or any material explicitly excluded
from this release.

Suggested attribution:

> SafeRide Synthetic Bilingual Safety Guidance Dataset v0.5.8, Esheria
> Ventures Limited, CC BY 4.0, immutable revision
> `ab43518babcf6255fddf7ae0087f7ce78a84a707`.

The maintainer organization is Esheria Ventures Limited under the
`esherialabs` namespace. The public maintainer and security contact is Franklin
Sagini at [sagini@esheria.ai](mailto:sagini@esheria.ai).

Esheria Ventures Limited gratefully acknowledges financial support provided
for this Project by the UNICEF Innovation Fund. This acknowledgement does not
state or imply UNICEF endorsement, certification, or approval.

## Related artifacts

- [PEFT adapter](https://huggingface.co/esherialabs/saferide-gemma-4-e2b-v058-original-419806-adapter/tree/019dd8182883ad0721ffa70f4680d6977b7be99b)
- [LiteRT-LM mobile package](https://huggingface.co/esherialabs/saferide-gemma-4-e2b-v058-original-419806-litertlm/tree/e91ea27c3134fe21fc5bc995141675756e2c4a21)
- [SafeRide website](https://saferide.esheria.org/)
- [Android v0.5.8 testing preview and checksum](https://saferide.esheria.org/download/)
- [Sanitized public source mirror](https://github.com/esherialabs/saferider)

## Technical provenance and integrity

The main facts above are intended for general readers. The following bindings
support exact reproduction and audit.

| Evidence | Value |
| --- | --- |
| Dataset repository | `esherialabs/saferide-gemma-4-e2b-v058-original-419806-training-data` |
| Immutable artifact revision | `ab43518babcf6255fddf7ae0087f7ce78a84a707` |
| Unique JSONL SHA-256 | `669835b5f680b2198cf06d8c23a02d2e9aba2acba816c6283a0cdbbf8586a15e` |
| Weighted JSONL SHA-256 | `b6fd044f9e7854d358200288b195787fc9ed6e8eea52925eea9aa0d48783689e` |
| Manifest SHA-256 | `1cbb5931f418f3c63ad5c671ab7617f54ed679fc745ea96f7543511bdc638076` |
| Dataset license | `CC-BY-4.0` |
| Source evidence commit | `229ac0ab1eebefda6dc623b948503a087206dd35` |

The immutable [manifest](https://huggingface.co/datasets/esherialabs/saferide-gemma-4-e2b-v058-original-419806-training-data/blob/ab43518babcf6255fddf7ae0087f7ce78a84a707/MANIFEST.json)
records source lineage, exclusions, model links, and privacy assertions. The
[checksum ledger](https://huggingface.co/datasets/esherialabs/saferide-gemma-4-e2b-v058-original-419806-training-data/blob/ab43518babcf6255fddf7ae0087f7ce78a84a707/checksums/SHA256SUMS.txt)
binds every file in the frozen release. README/model-card revisions and hashes
are tracked separately from these immutable data bytes.
