# Model, dataset, and evaluation terms

Application-code terms do not automatically apply to models, adapters, model
weights, tokenizers, datasets, generated outputs, prompts, evaluation records,
or benchmark content. Each artifact class must name its own license, immutable
source, attribution, exclusions, and release status.

## Contract-aligned license selections

The following licenses are selected for the frozen SafeRide Gemma 4 E2B v0.5.8
artifacts:

| Artifact | License | Scope |
| --- | --- | --- |
| Synthetic bilingual training dataset | Creative Commons Attribution 4.0 International (`CC-BY-4.0`) | The frozen synthetic JSONL files and public dataset documentation authored by Esheria Ventures Limited. |
| SafeRide PEFT LoRA adapter | Apache License 2.0 (`Apache-2.0`) | SafeRide adapter modifications distributed with the pinned Gemma 4 base-model attribution and change notice. |
| Merged LiteRT-LM mobile artifact | Apache License 2.0 (`Apache-2.0`) | The merged, quantized, and packaged model artifact, subject to the pinned base-model license and preserved notices. |
| Model-card documentation | Creative Commons Attribution 4.0 International (`CC-BY-4.0`) | Public-safe explanatory documentation authored by Esheria Ventures Limited. |

The pinned base model is `google/gemma-4-E2B-it` at revision
`70af34e20bd4b7a91f0de6b22675850c43922a03`. Its immutable model card declares
`license: apache-2.0` and links to Google's Gemma 4 Apache License 2.0 page.
SafeRide therefore uses Apache 2.0 for both the adapter and the merged mobile
artifact rather than the license metadata used by older Gemma generations.

Esheria Ventures Limited is the primary licensor for its original Project IP
and SafeRide modifications. Upstream ownership and attribution remain with
their respective rights holders.

## Required distribution notices

An approved model-weight distribution must:

- include the complete Apache License 2.0 text;
- identify the pinned Google Gemma 4 base model and immutable revision;
- preserve applicable upstream copyright, patent, trademark, and attribution
  notices;
- state that SafeRide performed LoRA fine-tuning and, for the mobile artifact,
  merging, quantization, and LiteRT-LM packaging; and
- avoid implying endorsement by Google, Esheria Ventures Limited, SafeRide, or
  UNICEF.

An approved dataset distribution must identify Esheria Ventures Limited as the
licensor, link to CC BY 4.0, provide the immutable dataset revision, and require
reusers to indicate modifications. CC BY 4.0 and Apache 2.0 do not create
field-of-use restrictions; safety guidance belongs in the cards and responsible
use documentation rather than as conflicting license terms.

## Excluded and separately controlled material

These license selections do not grant rights to:

- real survivor reports, evidence, audio, transcripts, locations, credentials,
  private communications, consent records, or production telemetry;
- partner-owned provider-directory records or other third-party content;
- confidential evaluation prompts, raw completions, exploit details, private
  system-policy material, or withheld red-team corpora;
- third-party trademarks, names, logos, or branding; or
- artifacts not listed above or later versions that have not completed their
  own provenance and license review.

## Visibility and release status

License selection and public visibility are separate decisions. On August 13,
2026, the project owner approved public research distribution of the frozen
v0.5.8 dataset, adapter, and LiteRT-LM artifact. The three Hugging Face
repositories are public and ungated, with Franklin Sagini
(`sagini@esheria.ai`) as the public maintainer and security contact. Final
documentation, legal files, immutable artifact metadata, and anonymous access
were checksum-verified.

This scoped public distribution now supports the separately authorized SafeRide
v0.5.8 Android testing preview. One over-8 GB handset completed exact-artifact
download, pause/resume, verification, restart, synthetic chat, and signed APK
install/upgrade smoke. This does not authorize production deployment,
survivor-facing use, store submission, or UNICEF checkpoint submission; the
required lower-memory device matrix and broader application-release gates remain
fail-closed.

The controlling decision record is
`docs/security/saferide-v058-model-dataset-license-decision-2026-08-13.md`, and
the scoped publication approval is
`docs/security/saferide-v058-hf-public-release-approval-2026-08-13.md`.
