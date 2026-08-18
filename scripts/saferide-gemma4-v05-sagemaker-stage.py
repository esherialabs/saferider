#!/usr/bin/env python3
"""Create and stage immutable SafeRide v0.5 SageMaker inputs.

The script deliberately keeps holdouts, blind prompts, reviewer records,
candidate files, credentials, and survivor data out of the training channels.
It uploads the approved train/dev package and the exact pinned base-model bytes,
then writes a content-free, version-bound input manifest and staging receipt.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import os
import re
import shutil
import subprocess
import tarfile
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path, PurePosixPath
from typing import Any, BinaryIO


MODEL_ID = "google/gemma-4-E2B-it"
MODEL_REVISION = "70af34e20bd4b7a91f0de6b22675850c43922a03"
DATASET_ID = "saferide-synthetic-guidance-v0.5.0"
REGION = "eu-central-1"
MODEL_FILES = (
    ".gitattributes",
    "README.md",
    "chat_template.jinja",
    "config.json",
    "generation_config.json",
    "model.safetensors",
    "processor_config.json",
    "tokenizer.json",
    "tokenizer_config.json",
)
DATASET_FILES = (
    "artifacts/audit/dataset-audit.json",
    "artifacts/dataset/controlled/dev.jsonl",
    "artifacts/dataset/controlled/pilot-row-manifest.json",
    "artifacts/dataset/controlled/train.jsonl",
    "artifacts/dataset/public-safe/dataset-manifest.json",
    "artifacts/matrix/scenarios.frozen.jsonl",
    "artifacts/policy/approved-policy.json",
    "artifacts/policy/approved-system-prompt.json",
    "artifacts/semantic/semantic-report.json",
    "artifacts/splits/split-manifest.frozen.json",
    "register.json",
)
FORBIDDEN_PATH = re.compile(
    r"(?:^|/)(?:quality-holdout|safety-holdout|blind|reviews?|candidates?|approvals?|credentials?)(?:/|$)",
    re.IGNORECASE,
)


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def json_bytes(value: Any) -> bytes:
    return (json.dumps(value, indent=2, sort_keys=True) + "\n").encode("utf-8")


def write_private_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    path.write_bytes(json_bytes(value))
    path.chmod(0o600)


def safe_relative(value: str) -> bool:
    path = PurePosixPath(value)
    return bool(value) and not path.is_absolute() and ".." not in path.parts and "\\" not in value


def source_archive_members(source_archive: Path) -> tuple[str, dict[str, tarfile.TarInfo]]:
    with tarfile.open(source_archive, "r:gz") as archive:
        members = archive.getmembers()
    if not members:
        raise RuntimeError("Source handoff archive is empty.")
    roots = {PurePosixPath(member.name).parts[0] for member in members if PurePosixPath(member.name).parts}
    if len(roots) != 1:
        raise RuntimeError("Source handoff archive must contain exactly one top-level directory.")
    root = next(iter(roots))
    indexed: dict[str, tarfile.TarInfo] = {}
    for member in members:
        if member.issym() or member.islnk() or member.isdev():
            raise RuntimeError("Source handoff archive contains a link or device entry.")
        relative = PurePosixPath(member.name).relative_to(root).as_posix()
        if relative == "." or member.isdir():
            continue
        if not safe_relative(relative):
            raise RuntimeError(f"Unsafe source archive path: {relative}")
        indexed[relative] = member
    allowed = set(DATASET_FILES) | {"metadata/handoff-manifest.json"}
    extras = sorted(set(indexed) - allowed)
    missing = sorted(set(DATASET_FILES) - set(indexed))
    if extras or missing:
        raise RuntimeError(f"Source handoff archive inventory differs (extra={extras}, missing={missing}).")
    return root, indexed


def extract_selected(source_archive: Path, destination: Path) -> None:
    source_root, indexed = source_archive_members(source_archive)
    with tarfile.open(source_archive, "r:gz") as archive:
        for relative in DATASET_FILES:
            member = indexed[relative]
            source = archive.extractfile(member)
            if source is None:
                raise RuntimeError(f"Cannot read source archive member: {relative}")
            target = destination / relative
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            with source, target.open("wb") as output:
                shutil.copyfileobj(source, output, length=8 * 1024 * 1024)
            target.chmod(0o600)


def verify_embedded_source_manifest(source_archive: Path, source_manifest: Path) -> None:
    source_root, indexed = source_archive_members(source_archive)
    del source_root
    member = indexed["metadata/handoff-manifest.json"]
    with tarfile.open(source_archive, "r:gz") as archive:
        embedded = archive.extractfile(member)
        if embedded is None or hashlib.sha256(embedded.read()).hexdigest() != sha256_file(source_manifest):
            raise RuntimeError("Embedded and separately supplied source handoff manifests differ.")


def verify_source_manifest(source_manifest: Path, extracted_root: Path) -> dict[str, Any]:
    manifest = json.loads(source_manifest.read_text(encoding="utf-8"))
    if manifest.get("datasetId") != DATASET_ID:
        raise RuntimeError("Source handoff dataset ID differs from v0.5.")
    source_commit = manifest.get("sourceCommit")
    if not isinstance(source_commit, str) or not re.fullmatch(r"[a-f0-9]{40}", source_commit):
        raise RuntimeError("Source handoff lacks an immutable Git commit.")
    source_created_at = manifest.get("createdAt")
    if not isinstance(source_created_at, str) or "T" not in source_created_at:
        raise RuntimeError("Source handoff lacks a stable creation timestamp.")
    if manifest.get("privacy") != {
        "containsReviewerIdentity": False,
        "containsCredentials": False,
        "containsRestrictedHoldoutBytes": False,
        "containsBlindPromptBytes": False,
    }:
        raise RuntimeError("Source handoff privacy declaration is missing or differs.")
    expected = {item.get("path"): item.get("sha256") for item in manifest.get("files", [])}
    if set(expected) != set(DATASET_FILES):
        raise RuntimeError("Source handoff manifest does not contain the exact training-safe inventory.")
    for relative in DATASET_FILES:
        if FORBIDDEN_PATH.search(relative):
            raise RuntimeError(f"Forbidden training path: {relative}")
        target = extracted_root / relative
        if not target.is_file() or sha256_file(target) != expected[relative]:
            raise RuntimeError(f"Source handoff bytes differ from the manifest: {relative}")
    return manifest


def add_tar_directory(archive: tarfile.TarFile, name: str) -> None:
    info = tarfile.TarInfo(name.rstrip("/") + "/")
    info.type = tarfile.DIRTYPE
    info.mode = 0o700
    info.uid = info.gid = 0
    info.uname = info.gname = ""
    info.mtime = 0
    archive.addfile(info)


def add_tar_file(archive: tarfile.TarFile, source: Path, name: str) -> None:
    info = tarfile.TarInfo(name)
    info.size = source.stat().st_size
    info.mode = 0o600
    info.uid = info.gid = 0
    info.uname = info.gname = ""
    info.mtime = 0
    with source.open("rb") as handle:
        archive.addfile(info, handle)


def create_deterministic_archive(root: Path, top_level: str, output: Path) -> None:
    directories = {top_level, f"{top_level}/metadata"}
    files = [path for path in root.rglob("*") if path.is_file()]
    for file in files:
        relative = file.relative_to(root).as_posix()
        parent = PurePosixPath(relative).parent
        while str(parent) not in {".", ""}:
            directories.add(f"{top_level}/{parent.as_posix()}")
            parent = parent.parent
    output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with output.open("wb") as raw:
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0, compresslevel=9) as compressed:
            with tarfile.open(fileobj=compressed, mode="w", format=tarfile.PAX_FORMAT) as archive:
                for directory in sorted(directories, key=lambda item: (item.count("/"), item)):
                    add_tar_directory(archive, directory)
                for file in sorted(files, key=lambda item: item.relative_to(root).as_posix()):
                    add_tar_file(archive, file, f"{top_level}/{file.relative_to(root).as_posix()}")
    output.chmod(0o600)


def package_dataset(source_archive: Path, source_manifest: Path, output_dir: Path) -> dict[str, Any]:
    if not source_archive.is_file() or not source_manifest.is_file():
        raise RuntimeError("Source handoff archive and manifest must both exist.")
    output_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    verify_embedded_source_manifest(source_archive, source_manifest)
    with tempfile.TemporaryDirectory(prefix="saferide-v05-package-", dir=output_dir) as temporary:
        package_root = Path(temporary) / "root"
        package_root.mkdir(mode=0o700)
        extract_selected(source_archive, package_root)
        legacy = verify_source_manifest(source_manifest, package_root)
        register_sha = sha256_file(package_root / "register.json")
        top_level = f"saferide-v05-sagemaker-input-{register_sha[:12]}"
        files = [
            {
                "path": relative,
                "sha256": sha256_file(package_root / relative),
                "sizeBytes": (package_root / relative).stat().st_size,
            }
            for relative in DATASET_FILES
        ]
        package_manifest = {
            "schema": "com.saferide.ai.v05-sagemaker-dataset-package",
            "schemaVersion": 1,
            "packageId": top_level,
            "datasetId": DATASET_ID,
            "sourceCommit": legacy["sourceCommit"],
            "sourceCreatedAt": legacy["createdAt"],
            "sourceArchiveSha256": sha256_file(source_archive),
            "sourceManifestSha256": sha256_file(source_manifest),
            "files": files,
            "exclusions": {
                "qualityHoldout": True,
                "safetyHoldout": True,
                "blindPrompts": True,
                "candidateContent": True,
                "reviewLedgers": True,
                "reviewerIdentities": True,
                "credentials": True,
            },
            "privacy": {
                "containsSurvivorData": False,
                "containsRestrictedEvaluationBytes": False,
                "containsCredentials": False,
            },
        }
        package_manifest_path = package_root / "metadata" / "sagemaker-package-manifest.json"
        write_private_json(package_manifest_path, package_manifest)
        public_manifest_path = output_dir / f"{top_level}.package-manifest.json"
        write_private_json(public_manifest_path, package_manifest)
        archive_path = output_dir / f"{top_level}.tar.gz"
        create_deterministic_archive(package_root, top_level, archive_path)
    return {
        "packageId": top_level,
        "sourceCommit": legacy["sourceCommit"],
        "sourceCreatedAt": legacy["createdAt"],
        "archivePath": str(archive_path),
        "archiveSha256": sha256_file(archive_path),
        "archiveSizeBytes": archive_path.stat().st_size,
        "packageManifestPath": str(public_manifest_path),
        "packageManifestSha256": sha256_file(public_manifest_path),
        "topLevelDirectory": top_level,
    }


def run_json(command: list[str]) -> dict[str, Any]:
    result = subprocess.run(command, text=True, capture_output=True, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"Command failed: {' '.join(command[:2])}")
    return json.loads(result.stdout) if result.stdout.strip() else {}


def aws_json(profile: str, service_args: list[str]) -> dict[str, Any]:
    return run_json(["aws", *service_args, "--profile", profile, "--region", REGION, "--output", "json"])


def verify_bucket_controls(profile: str, bucket: str) -> None:
    versioning = aws_json(profile, ["s3api", "get-bucket-versioning", "--bucket", bucket])
    if versioning.get("Status") != "Enabled":
        raise RuntimeError("Controlled S3 bucket versioning is not enabled.")
    encryption = aws_json(profile, ["s3api", "get-bucket-encryption", "--bucket", bucket])
    algorithms = {
        rule.get("ApplyServerSideEncryptionByDefault", {}).get("SSEAlgorithm")
        for rule in encryption.get("ServerSideEncryptionConfiguration", {}).get("Rules", [])
    }
    if "AES256" not in algorithms:
        raise RuntimeError("Controlled S3 bucket does not default to AES256 encryption.")
    public = aws_json(profile, ["s3api", "get-public-access-block", "--bucket", bucket])
    block = public.get("PublicAccessBlockConfiguration", {})
    if not all(block.get(key) is True for key in (
        "BlockPublicAcls", "IgnorePublicAcls", "BlockPublicPolicy", "RestrictPublicBuckets"
    )):
        raise RuntimeError("Controlled S3 bucket public-access blocking is incomplete.")


def head_object(profile: str, bucket: str, key: str, version_id: str | None = None) -> dict[str, Any] | None:
    command = [
        "aws", "s3api", "head-object", "--bucket", bucket, "--key", key,
        "--profile", profile, "--region", REGION, "--output", "json",
    ]
    if version_id:
        command.extend(["--version-id", version_id])
    result = subprocess.run(command, text=True, capture_output=True, check=False)
    if result.returncode != 0:
        if "Not Found" in result.stderr or "404" in result.stderr or "NoSuchKey" in result.stderr:
            return None
        raise RuntimeError("S3 object verification failed.")
    return json.loads(result.stdout)


def upload_file(profile: str, bucket: str, key: str, source: Path, sha256: str, source_revision: str) -> dict[str, Any]:
    existing = head_object(profile, bucket, key)
    if existing is not None:
        if (
            int(existing.get("ContentLength", -1)) != source.stat().st_size
            or existing.get("Metadata", {}).get("sha256") != sha256
            or existing.get("ServerSideEncryption") != "AES256"
        ):
            raise RuntimeError(f"Immutable S3 key already exists with different bytes: {Path(key).name}")
        return existing
    destination = f"s3://{bucket}/{key}"
    result = subprocess.run(
        [
            "aws", "s3", "cp", str(source), destination,
            "--sse", "AES256",
            "--metadata", f"sha256={sha256},source-revision={source_revision}",
            "--only-show-errors",
            "--profile", profile,
            "--region", REGION,
        ],
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(f"S3 upload failed: {source.name}")
    uploaded = head_object(profile, bucket, key)
    if uploaded is None:
        raise RuntimeError(f"Uploaded S3 object cannot be verified: {source.name}")
    if (
        int(uploaded.get("ContentLength", -1)) != source.stat().st_size
        or uploaded.get("Metadata", {}).get("sha256") != sha256
        or uploaded.get("ServerSideEncryption") != "AES256"
        or not uploaded.get("VersionId")
    ):
        raise RuntimeError(f"Uploaded S3 object metadata differs: {source.name}")
    return uploaded


def model_metadata(token: str | None) -> list[dict[str, Any]]:
    url = f"https://huggingface.co/api/models/{MODEL_ID}/revision/{MODEL_REVISION}?blobs=true"
    headers = {"User-Agent": "SafeRide-SageMaker-Stager/1.0"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=60) as response:
        document = json.load(response)
    siblings = {item.get("rfilename"): item for item in document.get("siblings", [])}
    if set(siblings) != set(MODEL_FILES):
        raise RuntimeError("Pinned model repository inventory differs from the approved nine-file snapshot.")
    output = []
    for name in MODEL_FILES:
        item = siblings[name]
        lfs = item.get("lfs") or {}
        output.append({
            "path": name,
            "sizeBytes": int(lfs.get("size", item.get("size", 0))),
            "expectedSha256": lfs.get("sha256"),
        })
    if any(item["sizeBytes"] <= 0 for item in output):
        raise RuntimeError("Pinned model metadata lacks an exact file size.")
    return output


def download_model_file(name: str, destination: Path, token: str | None, expected_size: int, expected_sha: str | None) -> str:
    if destination.is_file() and destination.stat().st_size == expected_size:
        digest = sha256_file(destination)
        if expected_sha is None or digest == expected_sha:
            return digest
        destination.unlink()
    quoted = urllib.parse.quote(name, safe="")
    url = f"https://huggingface.co/{MODEL_ID}/resolve/{MODEL_REVISION}/{quoted}?download=true"
    headers = {"User-Agent": "SafeRide-SageMaker-Stager/1.0"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    request = urllib.request.Request(url, headers=headers)
    digest = hashlib.sha256()
    written = 0
    next_progress = 1024**3
    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    partial = destination.with_suffix(destination.suffix + ".partial")
    try:
        with urllib.request.urlopen(request, timeout=120) as response, partial.open("wb") as output:
            while True:
                chunk = response.read(8 * 1024 * 1024)
                if not chunk:
                    break
                output.write(chunk)
                digest.update(chunk)
                written += len(chunk)
                if written >= next_progress:
                    print(f"Downloaded {name}: {written / 1024**3:.1f} GiB", flush=True)
                    next_progress += 1024**3
    except urllib.error.HTTPError as error:
        partial.unlink(missing_ok=True)
        raise RuntimeError(f"Pinned model download failed for {name} (HTTP {error.code}).") from error
    if written != expected_size:
        partial.unlink(missing_ok=True)
        raise RuntimeError(f"Pinned model size differs for {name}.")
    actual = digest.hexdigest()
    if expected_sha is not None and actual != expected_sha:
        partial.unlink(missing_ok=True)
        raise RuntimeError(f"Pinned model SHA-256 differs for {name}.")
    partial.replace(destination)
    destination.chmod(0o600)
    return actual


def staged_object(source: Path, sha: str, s3_uri: str, head: dict[str, Any], **extra: Any) -> dict[str, Any]:
    return {
        **extra,
        "sha256": sha,
        "sizeBytes": source.stat().st_size,
        "s3Uri": s3_uri,
        "versionId": str(head["VersionId"]),
        "etag": str(head.get("ETag", "unknown")),
    }


def stage_inputs(args: argparse.Namespace) -> dict[str, Any]:
    source_archive = Path(args.source_archive).expanduser().resolve()
    source_manifest = Path(args.source_manifest).expanduser().resolve()
    work_dir = Path(args.work_dir).expanduser().resolve()
    work_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
    verify_bucket_controls(args.profile, args.bucket)
    package = package_dataset(source_archive, source_manifest, work_dir / "dataset")
    prefix = f"saferide/v05/sagemaker/inputs/{package['packageId']}/"
    archive_path = Path(package["archivePath"])
    archive_key = f"{prefix}handoff/{archive_path.name}"
    archive_head = upload_file(
        args.profile, args.bucket, archive_key, archive_path,
        package["archiveSha256"], package["sourceCommit"],
    )
    archive_record = staged_object(
        archive_path,
        package["archiveSha256"],
        f"s3://{args.bucket}/{archive_key}",
        archive_head,
        fileName=archive_path.name,
        packageManifestSha256=package["packageManifestSha256"],
        topLevelDirectory=package["topLevelDirectory"],
    )

    token = os.environ.get(args.hf_token_env) or os.environ.get("HUGGINGFACE_HUB_TOKEN")
    metadata = model_metadata(token)
    model_records = []
    download_root = work_dir / "model-download"
    for index, item in enumerate(metadata, start=1):
        name = item["path"]
        key = f"{prefix}model/{name}"
        existing = head_object(args.profile, args.bucket, key)
        if (
            existing is not None
            and int(existing.get("ContentLength", -1)) == item["sizeBytes"]
            and existing.get("Metadata", {}).get("sha256")
            and existing.get("ServerSideEncryption") == "AES256"
            and existing.get("VersionId")
        ):
            actual_sha = existing["Metadata"]["sha256"]
            if item["expectedSha256"] and actual_sha != item["expectedSha256"]:
                raise RuntimeError(f"Existing staged model hash differs: {name}")
            model_records.append({
                "path": name,
                "sha256": actual_sha,
                "sizeBytes": item["sizeBytes"],
                "s3Uri": f"s3://{args.bucket}/{key}",
                "versionId": str(existing["VersionId"]),
                "etag": str(existing.get("ETag", "unknown")),
            })
            print(f"Reused staged model file {index}/{len(metadata)}: {name}", flush=True)
            continue
        local = download_root / name
        actual_sha = download_model_file(name, local, token, item["sizeBytes"], item["expectedSha256"])
        head = upload_file(args.profile, args.bucket, key, local, actual_sha, MODEL_REVISION)
        model_records.append(staged_object(local, actual_sha, f"s3://{args.bucket}/{key}", head, path=name))
        local.unlink(missing_ok=True)
        print(f"Staged model file {index}/{len(metadata)}: {name}", flush=True)

    manifest = {
        "schema": "com.saferide.ai.v05-sagemaker-input-manifest",
        "schemaVersion": 1,
        "manifestId": package["packageId"],
        "createdAt": package["sourceCreatedAt"],
        "sourceCommit": package["sourceCommit"],
        "datasetId": DATASET_ID,
        "region": REGION,
        "trainingArchive": archive_record,
        "baseModel": {
            "modelId": MODEL_ID,
            "revision": MODEL_REVISION,
            "totalBytes": sum(item["sizeBytes"] for item in model_records),
            "fileCount": len(model_records),
            "files": model_records,
            "s3Prefix": f"s3://{args.bucket}/{prefix}model/",
        },
        "storage": {
            "bucket": args.bucket,
            "prefix": prefix,
            "versioning": "Enabled",
            "serverSideEncryption": "AES256",
            "publicAccessBlocked": True,
        },
        "exclusions": {
            "qualityHoldout": True,
            "safetyHoldout": True,
            "blindPrompts": True,
            "candidateContent": True,
            "reviewLedgers": True,
            "reviewerIdentities": True,
            "credentials": True,
        },
        "privacy": {
            "classification": "controlled-training-input",
            "containsSurvivorData": False,
            "containsCredentials": False,
            "containsRestrictedEvaluationBytes": False,
        },
    }
    manifest_path = work_dir / "input-manifest.json"
    write_private_json(manifest_path, manifest)
    manifest_sha = sha256_file(manifest_path)
    manifest_key = f"{prefix}handoff/input-manifest.json"
    manifest_head = upload_file(
        args.profile, args.bucket, manifest_key, manifest_path, manifest_sha, package["sourceCommit"],
    )
    receipt = {
        "schema": "com.saferide.ai.v05-sagemaker-staging-receipt",
        "schemaVersion": 1,
        "createdAt": manifest["createdAt"],
        "manifestId": manifest["manifestId"],
        "manifestPath": str(manifest_path),
        "manifestSha256": manifest_sha,
        "manifestSizeBytes": manifest_path.stat().st_size,
        "manifestS3Uri": f"s3://{args.bucket}/{manifest_key}",
        "manifestVersionId": str(manifest_head["VersionId"]),
        "manifestEtag": str(manifest_head.get("ETag", "unknown")),
        "datasetSourceCommit": package["sourceCommit"],
        "trainingArchiveSha256": package["archiveSha256"],
        "baseModelRevision": MODEL_REVISION,
        "baseModelTotalBytes": manifest["baseModel"]["totalBytes"],
        "baseModelFileCount": manifest["baseModel"]["fileCount"],
        "restrictedEvaluationBytesUploaded": False,
    }
    receipt_path = work_dir / "staging-receipt.json"
    write_private_json(receipt_path, receipt)
    return {**receipt, "receiptPath": str(receipt_path)}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Stage immutable SafeRide v0.5 SageMaker inputs.")
    subparsers = parser.add_subparsers(dest="command", required=True)
    package = subparsers.add_parser("package-dataset")
    package.add_argument("--source-archive", required=True)
    package.add_argument("--source-manifest", required=True)
    package.add_argument("--output-dir", required=True)
    stage = subparsers.add_parser("stage")
    stage.add_argument("--source-archive", required=True)
    stage.add_argument("--source-manifest", required=True)
    stage.add_argument("--work-dir", required=True)
    stage.add_argument("--bucket", required=True)
    stage.add_argument("--profile", default="esheria-prod")
    stage.add_argument("--hf-token-env", default="HF_TOKEN")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.command == "package-dataset":
        result = package_dataset(
            Path(args.source_archive).expanduser().resolve(),
            Path(args.source_manifest).expanduser().resolve(),
            Path(args.output_dir).expanduser().resolve(),
        )
        print(json.dumps({
            "packageId": result["packageId"],
            "archiveSha256": result["archiveSha256"],
            "archiveSizeBytes": result["archiveSizeBytes"],
            "packageManifestSha256": result["packageManifestSha256"],
        }, indent=2))
        return 0
    result = stage_inputs(args)
    print(json.dumps({
        "manifestId": result["manifestId"],
        "manifestSha256": result["manifestSha256"],
        "baseModelRevision": result["baseModelRevision"],
        "baseModelFileCount": result["baseModelFileCount"],
        "baseModelTotalBytes": result["baseModelTotalBytes"],
        "restrictedEvaluationBytesUploaded": result["restrictedEvaluationBytesUploaded"],
        "receiptPath": result["receiptPath"],
    }, indent=2))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001 - CLI reports only a short content-free blocker.
        print(f"SafeRide SageMaker staging blocked: {str(error)[:500]}", file=os.sys.stderr)
        raise SystemExit(1)
