#!/usr/bin/env python
"""Dry-run-first Hugging Face release helper for SafeRide model artifacts."""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT_DIR = REPO_ROOT / ".ai-smoke" / "hf-release-plans"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Plan or execute a SafeRide Hugging Face model/adapters upload.")
    parser.add_argument("--artifact-dir", required=True, help="Directory containing adapter or exported artifact files.")
    parser.add_argument("--repo-id", required=True, help="Target Hugging Face repo id, for example org/model-name.")
    parser.add_argument("--repo-type", default="model", choices=["model", "dataset", "space"])
    parser.add_argument("--revision", default="main", help="Target branch/revision for upload.")
    parser.add_argument("--commit-message", default="SafeRide model artifact update")
    parser.add_argument("--private", action="store_true", help="Create the repo as private if it does not exist.")
    parser.add_argument("--create-pr", action="store_true", help="Upload as a Hub pull request.")
    parser.add_argument("--execute", action="store_true", help="Actually create/upload. Omitted means dry-run.")
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR), help="Where to write the release plan JSON.")
    return parser.parse_args()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().lower()


def collect_files(artifact_dir: Path) -> list[dict[str, object]]:
    files = []
    for path in sorted(artifact_dir.rglob("*")):
        if path.is_file():
            relative = path.relative_to(artifact_dir).as_posix()
            files.append(
                {
                    "path": relative,
                    "sizeBytes": path.stat().st_size,
                    "sha256": sha256_file(path),
                }
            )
    return files


def classify_artifact(files: list[dict[str, object]]) -> str:
    names = {str(entry["path"]) for entry in files}
    if "adapter_config.json" in names:
        return "peft-lora-adapter"
    if any(name.endswith(".litertlm") for name in names):
        return "litert-lm-export"
    if any(name.endswith(".safetensors") for name in names):
        return "model-weights"
    return "unknown"


def validate_release(files: list[dict[str, object]], artifact_kind: str) -> list[str]:
    warnings = []
    names = {str(entry["path"]) for entry in files}
    if not files:
        warnings.append("artifact directory is empty")
    if "README.md" not in names:
        warnings.append("README.md model card is missing")
    if artifact_kind == "unknown":
        warnings.append("artifact type is unknown; expected adapter_config.json, .safetensors, or .litertlm")
    if any(str(entry["path"]).lower().endswith((".env", ".pem", ".key", ".p12", ".jks")) for entry in files):
        warnings.append("artifact directory contains a secret-like file extension")
    return warnings


def import_hub_client():
    try:
        from huggingface_hub import HfApi
    except ModuleNotFoundError as error:
        raise RuntimeError(
            "Missing huggingface_hub. Install it with `py -3.12 -m pip install --user huggingface_hub` "
            "or run from a Python 3.12 venv."
        ) from error
    return HfApi


def write_plan(output_dir: Path, plan: dict[str, object]) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    safe_repo = str(plan["repoId"]).replace("/", "__")
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = output_dir / f"{safe_repo}-{stamp}.json"
    path.write_text(json.dumps(plan, indent=2, sort_keys=True), encoding="utf-8")
    return path


def execute_upload(args: argparse.Namespace) -> str:
    HfApi = import_hub_client()
    token_configured = bool(os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_HUB_TOKEN"))
    if not token_configured:
        raise RuntimeError("HF_TOKEN or HUGGINGFACE_HUB_TOKEN must be configured for --execute.")
    api = HfApi()
    api.create_repo(
        repo_id=args.repo_id,
        repo_type=args.repo_type,
        private=args.private,
        exist_ok=True,
    )
    if args.revision and args.revision != "main":
        try:
            api.create_branch(
                repo_id=args.repo_id,
                repo_type=args.repo_type,
                branch=args.revision,
                exist_ok=True,
            )
        except TypeError:
            try:
                api.create_branch(
                    repo_id=args.repo_id,
                    repo_type=args.repo_type,
                    branch=args.revision,
                )
            except Exception as error:  # noqa: BLE001 - older hub clients do not support exist_ok.
                if "already exists" not in str(error).lower():
                    raise
    commit = api.upload_folder(
        repo_id=args.repo_id,
        repo_type=args.repo_type,
        folder_path=args.artifact_dir,
        revision=args.revision,
        commit_message=args.commit_message,
        create_pr=args.create_pr,
    )
    return str(commit)


def main() -> int:
    args = parse_args()
    artifact_dir = Path(args.artifact_dir).expanduser().resolve()
    if not artifact_dir.is_dir():
        raise RuntimeError(f"Artifact directory not found: {artifact_dir}")

    files = collect_files(artifact_dir)
    artifact_kind = classify_artifact(files)
    warnings = validate_release(files, artifact_kind)
    plan: dict[str, object] = {
        "createdAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "issue": "ESH-4194",
        "mode": "execute" if args.execute else "dry-run",
        "repoId": args.repo_id,
        "repoType": args.repo_type,
        "revision": args.revision,
        "private": args.private,
        "createPr": args.create_pr,
        "artifactDir": str(artifact_dir),
        "artifactKind": artifact_kind,
        "fileCount": len(files),
        "files": files,
        "warnings": warnings,
        "tokenConfigured": bool(os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_HUB_TOKEN")),
        "privacy": {
            "rawPromptLogging": "forbidden",
            "rawCompletionLogging": "forbidden",
            "survivorDataIncluded": False,
            "requiresHumanReviewBeforePublicRelease": True,
        },
    }

    if args.execute:
        if warnings:
            raise RuntimeError(f"Release warnings must be fixed before --execute: {'; '.join(warnings)}")
        plan["uploadResult"] = execute_upload(args)

    plan_path = write_plan(Path(args.output_dir).expanduser().resolve(), plan)
    print("SafeRide Hugging Face release helper")
    print(f"Mode: {plan['mode']}")
    print(f"Repo: {args.repo_id}")
    print(f"Artifact kind: {artifact_kind}")
    print(f"Files: {len(files)}")
    if warnings:
        print("Warnings:")
        for warning in warnings:
            print(f"- {warning}")
    print(f"Release plan: {plan_path}")
    if not args.execute:
        print("Dry run only. Re-run with --execute after human review and HF token setup.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001 - CLI should report concise failure.
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
