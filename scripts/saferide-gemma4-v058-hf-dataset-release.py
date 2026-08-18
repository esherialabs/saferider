#!/usr/bin/env python3
"""Recover, package, and optionally upload the exact SafeRide v0.5.8 train set.

The release is accepted only when the recovered training JSONL bytes match the
hashes bound to the selected original seed-419806 adapter. Raw rows are never
printed. Development, holdout, v0.5.5, and post-training continuation rows are
excluded.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import importlib.util
import json
import os
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
from collections import Counter
from pathlib import Path, PurePosixPath
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
CANONICAL_DATASET_CARD_PATH = (
    REPO_ROOT / "docs/qa/saferide-gemma4-v058-dataset-card-2026-08-11.md"
)
SOURCE_COMMIT = "229ac0ab1eebefda6dc623b948503a087206dd35"
DATASET_ID = "saferide-synthetic-guidance-v0.5.8"
DEFAULT_REPO_ID = "esherialabs/saferide-gemma-4-e2b-v058-original-419806-training-data"

EXPECTED_UNIQUE_ROWS = 1_904
EXPECTED_WEIGHTED_EXAMPLES = 1_992
EXPECTED_UNIQUE_SHA256 = "669835b5f680b2198cf06d8c23a02d2e9aba2acba816c6283a0cdbbf8586a15e"
EXPECTED_WEIGHTED_SHA256 = "b6fd044f9e7854d358200288b195787fc9ed6e8eea52925eea9aa0d48783689e"
HISTORICAL_FREEZE_MANIFEST_SHA256 = "0ad58d367f1ef1b6e46d57a741aef75f573734d024f9e4dc9318bbda281df272"
HISTORICAL_A11_ARCHIVE_SHA256 = "913b08085604139cf8af13bfab86694e571e869404af96b3e79eb23755d8ecc3"
HISTORICAL_A11_ARCHIVE_SIZE = 1_439_683
SYSTEM_PROMPT_SHA256 = "8c7b9e8939e86f947dd5f90b0128d1188657b021d62367f0decbeab0e161647f"

ADAPTER_REPO = "esherialabs/saferide-gemma-4-e2b-v058-original-419806-adapter"
ADAPTER_REVISION = "019dd8182883ad0721ffa70f4680d6977b7be99b"
MOBILE_REPO = "esherialabs/saferide-gemma-4-e2b-v058-original-419806-litertlm"
MOBILE_REVISION = "e91ea27c3134fe21fc5bc995141675756e2c4a21"

ARCHIVE_SPECS: tuple[dict[str, Any], ...] = (
    {
        "name": "v0.5.0",
        "argument": "v05_archive",
        "archiveSha256": "cdcd19871b13f0fa1cf09a835a9b48ca97c386e00e1c77984828a1be0b42e98e",
        "datasetId": "saferide-synthetic-guidance-v0.5.0",
        "rows": 1_600,
        "trainingSha256": "dd8b09648f4af001202787309ad8aefc5f23d67d028b6d5c655cd7b0fbec1f6f",
        "weight": 1,
        "sourceObject": "saferide/v05/sagemaker/inputs/saferide-v05-sagemaker-input-37ddc7503309/handoff/saferide-v05-sagemaker-input-37ddc7503309.tar.gz",
        "fullTrain": True,
    },
    {
        "name": "v0.5.1",
        "argument": "v051_archive",
        "archiveSha256": "a85530c2dd3977d27a5b6e7613e3742c3593aa42ae4b70175c7b079ed42a6de0",
        "datasetId": "saferide-synthetic-guidance-v0.5.1",
        "rows": 120,
        "trainingSha256": "f74f2be4fc9a19975334c3d1e0a754720a36e0ae0b4381cda716c891cf7f5521",
        "weight": 1,
        "sourceObject": "saferide/v051/sagemaker/inputs/saferide-v051-sagemaker-input-b499a74cb4e8/handoff/saferide-v051-sagemaker-input-b499a74cb4e8.tar.gz",
        "fullTrain": False,
    },
    {
        "name": "v0.5.2",
        "argument": "v052_archive",
        "archiveSha256": "d400bc0214831b7dc31ba5b7d549ffc082e3572d343e11ad1daa5481a3b33575",
        "datasetId": "saferide-synthetic-guidance-v0.5.2",
        "rows": 48,
        "trainingSha256": "5e182744b39096324051e902bbbee0976d25e7aed1bfde0a7e9e69f0df28445a",
        "weight": 1,
        "sourceObject": "saferide/v052/sagemaker/inputs/saferide-v052-sagemaker-input-3bbacbe8c74c/handoff/saferide-v052-sagemaker-input-3bbacbe8c74c.tar.gz",
        "fullTrain": False,
    },
    {
        "name": "v0.5.3",
        "argument": "v053_archive",
        "archiveSha256": "2b8c762b35d813e4180497c8aee1fe7ca7c95cf0b493d4727f034c60a580a259",
        "datasetId": "saferide-synthetic-guidance-v0.5.3",
        "rows": 64,
        "trainingSha256": "5a7bbcd7fa214c0e3c16ada53035e004fa56eceef137e4dafd1ff2317d6e4dd2",
        "weight": 1,
        "sourceObject": "saferide/v053/sagemaker/inputs/saferide-v053-sagemaker-input-6527d563b3fb/handoff/saferide-v053-sagemaker-input-6527d563b3fb.tar.gz",
        "fullTrain": False,
    },
)

GENERATED_SPECS: tuple[dict[str, Any], ...] = (
    {
        "name": "v0.5.4",
        "module": "scripts/saferide-gemma4-v054-dataset.py",
        "datasetId": "saferide-synthetic-guidance-v0.5.4",
        "rows": 32,
        "trainingSha256": "3eb607e8e4fd7ab6ca5954fb676c12f98b3721f6b689ac3a0e152a69c9cd73d0",
        "weight": 2,
    },
    {
        "name": "v0.5.6",
        "module": "scripts/saferide-gemma4-v056-dataset.py",
        "datasetId": "saferide-synthetic-guidance-v0.5.6",
        "rows": 24,
        "trainingSha256": "54f311799a13e4d6d894a8e43447710b84cd8fff0461645760243b1b155b3b54",
        "weight": 2,
    },
    {
        "name": "v0.5.7",
        "module": "scripts/saferide-gemma4-v057-dataset.py",
        "datasetId": "saferide-synthetic-guidance-v0.5.7",
        "rows": 16,
        "trainingSha256": "9dd1b91a5cb14c06cb52e1418dfd71f0da3aeb86108d0266d1265194a307b3c5",
        "weight": 3,
    },
)

SOURCE_TREE_FILES = (
    "config/ai/safe-assistant-system-prompt.v0.5.1.candidate.json",
    "config/ai/datasets/saferide-gemma4-v054-mitigation-plan.json",
    "config/ai/datasets/saferide-gemma4-v056-mitigation-plan.json",
    "config/ai/datasets/saferide-gemma4-v057-mitigation-plan.json",
    "docs/qa/saferide-gemma4-v054-post-pilot-diagnosis-2026-08-08.json",
    "docs/qa/saferide-gemma4-v056-panel-diagnosis-2026-08-09.json",
    "docs/qa/saferide-gemma4-v057-private-adjudication-2026-08-09.json",
    "scripts/saferide-gemma4-v051-dataset.py",
    "scripts/saferide-gemma4-v051-semantic.py",
    "scripts/saferide-gemma4-v052-dataset.py",
    "scripts/saferide-gemma4-v053-dataset.py",
    "scripts/saferide-gemma4-v054-dataset.py",
    "scripts/saferide-gemma4-v054-remediation.py",
    "scripts/saferide-gemma4-v056-dataset.py",
    "scripts/saferide-gemma4-v056-remediation.py",
    "scripts/saferide-gemma4-v057-dataset.py",
    "scripts/saferide-gemma4-v057-remediation.py",
)

RELEASE_FILES = {
    "MANIFEST.json",
    "README.md",
    "RECOVERY_RECEIPT.json",
    "checksums/SHA256SUMS.txt",
    "data/combined-unique-train.jsonl",
    "data/weighted-train.jsonl",
    "docs/DATASHEET.md",
    "docs/GOVERNANCE.md",
    "docs/LIMITATIONS.md",
    "docs/LINEAGE.md",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Recover and release the exact private v0.5.8 original-419806 training dataset."
    )
    parser.add_argument("--source-tree", required=True, help=f"Tree exported from Git commit {SOURCE_COMMIT}.")
    parser.add_argument("--v05-archive", required=True)
    parser.add_argument("--v051-archive", required=True)
    parser.add_argument("--v052-archive", required=True)
    parser.add_argument("--v053-archive", required=True)
    parser.add_argument("--output-dir", required=True, help="Private output directory outside the repository.")
    parser.add_argument("--repo-id", default=DEFAULT_REPO_ID)
    parser.add_argument("--revision", default="main")
    parser.add_argument(
        "--resume-revision",
        help="Verify and link an already-uploaded immutable revision without uploading again.",
    )
    parser.add_argument("--execute", action="store_true", help="Upload and download-verify the private HF repo.")
    parser.add_argument(
        "--link-model-cards",
        action="store_true",
        help="After upload verification, add the exact dataset revision to both private model cards.",
    )
    parser.add_argument("--replace-output", action="store_true", help="Replace only the generated artifact directory.")
    parser.add_argument(
        "--commit-message",
        default="Publish exact SafeRide v0.5.8 original-419806 training dataset",
    )
    return parser.parse_args()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def private_file(path: Path, label: str) -> None:
    require(path.is_file(), f"Missing {label}: {path}")
    require(stat.S_IMODE(path.stat().st_mode) & 0o077 == 0, f"{label} permissions are too broad: {path}")


def private_directory(path: Path, label: str) -> None:
    require(path.is_dir(), f"Missing {label}: {path}")
    require(stat.S_IMODE(path.stat().st_mode) & 0o077 == 0, f"{label} permissions are too broad: {path}")


def jsonl_bytes(rows: list[dict[str, Any]], *, ensure_ascii: bool) -> bytes:
    return b"".join(
        (
            json.dumps(
                row,
                ensure_ascii=ensure_ascii,
                sort_keys=True,
                separators=(",", ":"),
                allow_nan=False,
            )
            + "\n"
        ).encode("utf-8")
        for row in rows
    )


def source_jsonl_bytes(rows: list[dict[str, Any]]) -> bytes:
    return jsonl_bytes(rows, ensure_ascii=False)


def final_jsonl_bytes(rows: list[dict[str, Any]]) -> bytes:
    # The immutable v0.5.8 freeze used json.dumps()'s default ensure_ascii=True.
    return jsonl_bytes(rows, ensure_ascii=True)


def load_rows(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            stripped = line.strip()
            if not stripped:
                continue
            value = json.loads(stripped)
            require(isinstance(value, dict), f"Invalid JSONL object at line {line_number}.")
            rows.append(value)
    require(rows, f"No rows found in {path.name}.")
    return rows


def verify_source_tree(source_tree: Path) -> None:
    private_directory(source_tree, "immutable source tree")
    resolved = subprocess.run(
        ["git", "rev-parse", SOURCE_COMMIT],
        cwd=REPO_ROOT,
        capture_output=True,
        check=True,
    ).stdout.decode("utf-8").strip()
    require(resolved == SOURCE_COMMIT, "Immutable source commit is unavailable.")
    for relative in SOURCE_TREE_FILES:
        candidate = source_tree / relative
        private_file(candidate, f"source-tree file {relative}")
        committed = subprocess.run(
            ["git", "show", f"{SOURCE_COMMIT}:{relative}"],
            cwd=REPO_ROOT,
            capture_output=True,
            check=True,
        ).stdout
        require(candidate.read_bytes() == committed, f"Source-tree file differs from {SOURCE_COMMIT}: {relative}")


def safe_extract_train(archive_path: Path, expected_sha256: str, destination: Path) -> Path:
    private_file(archive_path, "controlled source archive")
    require(sha256_file(archive_path) == expected_sha256, f"Source archive hash differs: {archive_path.name}")
    destination.mkdir(mode=0o700)
    with tarfile.open(archive_path, mode="r:gz") as archive:
        members = archive.getmembers()
        for member in members:
            pure = PurePosixPath(member.name)
            require(not pure.is_absolute() and ".." not in pure.parts, "Unsafe source archive path.")
            require(not member.issym() and not member.islnk(), "Source archive links are forbidden.")
        archive.extractall(
            destination,
            members=members,
            filter="fully_trusted",
        )  # noqa: S202 - members are validated above.
    for candidate in destination.rglob("*"):
        candidate.chmod(0o700 if candidate.is_dir() else 0o600)
    matches = list(destination.glob("*/artifacts/dataset/controlled/train.jsonl"))
    require(len(matches) == 1, f"Expected one controlled train.jsonl in {archive_path.name}.")
    return matches[0]


def archive_source_rows(args: argparse.Namespace, work_dir: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    unique_rows: list[dict[str, Any]] = []
    lineage: list[dict[str, Any]] = []
    for spec in ARCHIVE_SPECS:
        archive_path = Path(getattr(args, spec["argument"])).expanduser().resolve()
        train_path = safe_extract_train(archive_path, spec["archiveSha256"], work_dir / spec["name"])
        all_rows = load_rows(train_path)
        if spec["fullTrain"]:
            rows = all_rows
            require(sha256_file(train_path) == spec["trainingSha256"], "v0.5.0 training bytes differ.")
        else:
            rows = [row for row in all_rows if row.get("datasetId") == spec["datasetId"]]
        encoded = source_jsonl_bytes(rows)
        require(len(rows) == spec["rows"], f"{spec['name']} row count differs.")
        if not spec["fullTrain"]:
            require(sha256_bytes(encoded) == spec["trainingSha256"], f"{spec['name']} training bytes differ.")
        unique_rows.extend(rows)
        lineage.append(
            {
                "version": spec["name"],
                "datasetId": spec["datasetId"],
                "rows": len(rows),
                "weight": spec["weight"],
                "trainingSha256": spec["trainingSha256"],
                "sourceArchiveSha256": spec["archiveSha256"],
                "sourceObject": spec["sourceObject"],
            }
        )
    return unique_rows, lineage


def import_source_module(path: Path, name: str) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    require(spec is not None and spec.loader is not None, f"Unable to import {path.name}.")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def generated_source_rows(source_tree: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    prompt_document = json.loads(
        (source_tree / "config/ai/safe-assistant-system-prompt.v0.5.1.candidate.json").read_text(encoding="utf-8")
    )
    prompt = prompt_document.get("text")
    require(isinstance(prompt, str) and sha256_bytes(prompt.encode("utf-8")) == SYSTEM_PROMPT_SHA256, "System prompt bytes differ.")
    require(prompt_document.get("textSha256") == SYSTEM_PROMPT_SHA256, "System prompt declaration differs.")

    unique_rows: list[dict[str, Any]] = []
    lineage: list[dict[str, Any]] = []
    for index, spec in enumerate(GENERATED_SPECS):
        module = import_source_module(source_tree / spec["module"], f"saferide_v058_hf_source_{index}")
        rows = module.build_rows(prompt, SYSTEM_PROMPT_SHA256)
        require(isinstance(rows, list) and all(isinstance(row, dict) for row in rows), f"{spec['name']} generator returned invalid rows.")
        encoded = source_jsonl_bytes(rows)
        require(len(rows) == spec["rows"], f"{spec['name']} generated row count differs.")
        require(sha256_bytes(encoded) == spec["trainingSha256"], f"{spec['name']} generated training bytes differ.")
        require(all(row.get("datasetId") == spec["datasetId"] for row in rows), f"{spec['name']} dataset id differs.")
        unique_rows.extend(rows)
        lineage.append(
            {
                "version": spec["name"],
                "datasetId": spec["datasetId"],
                "rows": len(rows),
                "weight": spec["weight"],
                "trainingSha256": spec["trainingSha256"],
                "recoveredFromGitCommit": SOURCE_COMMIT,
                "generatorPath": spec["module"],
            }
        )
    return unique_rows, lineage


def validate_composition(unique_rows: list[dict[str, Any]], weighted_rows: list[dict[str, Any]]) -> None:
    require(len(unique_rows) == EXPECTED_UNIQUE_ROWS, "Recovered unique row count differs.")
    require(len(weighted_rows) == EXPECTED_WEIGHTED_EXAMPLES, "Recovered weighted example count differs.")
    require(all(row.get("split") == "train" for row in unique_rows + weighted_rows), "Non-training row entered the release.")
    require(len({str(row.get("id")) for row in unique_rows}) == EXPECTED_UNIQUE_ROWS, "Recovered unique ids differ.")
    require(sha256_bytes(final_jsonl_bytes(unique_rows)) == EXPECTED_UNIQUE_SHA256, "Recovered unique JSONL hash differs.")
    require(sha256_bytes(final_jsonl_bytes(weighted_rows)) == EXPECTED_WEIGHTED_SHA256, "Recovered weighted JSONL hash differs.")


def write_private(path: Path, value: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.write_bytes(value)
    path.chmod(0o600)


def write_private_text(path: Path, value: str) -> None:
    write_private(path, value.encode("utf-8"))


def write_private_json(path: Path, value: Any) -> None:
    write_private_text(path, json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True, allow_nan=False) + "\n")


def source_counts(rows: list[dict[str, Any]]) -> dict[str, int]:
    counts = Counter(str(row.get("datasetId")) for row in rows)
    return dict(sorted(counts.items()))


def language_counts(rows: list[dict[str, Any]]) -> dict[str, int]:
    counts = Counter(str(row.get("metadata", {}).get("language", "unknown")) for row in rows)
    return dict(sorted(counts.items()))


def build_readme(args: argparse.Namespace, _manifest: dict[str, Any]) -> str:
    """Return the reviewed, source-controlled dataset card.

    The card is authoritative documentation. The release generator may replace
    only the repository identifier when an explicitly different private target
    is supplied; dataset facts and governance wording are not regenerated from
    mutable runtime state.
    """

    require(CANONICAL_DATASET_CARD_PATH.is_file(), "Canonical dataset card is missing.")
    card = CANONICAL_DATASET_CARD_PATH.read_text(encoding="utf-8")
    if args.repo_id != DEFAULT_REPO_ID:
        card = card.replace(DEFAULT_REPO_ID, args.repo_id)
    return card


def build_docs(manifest: dict[str, Any]) -> dict[str, str]:
    return {
        "docs/DATASHEET.md": f"""# Datasheet

`{DATASET_ID}` is a synthetic, bilingual SafeRide training-only corpus. It
contains {EXPECTED_UNIQUE_ROWS} unique rows and {EXPECTED_WEIGHTED_EXAMPLES}
weighted examples. English/Kiswahili counts are recorded in `MANIFEST.json`.

No real survivor reports, evidence, production payloads, development rows, or
holdout rows are included. The corpus was assembled from approved v0.5.0,
v0.5.1, v0.5.2, v0.5.3, v0.5.4, v0.5.6, and v0.5.7 synthetic lineages.
""",
        "docs/LINEAGE.md": f"""# Lineage

The exact v0.5.0-v0.5.3 source bytes were recovered from immutable S3 training
archives and verified against historical hashes. The v0.5.4, v0.5.6, and
v0.5.7 rows were regenerated from the immutable human-authored deterministic
generators at Git commit `{SOURCE_COMMIT}` and accepted only because their
historical JSONL hashes matched exactly.

The final combined files match `{EXPECTED_UNIQUE_SHA256}` and
`{EXPECTED_WEIGHTED_SHA256}`. The destroyed A11 archive was not approximated or
silently replaced.
""",
        "docs/GOVERNANCE.md": """# Governance

- Keep this Hugging Face dataset repository private.
- Train only from the weighted training file when reproducing the selected run.
- Do not add development or holdout suites.
- Do not add survivor or production data.
- Any changed row requires a new dataset version, hashes, model run, and review.
- Public release requires separate privacy, legal, safety, and partner approval.
""",
        "docs/LIMITATIONS.md": """# Known Limitations

- The corpus is synthetic and does not establish real-world survivor usefulness.
- Kiswahili coverage remains subject to independent language review.
- Exact dataset recovery proves byte identity, not model safety or release readiness.
- Physical Android and independent approval gates remain outstanding.
""",
    }


def file_inventory(root: Path, *, exclude_checksums: bool = False) -> list[dict[str, Any]]:
    files: list[dict[str, Any]] = []
    for candidate in sorted(root.rglob("*")):
        if not candidate.is_file():
            continue
        relative = candidate.relative_to(root).as_posix()
        if exclude_checksums and relative == "checksums/SHA256SUMS.txt":
            continue
        files.append({"path": relative, "sizeBytes": candidate.stat().st_size, "sha256": sha256_file(candidate)})
    return files


def checksum_ledger(inventory: list[dict[str, Any]]) -> str:
    return "".join(f"{item['sha256']}  {item['path']}\n" for item in inventory)


def prepare_artifact(
    args: argparse.Namespace,
    unique_rows: list[dict[str, Any]],
    weighted_rows: list[dict[str, Any]],
    lineage: list[dict[str, Any]],
) -> tuple[Path, dict[str, Any]]:
    output_dir = Path(args.output_dir).expanduser().resolve()
    require(REPO_ROOT != output_dir and REPO_ROOT not in output_dir.parents, "Controlled output must remain outside the repository.")
    output_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    output_dir.chmod(0o700)
    artifact_dir = output_dir / DATASET_ID
    if artifact_dir.exists():
        require(args.replace_output, "Artifact directory exists; pass --replace-output for this controlled path.")
        shutil.rmtree(artifact_dir)
    artifact_dir.mkdir(mode=0o700)

    unique_bytes = final_jsonl_bytes(unique_rows)
    weighted_bytes = final_jsonl_bytes(weighted_rows)
    write_private(artifact_dir / "data/combined-unique-train.jsonl", unique_bytes)
    write_private(artifact_dir / "data/weighted-train.jsonl", weighted_bytes)

    created_at = dt.datetime.now(dt.timezone.utc).isoformat()
    receipt = {
        "schema": "com.saferide.ai.v058-hf-dataset-recovery-receipt",
        "schemaVersion": 1,
        "createdAt": created_at,
        "status": "exact-hashes-matched",
        "issue": "ESH-4198",
        "sourceCommit": SOURCE_COMMIT,
        "sourceLineage": lineage,
        "result": {
            "uniqueRows": len(unique_rows),
            "weightedExamples": len(weighted_rows),
            "uniqueSha256": sha256_bytes(unique_bytes),
            "weightedSha256": sha256_bytes(weighted_bytes),
        },
        "privacy": {
            "syntheticOnly": True,
            "rawRowsIncludedInReceipt": False,
            "developmentRowsIncluded": False,
            "holdoutRowsIncluded": False,
            "continuationRowsIncluded": False,
        },
    }
    manifest = {
        "schema": "com.saferide.ai.v058-hf-training-dataset-manifest",
        "schemaVersion": 1,
        "createdAt": created_at,
        "status": "approved-final-training-input-private",
        "issue": "ESH-4198",
        "datasetId": DATASET_ID,
        "datasetRepo": args.repo_id,
        "privateOnly": True,
        "counts": {
            "uniqueRows": len(unique_rows),
            "weightedExamples": len(weighted_rows),
            "sourceDatasets": source_counts(unique_rows),
            "languages": language_counts(unique_rows),
        },
        "hashes": {
            "combinedUniqueTrainSha256": sha256_bytes(unique_bytes),
            "weightedTrainSha256": sha256_bytes(weighted_bytes),
            "historicalFrozenManifestSha256": HISTORICAL_FREEZE_MANIFEST_SHA256,
            "historicalA11TrainingArchiveSha256": HISTORICAL_A11_ARCHIVE_SHA256,
            "historicalA11TrainingArchiveSizeBytes": HISTORICAL_A11_ARCHIVE_SIZE,
        },
        "selectedModel": {
            "adapterRepo": ADAPTER_REPO,
            "adapterArtifactRevision": ADAPTER_REVISION,
            "mobileRepo": MOBILE_REPO,
            "mobileArtifactRevision": MOBILE_REVISION,
            "selectedLineage": "original-v0.5.8-seed-419806",
            "optimizerSteps": 249,
            "rowsSeen": EXPECTED_WEIGHTED_EXAMPLES,
        },
        "exclusions": {
            "v0.5.5": "superseded-by-v0.5.6-from-v0.5.4",
            "originalDevelopmentRows": 300,
            "mitigationDevelopmentRows": 20,
            "baseHoldoutRows": 700,
            "sealedMitigationHoldoutIncluded": False,
            "quarantinedKiswahiliContinuationRows": 32,
        },
        "recovery": {
            "method": "exact-immutable-archives-plus-immutable-deterministic-generators",
            "sourceCommit": SOURCE_COMMIT,
            "historicalA11ArchiveRecreated": True,
            "acceptedOnlyAfterHistoricalDataHashesMatched": True,
        },
        "privacy": {
            "syntheticOnly": True,
            "realSurvivorDataUsed": False,
            "developmentRowsIncluded": False,
            "holdoutRowsIncluded": False,
            "rawRowsIncludedInManifest": False,
        },
    }

    write_private_json(artifact_dir / "RECOVERY_RECEIPT.json", receipt)
    write_private_json(artifact_dir / "MANIFEST.json", manifest)
    write_private_text(artifact_dir / "README.md", build_readme(args, manifest))
    for relative, content in build_docs(manifest).items():
        write_private_text(artifact_dir / relative, content)
    inventory = file_inventory(artifact_dir, exclude_checksums=True)
    write_private_text(artifact_dir / "checksums/SHA256SUMS.txt", checksum_ledger(inventory))
    return artifact_dir, manifest


def reuse_artifact(
    args: argparse.Namespace,
    unique_rows: list[dict[str, Any]],
    weighted_rows: list[dict[str, Any]],
) -> tuple[Path, dict[str, Any]]:
    artifact_dir = Path(args.output_dir).expanduser().resolve() / DATASET_ID
    private_directory(artifact_dir, "existing release artifact")
    inventory = file_inventory(artifact_dir)
    require({item["path"] for item in inventory} == RELEASE_FILES, "Existing release artifact file set differs.")
    for item in inventory:
        private_file(artifact_dir / item["path"], f"existing release file {item['path']}")

    unique_path = artifact_dir / "data/combined-unique-train.jsonl"
    weighted_path = artifact_dir / "data/weighted-train.jsonl"
    require(unique_path.read_bytes() == final_jsonl_bytes(unique_rows), "Existing unique training bytes differ.")
    require(weighted_path.read_bytes() == final_jsonl_bytes(weighted_rows), "Existing weighted training bytes differ.")

    manifest = json.loads((artifact_dir / "MANIFEST.json").read_text(encoding="utf-8"))
    receipt = json.loads((artifact_dir / "RECOVERY_RECEIPT.json").read_text(encoding="utf-8"))
    require(manifest.get("datasetRepo") == args.repo_id, "Existing manifest dataset repo differs.")
    require(manifest.get("counts", {}).get("uniqueRows") == EXPECTED_UNIQUE_ROWS, "Existing manifest row count differs.")
    require(
        manifest.get("counts", {}).get("weightedExamples") == EXPECTED_WEIGHTED_EXAMPLES,
        "Existing manifest weighted count differs.",
    )
    require(
        manifest.get("hashes", {}).get("combinedUniqueTrainSha256") == EXPECTED_UNIQUE_SHA256,
        "Existing manifest unique hash differs.",
    )
    require(
        manifest.get("hashes", {}).get("weightedTrainSha256") == EXPECTED_WEIGHTED_SHA256,
        "Existing manifest weighted hash differs.",
    )
    require(receipt.get("sourceCommit") == SOURCE_COMMIT, "Existing recovery receipt source commit differs.")
    require(
        receipt.get("result", {}).get("uniqueSha256") == EXPECTED_UNIQUE_SHA256
        and receipt.get("result", {}).get("weightedSha256") == EXPECTED_WEIGHTED_SHA256,
        "Existing recovery receipt hashes differ.",
    )
    expected_ledger = checksum_ledger(file_inventory(artifact_dir, exclude_checksums=True))
    require(
        (artifact_dir / "checksums/SHA256SUMS.txt").read_text(encoding="utf-8") == expected_ledger,
        "Existing checksum ledger differs.",
    )
    return artifact_dir, manifest


def import_hub() -> tuple[Any, Any, Any]:
    try:
        from huggingface_hub import HfApi, hf_hub_download, snapshot_download
    except ModuleNotFoundError as error:
        raise RuntimeError("Missing huggingface_hub; install it before --execute.") from error
    return HfApi, hf_hub_download, snapshot_download


def execute_upload(args: argparse.Namespace, artifact_dir: Path, output_dir: Path) -> dict[str, Any]:
    HfApi, _, snapshot_download = import_hub()
    api = HfApi()
    try:
        api.whoami()
    except Exception as error:  # noqa: BLE001 - auth backends vary by hub client version.
        raise RuntimeError("Hugging Face authentication is required through a fresh scoped HF_TOKEN.") from error
    if args.resume_revision:
        require(
            len(args.resume_revision) == 40 and set(args.resume_revision) <= set("0123456789abcdef"),
            "--resume-revision must be a 40-character lowercase commit SHA.",
        )
        info = api.dataset_info(args.repo_id, revision=args.resume_revision)
        revision = getattr(info, "sha", None)
        require(revision == args.resume_revision, "Hugging Face resume revision could not be resolved exactly.")
    else:
        api.create_repo(repo_id=args.repo_id, repo_type="dataset", private=True, exist_ok=True)
        info = api.dataset_info(args.repo_id)
    require(bool(getattr(info, "private", False)), "Target Hugging Face dataset repository is not private.")
    if not args.resume_revision:
        commit = api.upload_folder(
            repo_id=args.repo_id,
            repo_type="dataset",
            folder_path=str(artifact_dir),
            revision=args.revision,
            commit_message=args.commit_message,
        )
        revision = getattr(commit, "oid", None)
        require(isinstance(revision, str) and len(revision) == 40, "Hugging Face upload did not return an immutable revision.")

    local_inventory = {item["path"]: (item["sha256"], item["sizeBytes"]) for item in file_inventory(artifact_dir)}
    verify_parent = "/tmp" if os.name != "nt" and Path("/tmp").is_dir() else None
    with tempfile.TemporaryDirectory(prefix="sr-hf-verify-", dir=verify_parent) as temporary:
        verify_dir = Path(temporary)
        verify_dir.chmod(0o700)
        snapshot_download(
            repo_id=args.repo_id,
            repo_type="dataset",
            revision=revision,
            local_dir=str(verify_dir),
        )
        remote_inventory = {
            item["path"]: (item["sha256"], item["sizeBytes"])
            for item in file_inventory(verify_dir)
            if not item["path"].startswith(".cache/") and item["path"] != ".gitattributes"
        }
        require(remote_inventory == local_inventory, "Downloaded Hugging Face dataset bytes differ from the release package.")
    return {
        "repoId": args.repo_id,
        "revision": revision,
        "private": True,
        "resumedExistingRevision": bool(args.resume_revision),
        "verifiedFileCount": len(local_inventory),
        "repoUrl": f"https://huggingface.co/datasets/{args.repo_id}/tree/{revision}",
    }


def insert_dataset_metadata(front_matter: str, dataset_repo: str) -> str:
    lines = front_matter.splitlines()
    require(lines and lines[0] == "---", "Model card front matter is missing.")
    closing = next((index for index, line in enumerate(lines[1:], start=1) if line == "---"), None)
    require(closing is not None, "Model card front matter is incomplete.")
    metadata_lines = lines[1:closing]
    datasets_index = next((index for index, line in enumerate(metadata_lines) if line.strip() == "datasets:"), None)
    if datasets_index is None:
        metadata_lines.extend(["datasets:", f"  - {dataset_repo}"])
    else:
        block_end = datasets_index + 1
        while block_end < len(metadata_lines) and (
            metadata_lines[block_end].startswith(" ") or not metadata_lines[block_end].strip()
        ):
            block_end += 1
        block = metadata_lines[datasets_index:block_end]
        if not any(line.strip() == f"- {dataset_repo}" for line in block):
            metadata_lines.insert(block_end, f"  - {dataset_repo}")
    return "\n".join(["---", *metadata_lines, "---", *lines[closing + 1 :]]) + "\n"


def dataset_linked_model_card(content: str, dataset_repo: str, dataset_revision: str) -> str:
    start = "<!-- saferide-training-dataset:start -->"
    end = "<!-- saferide-training-dataset:end -->"
    if start in content or end in content:
        require(start in content and end in content and content.index(start) < content.index(end), "Existing dataset marker block is invalid.")
        before = content[: content.index(start)].rstrip()
        after = content[content.index(end) + len(end) :].lstrip()
        content = before + ("\n\n" + after if after else "")
    linked = insert_dataset_metadata(content, dataset_repo).rstrip()
    section = f"""

{start}
## Training dataset

This model is linked to the private SafeRide training dataset
[`{dataset_repo}`](https://huggingface.co/datasets/{dataset_repo}/tree/{dataset_revision})
at immutable revision `{dataset_revision}`.

The linked release contains the exact original v0.5.8 seed-419806 training
bytes: `{EXPECTED_UNIQUE_SHA256}` for 1,904 unique rows and
`{EXPECTED_WEIGHTED_SHA256}` for 1,992 weighted examples. Development,
holdout, v0.5.5, and quarantined continuation rows are excluded.
{end}
"""
    return linked + section


def link_model_cards(dataset_repo: str, dataset_revision: str, output_dir: Path) -> dict[str, Any]:
    HfApi, hf_hub_download, _ = import_hub()
    api = HfApi()
    try:
        api.whoami()
    except Exception as error:  # noqa: BLE001 - auth backends vary by hub client version.
        raise RuntimeError("A fresh scoped HF_TOKEN is required before model-card linkage.") from error

    targets = (
        (ADAPTER_REPO, ADAPTER_REVISION),
        (MOBILE_REPO, MOBILE_REVISION),
    )
    for repo_id, expected_revision in targets:
        info = api.model_info(repo_id)
        require(bool(getattr(info, "private", False)), f"Model repository is not private: {repo_id}")
        require(getattr(info, "sha", None) == expected_revision, f"Model repository advanced unexpectedly: {repo_id}")

    linked_dir = output_dir / "linked-model-cards"
    linked_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    results: dict[str, Any] = {}
    for repo_id, expected_revision in targets:
        readme = Path(
            hf_hub_download(
                repo_id=repo_id,
                repo_type="model",
                revision=expected_revision,
                filename="README.md",
            )
        )
        content = dataset_linked_model_card(readme.read_text(encoding="utf-8"), dataset_repo, dataset_revision)
        local_card = linked_dir / f"{repo_id.replace('/', '__')}.README.md"
        write_private_text(local_card, content)
        commit = api.upload_file(
            repo_id=repo_id,
            repo_type="model",
            path_or_fileobj=content.encode("utf-8"),
            path_in_repo="README.md",
            commit_message=f"Link exact SafeRide training dataset {dataset_revision[:12]}",
        )
        revision = getattr(commit, "oid", None)
        require(isinstance(revision, str) and len(revision) == 40, f"Model-card upload returned no revision: {repo_id}")
        verified = Path(
            hf_hub_download(
                repo_id=repo_id,
                repo_type="model",
                revision=revision,
                filename="README.md",
                force_download=True,
            )
        ).read_text(encoding="utf-8")
        require(dataset_repo in verified and dataset_revision in verified, f"Model-card dataset link verification failed: {repo_id}")
        results[repo_id] = {
            "artifactRevision": expected_revision,
            "linkedModelCardRevision": revision,
            "readmeSha256": sha256_bytes(verified.encode("utf-8")),
        }
    return results


def main() -> int:
    args = parse_args()
    os.umask(0o077)
    require(not args.link_model_cards or args.execute, "--link-model-cards requires --execute.")
    require(not args.resume_revision or args.execute, "--resume-revision requires --execute.")
    require(
        not args.resume_revision or not args.replace_output,
        "--resume-revision reuses the existing artifact and cannot be combined with --replace-output.",
    )
    source_tree = Path(args.source_tree).expanduser().resolve()
    verify_source_tree(source_tree)
    output_dir = Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    output_dir.chmod(0o700)

    with tempfile.TemporaryDirectory(prefix="v058-hf-recovery-", dir=output_dir) as temporary:
        work_dir = Path(temporary)
        work_dir.chmod(0o700)
        archive_rows, archive_lineage = archive_source_rows(args, work_dir)
        generated_rows, generated_lineage = generated_source_rows(source_tree)

    unique_rows = archive_rows + generated_rows
    weighted_rows: list[dict[str, Any]] = []
    cursor = 0
    lineage = archive_lineage + generated_lineage
    for spec in (*ARCHIVE_SPECS, *GENERATED_SPECS):
        rows = unique_rows[cursor : cursor + spec["rows"]]
        cursor += spec["rows"]
        for _copy in range(spec["weight"]):
            weighted_rows.extend(rows)
    require(cursor == len(unique_rows), "Source composition cursor differs.")
    validate_composition(unique_rows, weighted_rows)

    if args.resume_revision:
        artifact_dir, manifest = reuse_artifact(args, unique_rows, weighted_rows)
    else:
        artifact_dir, manifest = prepare_artifact(args, unique_rows, weighted_rows, lineage)
    result: dict[str, Any] = {
        "mode": "execute" if args.execute else "dry-run",
        "artifactDir": str(artifact_dir),
        "repoId": args.repo_id,
        "manifest": manifest,
        "files": file_inventory(artifact_dir),
    }
    if args.execute:
        result["upload"] = execute_upload(args, artifact_dir, output_dir)
        if args.link_model_cards:
            result["modelCardLinks"] = link_model_cards(
                args.repo_id,
                result["upload"]["revision"],
                output_dir,
            )
    write_private_json(output_dir / "release-result.json", result)

    print("SafeRide v0.5.8 Hugging Face dataset release PASS")
    print(f"Mode: {result['mode']}")
    print(f"Unique rows: {EXPECTED_UNIQUE_ROWS}")
    print(f"Weighted examples: {EXPECTED_WEIGHTED_EXAMPLES}")
    print(f"Unique SHA-256: {EXPECTED_UNIQUE_SHA256}")
    print(f"Weighted SHA-256: {EXPECTED_WEIGHTED_SHA256}")
    print(f"Artifact directory: {artifact_dir}")
    if args.execute:
        print(f"Immutable HF revision: {result['upload']['revision']}")
    else:
        print("Dry run only; authenticate with a fresh scoped HF token before --execute.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001 - CLI should fail with one sanitized message.
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
