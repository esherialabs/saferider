#!/usr/bin/env python3
"""Safely publish and publicly release the three SafeRide v0.5.8 Hub repos.

The command fails closed unless every repository is private, every remote head
matches the expected pre-publication revision, and the supplied credential is
fine-grained or an explicit user-authorized write-token exception is selected.
It uploads only allowlisted public documentation and legal files, verifies them
while the repositories remain private, changes all three repositories to public
and ungated, and then verifies anonymous access. Dataset JSONL, adapter weights,
tokenizer/configuration files, and the LiteRT-LM artifact remain unchanged.

The token is accepted only through SAFERIDE_HF_TOKEN and is removed from this
process environment immediately. The command never logs or persists it.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import stat
import tempfile
import time
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
TOKEN_ENV = "SAFERIDE_HF_TOKEN"
RESULT_SCHEMA = "com.saferide.ai.v058-hf-public-release-result"
PUBLIC_CONTACT = "sagini@esheria.ai"

REPOSITORIES: tuple[dict[str, Any], ...] = (
    {
        "key": "dataset",
        "repoId": "esherialabs/saferide-gemma-4-e2b-v058-original-419806-training-data",
        "repoType": "dataset",
        "cardType": "dataset",
        "localPath": "docs/qa/saferide-gemma4-v058-dataset-card-2026-08-11.md",
        "expectedLicense": "cc-by-4.0",
        "expectedHead": "7bf40acce5f76ad26577b5b66adf7dd7d5dca2e4",
        "artifactRevision": "ab43518babcf6255fddf7ae0087f7ce78a84a707",
        "commitMessage": "Publish final public dataset documentation",
        "managedFiles": (
            ("README.md", "docs/qa/saferide-gemma4-v058-dataset-card-2026-08-11.md"),
            ("LICENSE", "docs/qa/hf-license-files/cc-by-4.0/LICENSE"),
            ("ATTRIBUTION.md", "docs/qa/hf-license-files/dataset/ATTRIBUTION.md"),
            ("PUBLIC_RELEASE.md", "docs/qa/hf-license-files/dataset/PUBLIC_RELEASE.md"),
        ),
        "anonymousArtifacts": (
            {
                "path": "data/combined-unique-train.jsonl",
                "sha256": "669835b5f680b2198cf06d8c23a02d2e9aba2acba816c6283a0cdbbf8586a15e",
                "sizeBytes": 5_830_813,
                "downloadAndHash": True,
            },
            {
                "path": "data/weighted-train.jsonl",
                "sha256": "b6fd044f9e7854d358200288b195787fc9ed6e8eea52925eea9aa0d48783689e",
                "sizeBytes": 6_071_351,
                "downloadAndHash": True,
            },
        ),
    },
    {
        "key": "adapter",
        "repoId": "esherialabs/saferide-gemma-4-e2b-v058-original-419806-adapter",
        "repoType": "model",
        "cardType": "model",
        "localPath": "docs/qa/saferide-gemma4-e2b-v058-adapter-model-card-2026-08-11.md",
        "expectedLicense": "apache-2.0",
        "expectedHead": "92b93098cf7d0cc0a495a29b8b24cff765fb5d5d",
        "artifactRevision": "019dd8182883ad0721ffa70f4680d6977b7be99b",
        "commitMessage": "Publish final public adapter documentation",
        "managedFiles": (
            ("README.md", "docs/qa/saferide-gemma4-e2b-v058-adapter-model-card-2026-08-11.md"),
            ("LICENSE", "docs/qa/hf-license-files/apache-2.0/LICENSE"),
            ("NOTICE", "docs/qa/hf-license-files/adapter/NOTICE"),
            ("PUBLIC_RELEASE.md", "docs/qa/hf-license-files/adapter/PUBLIC_RELEASE.md"),
            (
                "PRIVATE_UPLOAD_INSTRUCTIONS.md",
                "docs/qa/hf-license-files/adapter/PRIVATE_UPLOAD_INSTRUCTIONS.md",
            ),
        ),
        "anonymousArtifacts": (
            {
                "path": "adapter_model.safetensors",
                "sha256": "1f8631d41dd3e16a62b1a95a7676c7585655ea97d100719ce0908902fb9e80aa",
                "sizeBytes": 48_376_416,
                "downloadAndHash": True,
            },
        ),
    },
    {
        "key": "mobile",
        "repoId": "esherialabs/saferide-gemma-4-e2b-v058-original-419806-litertlm",
        "repoType": "model",
        "cardType": "model",
        "localPath": "docs/qa/saferide-gemma4-e2b-v058-litertlm-model-card-2026-08-10.md",
        "expectedLicense": "apache-2.0",
        "expectedHead": "12b2f64f74c517ddf6dc34f44dfcca9bcde28434",
        "artifactRevision": "e91ea27c3134fe21fc5bc995141675756e2c4a21",
        "commitMessage": "Publish final public LiteRT-LM documentation",
        "managedFiles": (
            ("README.md", "docs/qa/saferide-gemma4-e2b-v058-litertlm-model-card-2026-08-10.md"),
            ("LICENSE", "docs/qa/hf-license-files/apache-2.0/LICENSE"),
            ("NOTICE", "docs/qa/hf-license-files/mobile/NOTICE"),
            ("PUBLIC_RELEASE.md", "docs/qa/hf-license-files/mobile/PUBLIC_RELEASE.md"),
        ),
        "anonymousArtifacts": (
            {
                "path": "saferide-gemma4-e2b-v058-original-419806-runtime-compatible.litertlm",
                "sha256": "8b73fd844464f220955eeedc474c30f39e621458c7a6b092de5afa2c3d027fcd",
                "sizeBytes": 5_071_837_136,
                "downloadAndHash": False,
            },
        ),
    },
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate or publicly release the three SafeRide v0.5.8 Hugging Face repositories."
    )
    parser.add_argument(
        "--execute",
        action="store_true",
        help="Publish final docs, switch all three repositories to public, and verify anonymously.",
    )
    parser.add_argument(
        "--confirm-fresh-fine-grained-token",
        action="store_true",
        help="Required with --execute; attests that SAFERIDE_HF_TOKEN is fresh and least-privilege.",
    )
    parser.add_argument(
        "--allow-user-authorized-write-token",
        action="store_true",
        help="Explicitly allow a user-authorized broad write token and record the least-privilege exception.",
    )
    parser.add_argument(
        "--confirm-public-release-authorized",
        action="store_true",
        help="Required with --execute; confirms the project owner authorized public visibility.",
    )
    parser.add_argument(
        "--result",
        help="Required with --execute; private JSON result path outside the repository.",
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


def import_hub() -> tuple[Any, Any, Any, Any, Any, Any]:
    try:
        from huggingface_hub import (
            DatasetCard,
            HfApi,
            ModelCard,
            get_hf_file_metadata,
            hf_hub_download,
            hf_hub_url,
        )
    except ImportError as error:  # pragma: no cover - depends on operator environment
        raise RuntimeError("huggingface_hub is required for card publication.") from error
    return HfApi, hf_hub_download, DatasetCard, ModelCard, get_hf_file_metadata, hf_hub_url


def local_cards() -> dict[str, dict[str, Any]]:
    _, _, DatasetCard, ModelCard, _, _ = import_hub()
    result: dict[str, dict[str, Any]] = {}
    for spec in REPOSITORIES:
        path = (REPO_ROOT / spec["localPath"]).resolve()
        require(path.is_file(), f"Missing canonical {spec['key']} card: {path}")
        require(REPO_ROOT in path.parents, f"Canonical card escaped repository root: {path}")
        card_class = DatasetCard if spec["cardType"] == "dataset" else ModelCard
        card = card_class.load(str(path))
        actual_license = getattr(card.data, "license", None)
        require(
            actual_license == spec["expectedLicense"],
            f"Unexpected {spec['key']} card license: expected {spec['expectedLicense']}, found {actual_license}",
        )
        value = path.read_bytes()
        require(value.startswith(b"---\n"), f"Card metadata block is missing: {path}")
        require(PUBLIC_CONTACT.encode("utf-8") in value, f"Public contact is missing: {path}")
        files: dict[str, dict[str, Any]] = {}
        for remote_path, local_path in spec["managedFiles"]:
            managed_path = (REPO_ROOT / local_path).resolve()
            require(managed_path.is_file(), f"Missing managed file for {spec['key']}: {managed_path}")
            require(REPO_ROOT in managed_path.parents, f"Managed file escaped repository root: {managed_path}")
            managed_bytes = managed_path.read_bytes()
            require(managed_bytes, f"Managed file is empty: {managed_path}")
            files[remote_path] = {
                "path": managed_path,
                "bytes": managed_bytes,
                "sha256": sha256_bytes(managed_bytes),
                "sizeBytes": len(managed_bytes),
            }
        result[spec["key"]] = {
            "path": path,
            "bytes": value,
            "sha256": sha256_bytes(value),
            "sizeBytes": len(value),
            "license": actual_license,
            "files": files,
        }
    return result


def token_role(identity: dict[str, Any]) -> str | None:
    auth = identity.get("auth")
    if not isinstance(auth, dict):
        return None
    access_token = auth.get("accessToken")
    if not isinstance(access_token, dict):
        return None
    role = access_token.get("role")
    return role if isinstance(role, str) else None


def repo_info(api: Any, spec: dict[str, Any], token: Any, *, revision: str | None = None) -> Any:
    kwargs = {
        "revision": revision,
        "files_metadata": True,
        "token": token,
    }
    if spec["repoType"] == "dataset":
        return api.dataset_info(spec["repoId"], **kwargs)
    return api.model_info(spec["repoId"], **kwargs)


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
    require(path != REPO_ROOT and REPO_ROOT not in path.parents, "Result must remain outside the repository.")
    require(path.name not in {"", ".", ".."}, "Result path must identify a file.")
    return path


def write_private_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    encoded = (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n").encode("utf-8")
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_bytes(encoded)
    temporary.chmod(0o600)
    temporary.replace(path)
    path.chmod(0o600)
    require(stat.S_IMODE(path.stat().st_mode) & 0o077 == 0, "Publication result permissions are too broad.")


def preflight_repositories(api: Any, token: str) -> dict[str, dict[str, Any]]:
    preflight: dict[str, dict[str, Any]] = {}
    for spec in REPOSITORIES:
        info = repo_info(api, spec, token)
        require(info.private is True, f"Refusing non-private repository: {spec['repoId']}")
        require(getattr(info, "gated", False) is False, f"Refusing gated repository: {spec['repoId']}")
        require(
            info.sha == spec["expectedHead"],
            f"Unexpected remote head for {spec['repoId']}: expected {spec['expectedHead']}, found {info.sha}",
        )
        managed_paths = {remote_path for remote_path, _ in spec["managedFiles"]}
        preflight[spec["key"]] = {
            "head": info.sha,
            "artifactInventory": artifact_inventory(info, managed_paths),
        }
    return preflight


def anonymous_artifact_checks(
    spec: dict[str, Any],
    hf_hub_download: Any,
    get_hf_file_metadata: Any,
    hf_hub_url: Any,
) -> dict[str, dict[str, Any]]:
    checks: dict[str, dict[str, Any]] = {}
    for artifact in spec["anonymousArtifacts"]:
        path = artifact["path"]
        if artifact["downloadAndHash"]:
            with tempfile.TemporaryDirectory(prefix=f"saferide-{spec['key']}-anonymous-artifact-") as temporary:
                downloaded = Path(
                    hf_hub_download(
                        repo_id=spec["repoId"],
                        filename=path,
                        repo_type=spec["repoType"],
                        revision=spec["artifactRevision"],
                        token=False,
                        local_dir=temporary,
                        force_download=True,
                    )
                )
                require(
                    downloaded.stat().st_size == artifact["sizeBytes"],
                    f"Anonymous size mismatch for {spec['repoId']}/{path}",
                )
                require(
                    sha256_file(downloaded) == artifact["sha256"],
                    f"Anonymous SHA-256 mismatch for {spec['repoId']}/{path}",
                )
            checks[path] = {
                "method": "anonymous-full-download",
                "sizeBytes": artifact["sizeBytes"],
                "sha256": artifact["sha256"],
                "verified": True,
            }
            continue

        url = hf_hub_url(
            repo_id=spec["repoId"],
            filename=path,
            repo_type=spec["repoType"],
            revision=spec["artifactRevision"],
        )
        metadata = get_hf_file_metadata(url, token=False, retry_on_errors=True)
        etag = None if metadata.etag is None else str(metadata.etag).strip('"')
        require(metadata.size == artifact["sizeBytes"], f"Anonymous metadata size mismatch: {path}")
        require(etag == artifact["sha256"], f"Anonymous metadata ETag mismatch: {path}")
        checks[path] = {
            "method": "anonymous-metadata-resolution-no-large-download",
            "sizeBytes": artifact["sizeBytes"],
            "sha256": artifact["sha256"],
            "etagMatchedSha256": True,
            "verified": True,
        }
    return checks


def anonymous_repo_info(api: Any, spec: dict[str, Any], revision: str) -> Any:
    last_error: Exception | None = None
    for attempt in range(6):
        try:
            info = repo_info(api, spec, False)
            if info.private is False and info.sha == revision:
                return info
        except Exception as error:  # pragma: no cover - eventual consistency depends on Hub
            last_error = error
        if attempt < 5:
            time.sleep(2)
    if last_error is not None:
        raise RuntimeError(f"Anonymous repository verification failed: {spec['repoId']}") from last_error
    raise RuntimeError(f"Anonymous repository state did not converge: {spec['repoId']}")


def publish_cards(
    token: str,
    result_path: Path,
    *,
    allow_user_authorized_write_token: bool = False,
    public_release_authorized: bool = False,
) -> dict[str, Any]:
    require(public_release_authorized, "Explicit project-owner public-release authorization is required.")
    HfApi, hf_hub_download, _, _, get_hf_file_metadata, hf_hub_url = import_hub()
    cards = local_cards()
    api = HfApi(token=token)
    identity = api.whoami(token=token)
    role = token_role(identity)
    write_token_exception = role == "write" and allow_user_authorized_write_token
    require(
        role == "fineGrained" or write_token_exception,
        "SAFERIDE_HF_TOKEN must be fine-grained unless the user-authorized write-token exception is explicit.",
    )

    preflight = preflight_repositories(api, token)
    result: dict[str, Any] = {
        "schema": RESULT_SCHEMA,
        "schemaVersion": 1,
        "recordedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": "publishing-final-documentation-while-private",
        "approval": {
            "authorizedBy": "Franklin Sagini",
            "contact": PUBLIC_CONTACT,
            "authorizationDate": "2026-08-13",
            "scope": "public-research-distribution-of-three-hugging-face-repositories",
            "androidProductionAuthorization": False,
        },
        "credential": {
            "sourceEnvironmentVariable": TOKEN_ENV,
            "role": role,
            "leastPrivilegeSatisfied": role == "fineGrained",
            "userAuthorizedWriteTokenException": write_token_exception,
            "persistedByCommand": False,
            "tokenValueRecorded": False,
        },
        "repositories": {},
        "rollback": {
            "attempted": False,
            "completed": False,
            "repositories": {},
        },
    }
    write_private_json(result_path, result)

    publicized: list[dict[str, Any]] = []
    phase = "private-documentation-publication"
    try:
        for spec in REPOSITORIES:
            key = spec["key"]
            card = cards[key]
            with tempfile.TemporaryDirectory(prefix=f"saferide-{key}-publication-") as temporary:
                publication_dir = Path(temporary)
                for remote_path, managed in card["files"].items():
                    destination = publication_dir / remote_path
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    destination.write_bytes(managed["bytes"])
                commit = api.upload_folder(
                    folder_path=str(publication_dir),
                    repo_id=spec["repoId"],
                    repo_type=spec["repoType"],
                    revision="main",
                    commit_message=spec["commitMessage"],
                    parent_commit=spec["expectedHead"],
                    allow_patterns=sorted(card["files"]),
                    token=token,
                )
            revision = commit.oid
            require(isinstance(revision, str) and len(revision) == 40, "Hugging Face returned no immutable commit SHA.")

            immutable_info = repo_info(api, spec, token, revision=revision)
            require(immutable_info.private is True, f"Repository became non-private: {spec['repoId']}")
            require(immutable_info.sha == revision, f"Immutable revision mismatch for {spec['repoId']}")
            managed_paths = set(card["files"])
            require(
                artifact_inventory(immutable_info, managed_paths) == preflight[key]["artifactInventory"],
                f"Artifact-bearing repository bytes changed for {spec['repoId']}",
            )

            current_info = repo_info(api, spec, token)
            require(current_info.private is True, f"Repository became non-private: {spec['repoId']}")
            require(current_info.sha == revision, f"Remote head advanced unexpectedly after upload: {spec['repoId']}")

            downloaded_files: dict[str, dict[str, Any]] = {}
            with tempfile.TemporaryDirectory(prefix=f"saferide-{key}-verify-") as temporary:
                for remote_path, managed in card["files"].items():
                    downloaded = Path(
                        hf_hub_download(
                            repo_id=spec["repoId"],
                            filename=remote_path,
                            repo_type=spec["repoType"],
                            revision=revision,
                            token=token,
                            local_dir=temporary,
                            force_download=True,
                        )
                    ).read_bytes()
                    require(
                        downloaded == managed["bytes"],
                        f"Downloaded {remote_path} bytes differ for {spec['repoId']}",
                    )
                    downloaded_files[remote_path] = {
                        "sha256": managed["sha256"],
                        "sizeBytes": managed["sizeBytes"],
                        "downloadedBytesMatched": True,
                    }

            result["repositories"][key] = {
                "repoId": spec["repoId"],
                "repoType": spec["repoType"],
                "privateBefore": True,
                "privateAfterDocumentation": True,
                "privateAfter": None,
                "gatedAfter": None,
                "artifactRevision": spec["artifactRevision"],
                "previousHeadRevision": spec["expectedHead"],
                "documentationRevision": revision,
                "license": card["license"],
                "readmeSha256": card["sha256"],
                "readmeSizeBytes": card["sizeBytes"],
                "uploadedPaths": sorted(card["files"]),
                "files": downloaded_files,
                "downloadedBytesMatched": all(
                    item["downloadedBytesMatched"] for item in downloaded_files.values()
                ),
                "artifactInventoryUnchanged": True,
            }
            write_private_json(result_path, result)

        phase = "visibility-change"
        result["status"] = "final-documentation-verified-changing-visibility"
        write_private_json(result_path, result)
        for spec in REPOSITORIES:
            api.update_repo_settings(
                repo_id=spec["repoId"],
                repo_type=spec["repoType"],
                private=False,
                gated=False,
                token=token,
            )
            publicized.append(spec)

        phase = "anonymous-verification"
        result["status"] = "public-anonymous-verification"
        write_private_json(result_path, result)
        anonymous_api = HfApi(token=False)
        for spec in REPOSITORIES:
            key = spec["key"]
            publication = result["repositories"][key]
            revision = publication["documentationRevision"]
            public_info = anonymous_repo_info(anonymous_api, spec, revision)
            require(getattr(public_info, "gated", False) is False, f"Repository is gated: {spec['repoId']}")
            managed_paths = set(cards[key]["files"])
            require(
                artifact_inventory(public_info, managed_paths) == preflight[key]["artifactInventory"],
                f"Public artifact inventory changed for {spec['repoId']}",
            )

            anonymous_files: dict[str, dict[str, Any]] = {}
            with tempfile.TemporaryDirectory(prefix=f"saferide-{key}-anonymous-docs-") as temporary:
                for remote_path, managed in cards[key]["files"].items():
                    downloaded = Path(
                        hf_hub_download(
                            repo_id=spec["repoId"],
                            filename=remote_path,
                            repo_type=spec["repoType"],
                            revision=revision,
                            token=False,
                            local_dir=temporary,
                            force_download=True,
                        )
                    ).read_bytes()
                    require(
                        downloaded == managed["bytes"],
                        f"Anonymous {remote_path} bytes differ for {spec['repoId']}",
                    )
                    anonymous_files[remote_path] = {
                        "sha256": managed["sha256"],
                        "sizeBytes": managed["sizeBytes"],
                        "downloadedBytesMatched": True,
                    }

            publication["privateAfter"] = False
            publication["publicAfter"] = True
            publication["gatedAfter"] = False
            publication["anonymousDocumentationFiles"] = anonymous_files
            publication["anonymousDocumentationBytesMatched"] = True
            publication["anonymousArtifacts"] = anonymous_artifact_checks(
                spec,
                hf_hub_download,
                get_hf_file_metadata,
                hf_hub_url,
            )
            publication["anonymousAccessVerified"] = True
            write_private_json(result_path, result)
    except Exception:
        if publicized:
            result["rollback"]["attempted"] = True
            rollback_complete = True
            for spec in reversed(publicized):
                try:
                    api.update_repo_settings(
                        repo_id=spec["repoId"],
                        repo_type=spec["repoType"],
                        private=True,
                        gated=False,
                        token=token,
                    )
                    restored = repo_info(api, spec, token)
                    require(restored.private is True, f"Rollback did not restore privacy: {spec['repoId']}")
                    result["rollback"]["repositories"][spec["key"]] = "restored-private"
                except Exception:
                    rollback_complete = False
                    result["rollback"]["repositories"][spec["key"]] = "rollback-failed"
            result["rollback"]["completed"] = rollback_complete
            result["status"] = (
                "failed-public-release-rolled-back"
                if rollback_complete
                else "failed-public-release-rollback-incomplete"
            )
        else:
            result["status"] = "failed-private-documentation-publication"
        result["failedPhase"] = phase
        write_private_json(result_path, result)
        raise

    result["status"] = "public-documentation-and-artifact-access-verified"
    result["completedAt"] = dt.datetime.now(dt.timezone.utc).isoformat()
    write_private_json(result_path, result)
    return result


def main() -> int:
    args = parse_args()
    cards = local_cards()
    for spec in REPOSITORIES:
        card = cards[spec["key"]]
        print(f"{spec['key']}_readme_sha256 {card['sha256']}")
        print(f"{spec['key']}_readme_size_bytes {card['sizeBytes']}")

    if not args.execute:
        print("No remote repository access or upload was attempted.")
        return 0

    require(
        args.confirm_fresh_fine_grained_token or args.allow_user_authorized_write_token,
        "Fine-grained confirmation or explicit user-authorized write-token exception is required.",
    )
    require(
        args.confirm_public_release_authorized,
        "Explicit project-owner public-release authorization confirmation is required.",
    )
    require(args.result is not None, "--result is required with --execute.")
    token = os.environ.pop(TOKEN_ENV, None)
    require(token is not None and token.strip() != "", f"{TOKEN_ENV} is required with --execute.")
    result = publish_cards(
        token,
        safe_result_path(args.result),
        allow_user_authorized_write_token=args.allow_user_authorized_write_token,
        public_release_authorized=args.confirm_public_release_authorized,
    )
    for key, publication in result["repositories"].items():
        print(f"{key}_documentation_revision {publication['documentationRevision']}")
        print(f"{key}_readme_sha256 {publication['readmeSha256']}")
    print("Public release and anonymous documentation/artifact verification completed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
