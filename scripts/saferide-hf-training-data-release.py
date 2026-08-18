#!/usr/bin/env python
"""Build or upload the private SafeRide Hugging Face training-data repo."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import shutil
import sys
from collections import Counter
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA = REPO_ROOT / "data" / "ai" / "gemma4" / "saferide-synthetic-guidance-v0.3.jsonl"
DEFAULT_REGISTER = (
    REPO_ROOT / "docs" / "security" / "saferide-gemma4-colab-input-register.synthetic-v0.3.candidate.json"
)
DEFAULT_OUTPUT_DIR = REPO_ROOT / ".ai-smoke" / "hf-training-data-release"
DEFAULT_REPO_ID = "V-ince-18/saferide-gemma-4-e2b-training-data"
DEFAULT_DATASET_ID = "saferide-synthetic-guidance-v0.3"
DEFAULT_VERSION = "v0.3"
TRAIN_BASE_MODEL = "google/gemma-4-E2B-it"
TARGET_RUNTIME_MODEL = "litert-community/gemma-4-E2B-it-litert-lm / gemma-4-E2B-it.litertlm"
SPLIT_FILE_NAMES = {
    "train": "train.jsonl",
    "dev": "dev.jsonl",
    "quality-holdout": "quality_holdout.jsonl",
    "safety-holdout": "safety_holdout.jsonl",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Stage or upload the private SafeRide Hugging Face training-data repository."
    )
    parser.add_argument("--data", default=str(DEFAULT_DATA), help="Canonical JSONL training pack.")
    parser.add_argument("--register", default=str(DEFAULT_REGISTER), help="Approved input-register JSON file.")
    parser.add_argument("--repo-id", default=DEFAULT_REPO_ID, help="Target Hugging Face dataset repo id.")
    parser.add_argument("--revision", default="main", help="Target HF branch/revision.")
    parser.add_argument("--dataset-id", default=DEFAULT_DATASET_ID)
    parser.add_argument("--version", default=DEFAULT_VERSION)
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR))
    parser.add_argument("--private", action="store_true", help="Create repo as private if needed.")
    parser.add_argument("--execute", action="store_true", help="Upload to Hugging Face. Omitted means dry-run.")
    parser.add_argument(
        "--commit-message",
        default="Promote SafeRide v0.3 training dataset registry",
        help="HF commit message for --execute.",
    )
    return parser.parse_args()


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest().lower()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().lower()


def lf_sha256(path: Path) -> str:
    text = path.read_text(encoding="utf-8").replace("\r\n", "\n").replace("\r", "\n")
    return sha256_bytes(text.encode("utf-8"))


def load_rows(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            stripped = line.strip()
            if not stripped:
                continue
            try:
                row = json.loads(stripped)
            except json.JSONDecodeError as error:
                raise RuntimeError(f"Invalid JSONL at {path}:{line_number}: {error}") from error
            if not isinstance(row, dict):
                raise RuntimeError(f"Expected object row at {path}:{line_number}")
            rows.append(row)
    if not rows:
        raise RuntimeError(f"No rows found in {path}")
    return rows


def row_value(row: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = row.get(key)
        if isinstance(value, str) and value:
            return value
    return "unknown"


def nested_row_value(row: dict[str, Any], *paths: str) -> str:
    for path in paths:
        current: Any = row
        for part in path.split("."):
            if not isinstance(current, dict):
                current = None
                break
            current = current.get(part)
        if isinstance(current, str) and current:
            return current
    return "unknown"


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def write_text(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(value, encoding="utf-8", newline="\n")


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False, sort_keys=True))
            handle.write("\n")


def format_counts(counts: Counter[str]) -> str:
    return ", ".join(f"`{key}={counts[key]}`" for key in sorted(counts))


def build_readme(args: argparse.Namespace, manifest: dict[str, Any]) -> str:
    split_counts = manifest["splitCounts"]
    category_counts = manifest["categoryCounts"]
    language_counts = manifest["languageCounts"]
    data_sha = manifest["lfSha256"]["data"]
    register_sha = manifest["lfSha256"]["register"]

    return f"""---
pretty_name: SafeRide Gemma 4 E2B Synthetic Training Data
license: other
language:
  - en
  - sw
task_categories:
  - text-generation
tags:
  - saferide
  - gemma-4-e2b
  - synthetic-data
  - survivor-safety
  - private-evaluation
  - controlled-prototype
size_categories:
  - 10K<n<100K
configs:
  - config_name: {args.dataset_id}
    data_files:
      - split: train
        path: data/{args.version}/train.jsonl
      - split: validation
        path: data/{args.version}/dev.jsonl
      - split: quality_holdout
        path: data/{args.version}/quality_holdout.jsonl
      - split: safety_holdout
        path: data/{args.version}/safety_holdout.jsonl
---

# SafeRide Gemma 4 E2B Synthetic Training Data

## At A Glance

This is the private SafeRide training-data registry for controlled Gemma 4 E2B
LoRA prototype work. It is designed to behave like an institutional ML dataset
artifact: versioned files, explicit splits, register snapshot, checksums,
datasheet, governance notes, and a machine-readable manifest.

It is not a public dataset release and it is not permission to train on survivor
data.

| Field | Value |
| --- | --- |
| Dataset id | `{args.dataset_id}` |
| Registry status | `approved-prototype` |
| HF repo type | private dataset |
| Total rows | `{manifest["rowCount"]:,}` |
| Split counts | train `{split_counts["train"]:,}`, validation/dev `{split_counts["dev"]:,}`, quality holdout `{split_counts["quality-holdout"]:,}`, safety holdout `{split_counts["safety-holdout"]:,}` |
| Languages | English `{language_counts.get("en", 0):,}`, Kiswahili `{language_counts.get("sw", 0):,}` |
| Categories | {format_counts(Counter(category_counts))} |
| Trainable base model | `{TRAIN_BASE_MODEL}` |
| Target runtime model | `{TARGET_RUNTIME_MODEL}` |
| Dataset LF SHA-256 | `{data_sha}` |
| Register LF SHA-256 | `{register_sha}` |

## What Authorized Viewers Should See

The Hugging Face Dataset Viewer should expose four split-backed views from this
card metadata:

| Viewer split | File | Rows | Training use |
| --- | --- | ---: | --- |
| `train` | `data/{args.version}/train.jsonl` | {split_counts["train"]:,} | Training only |
| `validation` | `data/{args.version}/dev.jsonl` | {split_counts["dev"]:,} | Development checks only |
| `quality_holdout` | `data/{args.version}/quality_holdout.jsonl` | {split_counts["quality-holdout"]:,} | Never train on this split |
| `safety_holdout` | `data/{args.version}/safety_holdout.jsonl` | {split_counts["safety-holdout"]:,} | Never train on this split |

The full JSONL snapshot is kept for checksum parity with GitHub, but it is not
listed as a viewer split because it would duplicate the split rows.

## Repository Map

| Path | Purpose |
| --- | --- |
| `README.md` | Dataset card, viewer config, lineage, and operating rules. |
| `MANIFEST.json` | Machine-readable manifest with counts, hashes, source paths, and approval boundaries. |
| `checksums/SHA256SUMS.txt` | File checksum ledger for offline verification. |
| `data/{args.version}/train.jsonl` | Training split for the controlled LoRA pass. |
| `data/{args.version}/dev.jsonl` | Development split. |
| `data/{args.version}/quality_holdout.jsonl` | Quality/tone/no-new-facts holdout. |
| `data/{args.version}/safety_holdout.jsonl` | Safety-boundary holdout. |
| `data/{args.version}/{args.dataset_id}.full.jsonl` | Canonical full snapshot copied from GitHub. |
| `registers/saferide-gemma4-colab-input-register.synthetic-v0.3.candidate.json` | Approved-prototype data/register snapshot. |
| `docs/DATASHEET.md` | Detailed dataset datasheet for engineering and reviewer context. |
| `docs/SCHEMA.md` | Row schema and field semantics. |
| `docs/SPLITS.md` | Split-isolation policy and leakage controls. |
| `docs/GOVERNANCE.md` | Access, approval, privacy, and change-control rules. |
| `docs/RELEASE_CHECKLIST.md` | Required gates before training, evaluation, export, or claims. |

## Intended Use

Approved for one controlled prototype mitigation LoRA lane:

- train a private SafeRide PEFT/LoRA adapter against `{TRAIN_BASE_MODEL}`,
- address the blocked v0.2 findings through synthetic mitigation examples,
- preserve dataset, adapter, and evidence artifacts in private registries,
- support sanitized human review and safety-harness evaluation.

## Non-Claims

This dataset does not prove model safety, mobile readiness, pilot readiness,
UNICEF readiness, release readiness, public multilingual quality, production
suitability, or approval to train on survivor data.

## Privacy And Safety Boundary

The rows are synthetic. This repo must remain private for the current phase. Do
not add survivor reports, evidence contents, raw audio or transcripts, exact
private locations, production logs, credentials, signed URLs, HF tokens, or
private generation outputs.

## Known Limitations

- The dataset is still synthetic and partly template-driven.
- It is useful for controlled safety behavior, but it can teach repetitive
  boundaries if not balanced by natural helpful guidance.
- Kiswahili examples are prototype coverage and still need human language review
  before any public multilingual-quality claim.
- Passing a data gate is not the same as passing model behavior, mobile export,
  physical Android, privacy, or partner evidence gates.

## Downstream Evidence Requirement

Any adapter trained from this dataset must still pass pinned-artifact
verification, 120-prompt generation, sanitized human scoring, safety harness
thresholds, export/conversion proof, and physical Android proof before
downstream claims.
"""


def build_datasheet(args: argparse.Namespace, manifest: dict[str, Any]) -> str:
    split_counts = manifest["splitCounts"]
    language_counts = manifest["languageCounts"]
    category_counts = manifest["categoryCounts"]
    return f"""# Datasheet: SafeRide Gemma 4 E2B Synthetic {args.version}

## Motivation

The {args.version} pack exists to mitigate the blocked v0.2 adapter findings.
It targets product-state honesty, provider/resource grounding, jailbreak
handoff pressure, Kiswahili non-blame tone, privacy-safe diagnostics, concise
emergency guidance, no-new-facts discipline, and more natural helpful-safe
guidance.

The dataset is meant to make the next controlled LoRA pass measurable. It is
not a product claim.

## Composition

| Field | Value |
| --- | --- |
| Rows | `{manifest["rowCount"]:,}` |
| English rows | `{language_counts.get("en", 0):,}` |
| Kiswahili rows | `{language_counts.get("sw", 0):,}` |
| Train rows | `{split_counts["train"]:,}` |
| Dev rows | `{split_counts["dev"]:,}` |
| Quality holdout rows | `{split_counts["quality-holdout"]:,}` |
| Safety holdout rows | `{split_counts["safety-holdout"]:,}` |

Category balance:

{os.linesep.join(f"- `{key}`: {category_counts[key]:,}" for key in sorted(category_counts))}

## Collection And Generation Process

Rows were generated synthetically from SafeRide policy/product boundaries and
the v0.2 failure themes. No survivor reports, evidence files, raw audio,
transcripts, exact private locations, production logs, provider scrape dumps, or
credential material were used.

Generation is deterministic enough for auditability and varied enough to cover
the main mitigation categories, but it is still not a substitute for carefully
governed real-world pilot evidence.

## Data Fields

See `docs/SCHEMA.md` for field-level semantics. The important operational
fields are the prompt/input content, assistant target content, language,
category, split, and approval/register metadata.

## Recommended Uses

- Controlled prototype LoRA training on the train split.
- Development checks on the dev split.
- Safety and quality regression review on holdout splits.
- Comparison against blocked v0.2 failure categories.
- Private reviewer calibration using sanitized scoring outputs.

## Prohibited Uses

- Public dataset release without a separate approval record.
- Survivor-data training claims.
- Production, partner, UNICEF, or release-readiness claims.
- Training on dev, quality-holdout, or safety-holdout splits.
- Publishing raw rows, raw prompts, raw completions, or private evidence outside
  the approved private registry.

## Bias, Coverage, And Limitations

- The dataset is synthetic and cannot prove real-world survivor usefulness.
- Some templates intentionally repeat safety boundaries; after this pass, the
  next data iteration should add more natural multi-turn helpful guidance.
- Kiswahili rows are useful for prototype coverage but need human language
  review before public claims.
- Provider and product-state examples are controlled; they must not be treated
  as live provider catalog facts.

## Maintenance Plan

Every new dataset version should preserve this structure: immutable split files,
register snapshot, manifest, checksum ledger, datasheet, split policy, governance
file, and release checklist. Any data-source expansion must update the register
before training.
"""


def build_schema(args: argparse.Namespace) -> str:
    return f"""# Schema: {args.dataset_id}

This file documents the expected JSONL row shape for SafeRide Gemma 4 E2B
synthetic training packs. The exact source row can evolve by version, but every
training run must preserve enough metadata to audit source, split, language,
and category.

## Required Operational Fields

| Field | Meaning |
| --- | --- |
| `split` | One of `train`, `dev`, `quality-holdout`, or `safety-holdout`. |
| `metadata.language` | Language coverage marker such as `en` or `sw`. |
| `metadata.primaryCategory` | Main mitigation or safety behavior category. |
| `metadata.mitigationFocus` | More specific v0.3 mitigation theme. |
| `metadata.responseContract` | Expected response behavior contract. |
| `metadata.sourceEvalFinding` | v0.2 finding or source theme that motivated the row. |
| Prompt/input field | User-facing synthetic input. Field name can vary by generator version. |
| Completion/output field | Assistant target response. Field name can vary by generator version. |

## Data Handling Rules

- Do not print row text in CI, issue comments, or public artifacts.
- Do not train on holdout splits.
- Do not mix synthetic rows with real pilot rows without a new register version.
- Do not infer production facts from provider/product examples in this dataset.

## Compatibility

The Hugging Face Dataset Viewer is configured from `README.md` with explicit
`configs.data_files` entries. The full JSONL snapshot is retained only for
checksum parity and should not be used as a fifth training split.
"""


def build_splits_doc(args: argparse.Namespace, manifest: dict[str, Any]) -> str:
    split_counts = manifest["splitCounts"]
    return f"""# Splits: {args.dataset_id}

## Split Table

| Split | Rows | Training allowed | Purpose |
| --- | ---: | --- | --- |
| `train` | {split_counts["train"]:,} | yes | LoRA optimization only. |
| `dev` | {split_counts["dev"]:,} | no final scoring | Development checks, smoke generation, and early regression checks. |
| `quality-holdout` | {split_counts["quality-holdout"]:,} | no | Helpfulness, tone, product-state honesty, and no-new-facts review. |
| `safety-holdout` | {split_counts["safety-holdout"]:,} | no | Boundary, refusal, privacy, emergency, coercion, jailbreak, legal, and medical review. |

## Leakage Controls

- Only `train` may be used for optimizer updates.
- Dev and holdout rows must not be copied into training prompts.
- Reviewer scoring should use sanitized outputs and aggregate decisions, not
  public raw prompt/completion dumps.
- Any accidental holdout training invalidates the run and requires a new run id.

## Viewer Mapping

The Hub dataset card maps split files as:

| Viewer split | Source file |
| --- | --- |
| `train` | `data/{args.version}/train.jsonl` |
| `validation` | `data/{args.version}/dev.jsonl` |
| `quality_holdout` | `data/{args.version}/quality_holdout.jsonl` |
| `safety_holdout` | `data/{args.version}/safety_holdout.jsonl` |

The canonical full JSONL keeps the original split field for every row and is
used for checksum parity with GitHub.
"""


def build_governance(args: argparse.Namespace) -> str:
    return f"""# Dataset Governance

This private Hugging Face dataset repo is a controlled SafeRide ML artifact, not
a public dataset release.

## Approved Scope

- Synthetic-data prototype training.
- Private/internal evidence preservation.
- Controlled adapter evaluation.
- Downstream mobile-export planning after safety evidence.

## Excluded Scope

- Public sharing.
- Production use.
- Survivor-data training.
- Release readiness claims.
- Mobile readiness claims.
- UNICEF readiness claims.
- Public multilingual-quality claims.

## Access Control

- Keep the repo private during prototype work.
- Use named HF users or an approved Esheria Labs HF organization when org write
  access is available.
- Use short-lived or scoped HF tokens where possible.
- Never paste tokens into notebooks, README files, issue comments, screenshots,
  or generated evidence.

## Change Control

Every material dataset update needs:

1. a dataset id/version,
2. a register snapshot,
3. split counts,
4. checksum ledger,
5. approval status,
6. source GitHub commit or PR reference,
7. downstream model/eval issue reference.

## Data Boundary

Do not add survivor narratives, evidence contents, raw audio, transcripts, exact
private locations, production logs, credentials, signed URLs, provider scrape
dumps, or private evaluation outputs to this repo.

## Holdout Policy

Holdout splits must not be trained on. A run that trains on `dev`,
`quality-holdout`, or `safety-holdout` should be marked invalid and repeated
with a clean run id.

## Transfer Plan

This repo is staged under `V-ince-18` temporarily. When Esheria Labs HF
organization write access is available, transfer or mirror the same artifacts to
the approved organization repo without changing dataset hashes.
"""


def build_release_checklist(args: argparse.Namespace, manifest: dict[str, Any]) -> str:
    return f"""# Release Checklist

Use this checklist before treating `{args.dataset_id}` as input to a training or
evaluation run.

## Dataset Registry Gate

- [ ] HF dataset repo is private.
- [ ] `README.md` contains Dataset Viewer `configs` for all split files.
- [ ] `MANIFEST.json` row counts match local GitHub data.
- [ ] `checksums/SHA256SUMS.txt` matches uploaded files.
- [ ] Register snapshot is present under `registers/`.
- [ ] Dataset LF SHA-256 is `{manifest["lfSha256"]["data"]}`.
- [ ] Register LF SHA-256 is `{manifest["lfSha256"]["register"]}`.

## Training Gate

- [ ] Strict data/register gate passed immediately before training.
- [ ] Training uses only `data/{args.version}/train.jsonl`.
- [ ] Dev and holdout splits are not included in optimizer updates.
- [ ] Base model is `{TRAIN_BASE_MODEL}` at the pinned revision in the notebook.
- [ ] Run id, package versions, LoRA hyperparameters, and GPU facts are recorded.

## Adapter Registry Gate

- [ ] Adapter uploaded to a private HF model branch/revision.
- [ ] Adapter commit SHA and file hashes are recorded.
- [ ] Model card links back to this dataset repo and exact dataset commit.
- [ ] Pinned adapter commit is verified before generation.

## Evaluation Gate

- [ ] 120-prompt generation runs against the pinned adapter commit.
- [ ] Private generation bundle is preserved in the private evidence repo.
- [ ] Reviewers fill sanitized scores only.
- [ ] Safety harness passes with no critical failures.
- [ ] Any failure themes are recorded for the next data iteration.

## Downstream Gate

- [ ] Export/conversion path is proven.
- [ ] Physical Android devices produce acceptable offline behavior evidence.
- [ ] No mobile, pilot, UNICEF, production, or release claim is made before the
  separate evidence gates pass.
"""


def checksum_ledger(files: list[Path], root: Path) -> str:
    lines = []
    for path in sorted(files, key=lambda value: value.relative_to(root).as_posix()):
        lines.append(f"{sha256_file(path)}  {path.relative_to(root).as_posix()}")
    return "\n".join(lines) + "\n"


def import_hub_client():
    try:
        from huggingface_hub import HfApi
    except ModuleNotFoundError as error:
        raise RuntimeError(
            "Missing huggingface_hub. Install it with `python -m pip install huggingface_hub`."
        ) from error
    return HfApi


def execute_upload(args: argparse.Namespace, artifact_dir: Path) -> str:
    HfApi = import_hub_client()
    api = HfApi()
    api.create_repo(repo_id=args.repo_id, repo_type="dataset", private=args.private, exist_ok=True)
    commit = api.upload_folder(
        repo_id=args.repo_id,
        repo_type="dataset",
        folder_path=str(artifact_dir),
        revision=args.revision,
        commit_message=args.commit_message,
    )
    return str(commit)


def main() -> int:
    args = parse_args()
    data_path = Path(args.data).expanduser().resolve()
    register_path = Path(args.register).expanduser().resolve()
    if not data_path.is_file():
        raise RuntimeError(f"Data file not found: {data_path}")
    if not register_path.is_file():
        raise RuntimeError(f"Register file not found: {register_path}")

    rows = load_rows(data_path)
    split_rows: dict[str, list[dict[str, Any]]] = {split: [] for split in SPLIT_FILE_NAMES}
    language_counts: Counter[str] = Counter()
    category_counts: Counter[str] = Counter()

    for row in rows:
        split = row_value(row, "split")
        if split not in split_rows:
            raise RuntimeError(f"Unexpected split value: {split}")
        split_rows[split].append(row)
        language_counts[nested_row_value(row, "language", "locale", "metadata.language")] += 1
        category_counts[
            nested_row_value(row, "category", "safetyCategory", "theme", "metadata.primaryCategory")
        ] += 1

    output_dir = Path(args.output_dir).expanduser().resolve()
    artifact_dir = output_dir / args.dataset_id
    if artifact_dir.exists():
        shutil.rmtree(artifact_dir)
    artifact_dir.mkdir(parents=True)

    data_dir = artifact_dir / "data" / args.version
    for split, file_name in SPLIT_FILE_NAMES.items():
        write_jsonl(data_dir / file_name, split_rows[split])
    shutil.copyfile(data_path, data_dir / f"{args.dataset_id}.full.jsonl")

    register_target = artifact_dir / "registers" / register_path.name
    register_target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(register_path, register_target)

    manifest: dict[str, Any] = {
        "schema": "com.saferide.hf-training-data-manifest",
        "createdAtUtc": dt.datetime.now(dt.timezone.utc).isoformat(),
        "datasetId": args.dataset_id,
        "datasetRepo": args.repo_id,
        "status": "approved-prototype",
        "privacyClass": "synthetic-private-prototype",
        "rowCount": len(rows),
        "splitCounts": {split: len(split_rows[split]) for split in SPLIT_FILE_NAMES},
        "languageCounts": dict(sorted(language_counts.items())),
        "categoryCounts": dict(sorted(category_counts.items())),
        "trainBaseModel": TRAIN_BASE_MODEL,
        "targetRuntimeModel": TARGET_RUNTIME_MODEL,
        "lfSha256": {
            "data": lf_sha256(data_path),
            "register": lf_sha256(register_path),
        },
        "sourceGitHubFiles": {
            "data": data_path.relative_to(REPO_ROOT).as_posix(),
            "register": register_path.relative_to(REPO_ROOT).as_posix(),
        },
        "notApprovedFor": [
            "public sharing",
            "production use",
            "survivor-data training",
            "release claims",
            "UNICEF readiness claims",
            "mobile readiness claims",
            "public multilingual claims",
        ],
    }

    write_json(artifact_dir / "MANIFEST.json", manifest)
    write_text(artifact_dir / "README.md", build_readme(args, manifest))
    write_text(artifact_dir / "docs" / "DATASHEET.md", build_datasheet(args, manifest))
    write_text(artifact_dir / "docs" / "SCHEMA.md", build_schema(args))
    write_text(artifact_dir / "docs" / "SPLITS.md", build_splits_doc(args, manifest))
    write_text(artifact_dir / "docs" / "GOVERNANCE.md", build_governance(args))
    write_text(artifact_dir / "docs" / "RELEASE_CHECKLIST.md", build_release_checklist(args, manifest))

    files_for_checksums = [path for path in artifact_dir.rglob("*") if path.is_file() and "checksums" not in path.parts]
    write_text(artifact_dir / "checksums" / "SHA256SUMS.txt", checksum_ledger(files_for_checksums, artifact_dir))

    plan: dict[str, Any] = {
        "createdAtUtc": dt.datetime.now(dt.timezone.utc).isoformat(),
        "mode": "execute" if args.execute else "dry-run",
        "repoId": args.repo_id,
        "repoType": "dataset",
        "revision": args.revision,
        "private": bool(args.private),
        "artifactDir": str(artifact_dir),
        "fileCount": len([path for path in artifact_dir.rglob("*") if path.is_file()]),
        "manifest": manifest,
        "tokenConfigured": bool(os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_HUB_TOKEN")),
    }

    if args.execute:
        plan["uploadResult"] = execute_upload(args, artifact_dir)

    write_json(output_dir / f"{args.dataset_id}.release-plan.json", plan)

    print("SafeRide Hugging Face training-data release helper")
    print(f"Mode: {plan['mode']}")
    print(f"Repo: {args.repo_id}")
    print(f"Rows: {len(rows)}")
    print(f"Artifact dir: {artifact_dir}")
    print(f"Release plan: {output_dir / f'{args.dataset_id}.release-plan.json'}")
    if not args.execute:
        print("Dry run only. Re-run with --execute after human review and HF access confirmation.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001 - CLI should report concise failure.
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
