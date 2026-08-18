---
library_name: litert-lm
base_model: google/gemma-4-E2B-it
license: apache-2.0
language:
  - en
  - sw
datasets:
  - esherialabs/saferide-gemma-4-e2b-v058-original-419806-training-data
tags:
  - litert-lm
  - gemma-4-e2b
  - bilingual
  - offline-inference
  - safety-guidance
  - research-preview
---

# SafeRide Gemma 4 E2B LiteRT-LM Mobile Model v0.5.8

This research and development package combines the selected SafeRide
LoRA adapter with a pinned Gemma 4 E2B base model and exports the merged model
to LiteRT-LM for offline mobile inference. It is intended for controlled runtime
and integration research. One over-8 GB Android handset has completed exact-file
download, pause/resume, verification, restart, synthetic chat, and signed APK
install/upgrade smoke. It is not approved for survivor-facing, emergency,
medical, legal, or production deployment, and the required lower-memory Android
matrix remains incomplete. The repository is public for research and
development use under Apache License 2.0. Public availability does not establish
broad Android compatibility, production readiness, or external approval.

## Artifact facts

| Field | Value |
| --- | --- |
| File | `saferide-gemma4-e2b-v058-original-419806-runtime-compatible.litertlm` |
| Format | LiteRT-LM package (`.litertlm`) |
| Size | 5,071,837,136 bytes |
| Context window | 2,048 tokens |
| Maximum configured output | 128 tokens |
| Primary SHA-256 | `8b73fd844464f220955eeedc474c30f39e621458c7a6b092de5afa2c3d027fcd` |
| Access | Public research artifact |
| Status | Research/development preview; one-device Android observation complete, required matrix pending |

The Hugging Face card intentionally has no `pipeline_tag`. This package is for
the LiteRT-LM runtime and has not been configured or verified for Hugging Face
hosted inference.

## Relationship to the base model, adapter, and dataset

| Component | Immutable source |
| --- | --- |
| Base model | [`google/gemma-4-E2B-it`](https://huggingface.co/google/gemma-4-E2B-it/tree/70af34e20bd4b7a91f0de6b22675850c43922a03) at `70af34e20bd4b7a91f0de6b22675850c43922a03` |
| SafeRide adapter | [`esherialabs/saferide-gemma-4-e2b-v058-original-419806-adapter`](https://huggingface.co/esherialabs/saferide-gemma-4-e2b-v058-original-419806-adapter/tree/019dd8182883ad0721ffa70f4680d6977b7be99b) at `019dd8182883ad0721ffa70f4680d6977b7be99b` |
| Training dataset | [`esherialabs/saferide-gemma-4-e2b-v058-original-419806-training-data`](https://huggingface.co/datasets/esherialabs/saferide-gemma-4-e2b-v058-original-419806-training-data/tree/ab43518babcf6255fddf7ae0087f7ce78a84a707) at `ab43518babcf6255fddf7ae0087f7ce78a84a707` |

The adapter was trained on 1,904 unique synthetic English and Kiswahili
conversations, represented by 1,992 weighted training examples. Merging and
quantizing the adapter creates a new runtime artifact, so results from the PEFT
adapter do not by themselves prove the behavior of this package.

## Intended uses

Researchers and developers may use this artifact for:

- controlled LiteRT-LM integration and offline-inference research;
- exact-artifact load, generation, cancellation, restart, memory, latency,
  storage, and thermal testing;
- checksum, revocation, rollback, and interrupted-import exercises; and
- independent safety and language evaluation of the exported bytes.

## Out-of-scope and responsible-use boundaries

Apache 2.0 permits broad reuse and redistribution. The following statements
describe unvalidated and unsafe product uses; they are not additional license
restrictions. This model card does not establish fitness for:

- survivor-facing or production guidance;
- medical, legal, counselling, emergency, investigative, eligibility, or
  safeguarding decisions;
- autonomous action, surveillance, profiling, coercion, or risk scoring;
- presenting modified artifacts without preserving required license and
  attribution notices or identifying the changes;
- claims that it is broadly Android-compatible, release-ready, safe in the field, or
  endorsed by an external organization; or
- collection or logging of real survivor narratives, evidence, locations,
  credentials, or private model interactions.

## Platform and integration targets

The package is built for the LiteRT-LM runtime. The current SafeRide integration
plan records the following targets:

| Target | Current value |
| --- | ---: |
| Android API level | 26 or newer |
| Device RAM | 8 GB |
| Free storage for controlled import | 5,608,708,048 bytes |
| Runtime context | 2,048 tokens |
| Maximum output | 128 tokens |

These values are **integration targets, not verified minimum device
requirements**. The exact package ran on one handset reporting more than 8 GB
of memory. The required 2-3 GB, 4 GB, and 6-8 GB classes remain unverified, so
lower-memory support must not be inferred.

## LiteRT-LM loading example

The following local-file pattern reflects the API used in the completed server
runtime check. Verify the file hash and size before creating an engine. The
system instruction must come from a separately approved deployment policy and
is intentionally not included here.

```python
import hashlib
from pathlib import Path

from litert_lm import Backend, Engine, SamplerConfig, ThinkingConfig

model_path = Path(
    "saferide-gemma4-e2b-v058-original-419806-runtime-compatible.litertlm"
)
cache_dir = Path("./private-litertlm-cache")

assert model_path.stat().st_size == 5_071_837_136
digest = hashlib.sha256()
with model_path.open("rb") as model_file:
    for chunk in iter(lambda: model_file.read(8 * 1024 * 1024), b""):
        digest.update(chunk)
assert digest.hexdigest() == (
    "8b73fd844464f220955eeedc474c30f39"
    "e621458c7a6b092de5afa2c3d027fcd"
)

engine = Engine(
    str(model_path),
    backend=Backend.CPU(thread_count=4),
    max_num_tokens=2048,
    cache_dir=str(cache_dir),
)
conversation = engine.create_conversation(
    system_message="<approved system instruction supplied separately>",
    thinking_config=ThinkingConfig(
        enable_thinking=False,
        thinking_token_budget=0,
    ),
    sampler_config=SamplerConfig(
        top_k=1,
        top_p=1.0,
        temperature=0.0,
        seed=1,
    ),
    max_output_tokens=128,
)

try:
    response = conversation.send_message(
        "Give a short, general checklist for preparing emergency contacts.",
        max_output_tokens=128,
    )
finally:
    conversation.close()
    engine.close()
```

The API path was exercised with the exact artifact on a Linux server. The same
artifact bytes were subsequently downloaded, verified, restarted, and used for
synthetic chat inside the SafeRide Android QA app. The newly authored sample
message above is not from the released dataset or evaluation suite.

## Quantization and export format

The PEFT adapter was merged into the pinned Gemma base before export. The
`dynamic_wi8_afp32` recipe stores model weights using dynamic 8-bit integer
quantization while retaining 32-bit floating-point activations. Quantization
reduces the runtime representation but can change model quality and performance;
therefore the exported package must be evaluated separately from the
Transformers/PEFT model.

The `.litertlm` file bundles the model, tokenizer, chat-template metadata, and
runtime information needed by LiteRT-LM. It is not interchangeable with a
Transformers checkpoint or a PEFT adapter directory.

## Evaluation

### Server runtime validation

The exact final artifact was evaluated in a read-only Linux x86-64 container
with networking disabled. The recorded environment used a CPU backend with 30
threads, Python 3.12.11, LiteRT-LM 0.15.0, and AI Edge LiteRT nightly
2.2.0.dev20260809. The CPU model was not recorded, so timing results are not
portable and are intentionally omitted from this summary.

| Check | Observed result |
| --- | --- |
| File hash and size verification | Passed |
| Load and generate | Passed |
| Offline execution | Passed with container networking disabled |
| Clean restart | Passed |
| Deterministic replay | Two 48-token runs produced the same response hash |
| Cancellation | Passed after the first streamed chunk; no later chunks arrived |
| Raw prompt or response retention | Disabled in the summary evidence |

These results establish only that the package worked in the recorded server
environment. They do not establish Android behavior or real-world safety.

### Safety evaluation inherited from the selected lineage

The internal final holdout contained only **20 examples**. All 20 completed,
with zero recorded critical failures, truncations, or execution errors. Average
usefulness on the internal 0–3 scale was 2.35 overall, 2.50 for English, and
2.20 for Kiswahili. The scale treated 0 as a critical failure, 1 as risky, 2 as
acceptable with a minor issue, and 3 as a good safe answer.

This was a small internal evaluation, not an official external benchmark. It
has no completed independent product/safeguarding and technical/ML two-role
review, and it does not prove the behavior of untested devices or user groups.

### Published benchmark files

The following public-safe files are published in this repository beside the
exact `.litertlm` artifact:

- [standardized benchmark summary (JSON)](./benchmarks/saferide-v058-standardized-benchmark-summary-2026-08-13.json)
- [standardized benchmark summary (CSV)](./benchmarks/saferide-v058-standardized-benchmark-summary-2026-08-13.csv)
- [benchmark interpretation and artifact binding](./benchmarks/README.md)
- [external standard benchmark execution plan](./benchmarks/EXTERNAL_STANDARD_BENCHMARK_PLAN.md)

The CSV and JSON expose 23 recorded metrics from the development panel, final
internal holdout, and exact-artifact offline Linux runtime check. They remain
classified `internal-custom-not-external-standard`. The external plan proposes
TruthfulQA, English/Kiswahili Belebele, and IFEval for mentor approval and
reproducible execution. No external-standard or speech-to-text scores are
claimed yet.

### Physical Android validation

The exact 5,071,837,136-byte file and SHA-256 were exercised on a Xiaomi/POCO
`24117RK2CG` (`zorn`) running Android 16/API 36 on `arm64-v8a`. The handset
reported 11,367,156 kB total memory, so it is an over-8 GB observation rather
than proof for a required RAM-class row.

Observed outcomes:

- complete managed download into app-private storage;
- pause and resume, including resume after a Wi-Fi network change;
- exact byte-size and SHA-256 verification;
- app close and restart without an unnecessary second download;
- subsequent synthetic local-AI chat generation;
- signed APK clean install and same-certificate version-code 1 to 2 upgrade
  smoke on the same handset; and
- post-upgrade installed APK hash matched the published testing APK.

Still unverified across the required device matrix:

- 2-3 GB, 4 GB, and 6-8 GB handset support;
- cancellation, explicit unload, low-storage behavior, checksum-failure
  recovery, revocation, and rollback;
- portable memory, latency, battery, and thermal measurements; and
- production, survivor-facing, accessibility, and moderated-use behavior.

## Known limitations and safety boundaries

- The training data is synthetic and cannot establish real-world survivor
  usefulness or safety.
- Kiswahili has not completed independent language review, and Sheng is not
  supported.
- The 20-example final holdout is too small for broad safety, fairness, or
  language-quality conclusions.
- Quantization and runtime differences may introduce behavior not seen in PEFT
  evaluation.
- The model may fabricate facts, miss context, over-refuse, under-refuse, or
  produce culturally inappropriate or incomplete guidance.
- Public research distribution and its privacy, security, and licensing review
  are approved. Clinical, accessibility, fairness, safeguarding, required-matrix,
  production, and survivor-facing validation remain incomplete.
- Public Hugging Face download is enabled. SafeRide's managed download is
  enabled only in the dedicated Android testing profiles; generic prerelease
  and production profiles remain `fail-closed:no-local-ai`.

## License and access

The pinned `google/gemma-4-E2B-it` revision identifies **Apache License 2.0** as
its license. Esheria Ventures Limited applies the same Apache 2.0 license to the
SafeRide adapter modifications and merged LiteRT-LM artifact. Redistribution
must include a copy of the license, preserve applicable copyright and
attribution notices, and identify material changes, including the SafeRide
fine-tuning, merge, quantization, and LiteRT-LM packaging. Apache 2.0 does not
grant rights to Google, Esheria, SafeRide, or UNICEF trademarks.

The repository is public for research and development use. Public visibility
does not imply Android, production, survivor-facing, or external approval.

## SafeRide project links

- [SafeRide website](https://saferide.esheria.org/)
- [Android v0.5.8 testing preview and checksum](https://saferide.esheria.org/download/)
- [Sanitized public source mirror](https://github.com/esherialabs/saferider)
- [Canonical public release metadata](https://saferide.esheria.org/releases/saferide-v0.5.8-android.json)

## Citation, maintainers, and contact

Suggested attribution:

> SafeRide Gemma 4 E2B LiteRT-LM Mobile Model v0.5.8, Esheria Ventures
> Limited, Apache 2.0, immutable revision
> `e91ea27c3134fe21fc5bc995141675756e2c4a21`; based on
> `google/gemma-4-E2B-it` revision
> `70af34e20bd4b7a91f0de6b22675850c43922a03` by Google DeepMind.

The maintainer organization is Esheria Ventures Limited under the
`esherialabs` namespace. The public maintainer and security contact is Franklin
Sagini at [sagini@esheria.ai](mailto:sagini@esheria.ai).

Esheria Ventures Limited gratefully acknowledges financial support provided
for this Project by the UNICEF Innovation Fund. This acknowledgement does not
state or imply UNICEF endorsement, certification, or approval.

## Technical provenance and integrity

| Evidence | Value |
| --- | --- |
| Mobile repository | `esherialabs/saferide-gemma-4-e2b-v058-original-419806-litertlm` |
| Immutable artifact revision | `e91ea27c3134fe21fc5bc995141675756e2c4a21` |
| Prior documentation-only revision | `9901b122507e4f4f1f03fe414f8ed1778878e4b8` |
| Artifact license | `Apache-2.0` |
| Base-model license source | `google/gemma-4-E2B-it@70af34e20bd4b7a91f0de6b22675850c43922a03` |
| Artifact SHA-256 | `8b73fd844464f220955eeedc474c30f39e621458c7a6b092de5afa2c3d027fcd` |
| Adapter tensor SHA-256 | `1f8631d41dd3e16a62b1a95a7676c7585655ea97d100719ce0908902fb9e80aa` |
| Adapter freeze manifest SHA-256 | `d12b6d5d89c1facc1e2114e684d941aabf1d2dcc9f0cf7cbb9094dd44a4301cb` |
| Dataset manifest SHA-256 | `1cbb5931f418f3c63ad5c671ab7617f54ed679fc745ea96f7543511bdc638076` |
| Benchmark JSON SHA-256 | `50ca1bd8b58cff18eaeae85344a57011c5e0cf6d91b76b63ff51419f9128a7c2` |
| Benchmark CSV SHA-256 | `21bed0fc99d36c5aa4b758c10e56b1bc8a97c242c5c2f55c786639c4bc6f4065` |
| Export source revision | `ed258930cc86bd37f8120c2e4218eb67b57502e9` |
| Source evidence commit | `229ac0ab1eebefda6dc623b948503a087206dd35` |

The first package produced by the export workflow had SHA-256
`2b66de53cf08f96828de398980e886e9effe3564c3b04f99c6b5d3b47fb1672d`.
It is revoked because its embedded chat template was incompatible with the
validated LiteRT-LM parser. The final package replaced that metadata while
retaining the already-converted model and tokenizer payloads. Exact changed and
unchanged package sections, toolchain hashes, and the replacement template hash
remain in the source-controlled
[`export receipt`](https://github.com/esherialabs/saferider/blob/main/docs/qa/saferide-gemma4-e2b-v058-litertlm-export-receipt-2026-08-10.json).

Documentation-only revisions and README hashes are recorded separately from
the immutable artifact revision and `.litertlm` hash. Updating this card does
not change or re-upload the 5,071,837,136-byte model file.
