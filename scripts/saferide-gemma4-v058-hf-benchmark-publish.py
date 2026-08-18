#!/usr/bin/env python3
"""Publish SafeRide v0.5.8 benchmark summaries to the two public model repos.

Only README and benchmark documentation/result files are allowlisted. The
adapter weights, tokenizer/configuration files, and LiteRT-LM artifact are not
uploaded or modified. Every uploaded file is downloaded anonymously at the
returned immutable revision and compared byte-for-byte with its canonical
local source.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import stat
import tempfile
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
TOKEN_ENV = "SAFERIDE_HF_TOKEN"
RESULT_SCHEMA = "com.saferide.ai.v058-hf-benchmark-publication-result"

BENCHMARK_JSON = (
    "docs/unicef/checkpoint-2026-08/"
    "saferide-v058-standardized-benchmark-summary-2026-08-13.json"
)
BENCHMARK_CSV = (
    "docs/unicef/checkpoint-2026-08/"
    "saferide-v058-standardized-benchmark-summary-2026-08-13.csv"
)

REPOSITORIES: tuple[dict[str, Any], ...] = (
    {
        "key": "adapter",
        "repoId": "esherialabs/saferide-gemma-4-e2b-v058-original-419806-adapter",
        "expectedHead": "01db593570c77b65597e987b23ffe5a07397f57c",
        "artifactRevision": "019dd8182883ad0721ffa70f4680d6977b7be99b",
        "cardPath": "docs/qa/saferide-gemma4-e2b-v058-adapter-model-card-2026-08-11.md",
        "commitMessage": "Publish v0.5.8 benchmark summaries and execution plan",
    },
    {
        "key": "mobile",
        "repoId": "esherialabs/saferide-gemma-4-e2b-v058-original-419806-litertlm",
        "expectedHead": "9901b122507e4f4f1f03fe414f8ed1778878e4b8",
        "artifactRevision": "e91ea27c3134fe21fc5bc995141675756e2c4a21",
        "cardPath": "docs/qa/saferide-gemma4-e2b-v058-litertlm-model-card-2026-08-10.md",
        "commitMessage": "Publish v0.5.8 benchmark summaries and execution plan",
    },
)

SHARED_FILES: tuple[tuple[str, str], ...] = (
    (
        "benchmarks/saferide-v058-standardized-benchmark-summary-2026-08-13.json",
        BENCHMARK_JSON,
    ),
    (
        "benchmarks/saferide-v058-standardized-benchmark-summary-2026-08-13.csv",
        BENCHMARK_CSV,
    ),
    ("benchmarks/README.md", "docs/qa/hf-benchmark-files/README.md"),
    (
        "benchmarks/EXTERNAL_STANDARD_BENCHMARK_PLAN.md",
        "docs/qa/saferide-v058-external-standard-benchmark-plan-2026-08-13.md",
    ),
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate or publish the SafeRide v0.5.8 benchmark package."
    )
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--result", help="Private result JSON path outside the repository.")
    parser.add_argument(
        "--confirm-public-benchmark-publication-authorized",
        action="store_true",
        help="Confirms project-owner authorization to update both public model repositories.",
    )
    parser.add_argument(
        "--confirm-fresh-fine-grained-token",
        action="store_true",
        help="Attests that SAFERIDE_HF_TOKEN is fresh and least-privilege.",
    )
    parser.add_argument(
        "--allow-user-authorized-write-token",
        action="store_true",
        help="Explicitly permits a user-authorized broad write-token exception.",
    )
    return parser.parse_args()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def local_file(path_value: str) -> dict[str, Any]:
    path = (REPO_ROOT / path_value).resolve()
    require(path.is_file(), f"Missing publication input: {path_value}")
    require(REPO_ROOT in path.parents, f"Publication input escaped repository: {path_value}")
    value = path.read_bytes()
    require(value, f"Publication input is empty: {path_value}")
    return {
        "path": path,
        "bytes": value,
        "sha256": sha256_bytes(value),
        "sizeBytes": len(value),
    }


def local_packages() -> dict[str, dict[str, dict[str, Any]]]:
    shared = {remote: local_file(local) for remote, local in SHARED_FILES}
    require(
        shared[
            "benchmarks/saferide-v058-standardized-benchmark-summary-2026-08-13.json"
        ]["sha256"]
        == "50ca1bd8b58cff18eaeae85344a57011c5e0cf6d91b76b63ff51419f9128a7c2",
        "Benchmark JSON bytes changed unexpectedly.",
    )
    require(
        shared[
            "benchmarks/saferide-v058-standardized-benchmark-summary-2026-08-13.csv"
        ]["sha256"]
        == "21bed0fc99d36c5aa4b758c10e56b1bc8a97c242c5c2f55c786639c4bc6f4065",
        "Benchmark CSV bytes changed unexpectedly.",
    )
    benchmark = json.loads(
        shared[
            "benchmarks/saferide-v058-standardized-benchmark-summary-2026-08-13.json"
        ]["bytes"]
    )
    require(
        benchmark.get("benchmarkClassification") == "internal-custom-not-external-standard",
        "Internal benchmark classification must remain explicit.",
    )
    require(
        sum(len(suite.get("metrics", [])) for suite in benchmark.get("suites", [])) == 23,
        "Benchmark JSON must contain exactly 23 recorded metrics.",
    )

    packages: dict[str, dict[str, dict[str, Any]]] = {}
    required_card_markers = (
        "./benchmarks/saferide-v058-standardized-benchmark-summary-2026-08-13.json",
        "./benchmarks/saferide-v058-standardized-benchmark-summary-2026-08-13.csv",
        "internal-custom-not-external-standard",
        "EXTERNAL_STANDARD_BENCHMARK_PLAN.md",
    )
    for spec in REPOSITORIES:
        card = local_file(spec["cardPath"])
        for marker in required_card_markers:
            require(marker.encode("utf-8") in card["bytes"], f"Missing card marker: {marker}")
        packages[spec["key"]] = {"README.md": card, **shared}
    return packages


def import_hub() -> tuple[Any, Any, Any]:
    try:
        from huggingface_hub import CommitOperationAdd, HfApi, hf_hub_download
    except ImportError as error:  # pragma: no cover - operator environment
        raise RuntimeError("huggingface_hub is required for benchmark publication.") from error
    return HfApi, CommitOperationAdd, hf_hub_download


def token_role(identity: dict[str, Any]) -> str | None:
    auth = identity.get("auth")
    if not isinstance(auth, dict):
        return None
    access_token = auth.get("accessToken")
    if not isinstance(access_token, dict):
        return None
    role = access_token.get("role")
    return role if isinstance(role, str) else None


def artifact_inventory(info: Any, managed_paths: set[str]) -> list[dict[str, Any]]:
    inventory: list[dict[str, Any]] = []
    for sibling in sorted(info.siblings, key=lambda item: item.rfilename):
        if sibling.rfilename in managed_paths:
            continue
        lfs = sibling.lfs
        inventory.append(
            {
                "path": sibling.rfilename,
                "sizeBytes": sibling.size,
                "blobId": sibling.blob_id,
                "lfsSha256": None if lfs is None else lfs.sha256,
                "lfsSizeBytes": None if lfs is None else lfs.size,
            }
        )
    return inventory


def safe_result_path(value: str) -> Path:
    path = Path(value).expanduser().resolve()
    require(path != REPO_ROOT and REPO_ROOT not in path.parents, "Result must remain outside repository.")
    return path


def write_private_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    temporary.chmod(0o600)
    temporary.replace(path)
    path.chmod(0o600)
    require(stat.S_IMODE(path.stat().st_mode) & 0o077 == 0, "Result permissions are too broad.")


def publish(args: argparse.Namespace, token: str, result_path: Path) -> dict[str, Any]:
    require(
        args.confirm_public_benchmark_publication_authorized,
        "Explicit project-owner authorization is required.",
    )
    HfApi, CommitOperationAdd, hf_hub_download = import_hub()
    packages = local_packages()
    api = HfApi(token=token)
    identity = api.whoami(token=token)
    role = token_role(identity)
    write_exception = role == "write" and args.allow_user_authorized_write_token
    require(
        (role == "fineGrained" and args.confirm_fresh_fine_grained_token) or write_exception,
        "Use a confirmed fresh fine-grained token or the explicit user-authorized write-token exception.",
    )

    result: dict[str, Any] = {
        "schema": RESULT_SCHEMA,
        "schemaVersion": 1,
        "recordedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": "publishing",
        "credential": {
            "sourceEnvironmentVariable": TOKEN_ENV,
            "role": role,
            "leastPrivilegeSatisfied": role == "fineGrained",
            "userAuthorizedWriteTokenException": write_exception,
            "tokenValueRecorded": False,
            "persistedByCommand": False,
        },
        "repositories": {},
    }
    write_private_json(result_path, result)

    for spec in REPOSITORIES:
        package = packages[spec["key"]]
        managed_paths = set(package)
        before = api.model_info(
            spec["repoId"], files_metadata=True, token=token
        )
        require(before.private is False, f"Repository is not public: {spec['repoId']}")
        require(getattr(before, "gated", False) is False, f"Repository is gated: {spec['repoId']}")
        require(
            before.sha == spec["expectedHead"],
            f"Unexpected head for {spec['repoId']}: expected {spec['expectedHead']}, found {before.sha}",
        )
        before_inventory = artifact_inventory(before, managed_paths)

        operations = [
            CommitOperationAdd(path_in_repo=remote_path, path_or_fileobj=str(local["path"]))
            for remote_path, local in sorted(package.items())
        ]
        commit = api.create_commit(
            repo_id=spec["repoId"],
            repo_type="model",
            operations=operations,
            commit_message=spec["commitMessage"],
            parent_commit=spec["expectedHead"],
            token=token,
        )
        revision = commit.oid
        require(isinstance(revision, str) and len(revision) == 40, "Hugging Face returned no commit SHA.")

        after = api.model_info(
            spec["repoId"], revision=revision, files_metadata=True, token=token
        )
        require(after.private is False, f"Repository became private: {spec['repoId']}")
        require(getattr(after, "gated", False) is False, f"Repository became gated: {spec['repoId']}")
        require(
            artifact_inventory(after, managed_paths) == before_inventory,
            f"Artifact inventory changed for {spec['repoId']}",
        )

        verified: dict[str, dict[str, Any]] = {}
        with tempfile.TemporaryDirectory(prefix=f"saferide-{spec['key']}-benchmark-verify-") as temporary:
            for remote_path, local in sorted(package.items()):
                downloaded_path = Path(
                    hf_hub_download(
                        repo_id=spec["repoId"],
                        filename=remote_path,
                        repo_type="model",
                        revision=revision,
                        token=False,
                        local_dir=temporary,
                        force_download=True,
                    )
                )
                downloaded = downloaded_path.read_bytes()
                require(downloaded == local["bytes"], f"Anonymous byte mismatch: {remote_path}")
                verified[remote_path] = {
                    "sha256": local["sha256"],
                    "sizeBytes": local["sizeBytes"],
                    "anonymousBytesMatched": True,
                }

        result["repositories"][spec["key"]] = {
            "repoId": spec["repoId"],
            "artifactRevision": spec["artifactRevision"],
            "previousDocumentationRevision": spec["expectedHead"],
            "benchmarkDocumentationRevision": revision,
            "public": True,
            "gated": False,
            "artifactInventoryUnchanged": True,
            "files": verified,
        }
        write_private_json(result_path, result)

    result["status"] = "published-and-anonymously-byte-verified"
    result["completedAt"] = dt.datetime.now(dt.timezone.utc).isoformat()
    write_private_json(result_path, result)
    return result


def main() -> int:
    args = parse_args()
    packages = local_packages()
    if not args.execute:
        summary = {
            spec["key"]: {
                "repoId": spec["repoId"],
                "expectedHead": spec["expectedHead"],
                "files": {
                    path: {"sha256": data["sha256"], "sizeBytes": data["sizeBytes"]}
                    for path, data in sorted(packages[spec["key"]].items())
                },
            }
            for spec in REPOSITORIES
        }
        print(json.dumps(summary, indent=2, sort_keys=True))
        return 0

    require(args.result, "--result is required with --execute.")
    token = os.environ.pop(TOKEN_ENV, None)
    require(token, f"{TOKEN_ENV} is required and must be supplied only through the environment.")
    try:
        result = publish(args, token, safe_result_path(args.result))
    finally:
        token = None
        os.environ.pop(TOKEN_ENV, None)
    print(result["status"])
    for key, repository in result["repositories"].items():
        print(f"{key}_benchmark_documentation_revision {repository['benchmarkDocumentationRevision']}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(str(error), file=os.sys.stderr)
        raise SystemExit(1)
