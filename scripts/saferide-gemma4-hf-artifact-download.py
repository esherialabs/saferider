#!/usr/bin/env python3
"""Download and verify the approved Gemma 4 E2B LiteRT-LM artifact.

This is a developer utility. The SafeRide QA app requires explicit user consent
before downloading this multi-GB file, while release activation remains gated.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path
from urllib.parse import quote, unquote, urlparse


REPO_ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = (
    REPO_ROOT
    / "config"
    / "ai"
    / "manifests"
    / "saferide-v058-original-419806.artifact-produced.json"
)
DEFAULT_OUTPUT_DIR = Path.home() / ".cache" / "saferide-models" / "gemma4-litertlm"


def usage_notes() -> str:
    return (
        "Install the lightweight Hub client first if needed:\n"
        "  py -3.12 -m pip install --user huggingface_hub\n\n"
        "The script uses Hugging Face auth from the normal environment/cache when present,\n"
        "but never prints tokens."
    )


def parse_manifest(manifest_path: Path = MANIFEST_PATH) -> dict[str, str | int]:
    try:
        payload = json.loads(manifest_path.read_text(encoding="utf-8"))
        artifact = payload["artifact"]
        immutable_url = str(artifact["immutableLocation"])
        parsed_url = urlparse(immutable_url)
        parts = [unquote(part) for part in parsed_url.path.strip("/").split("/")]
        resolve_index = parts.index("resolve")
        repo_id = "/".join(parts[:resolve_index])
        revision = parts[resolve_index + 1]
        filename = "/".join(parts[resolve_index + 2 :])
        manifest = {
            "manifest_id": str(payload["manifestId"]),
            "repo_id": str(payload["modelId"]),
            "revision": revision,
            "filename": str(artifact["fileName"]),
            "sha256": str(artifact["sha256"]).lower(),
            "size_bytes": int(artifact["sizeBytes"]),
            "immutable_url": immutable_url,
        }
    except (IndexError, KeyError, TypeError, ValueError, json.JSONDecodeError) as error:
        raise RuntimeError(f"Unable to read tuned artifact metadata from {manifest_path}") from error

    if payload.get("schema") != "com.saferide.tuned-mobile-artifact-manifest":
        raise RuntimeError(f"Unsupported tuned artifact manifest schema in {manifest_path}")
    if payload.get("status") not in {
        "artifact-produced",
        "artifact-android-verified",
        "checkpoint-candidate",
        "release-candidate",
        "release-ready",
    }:
        raise RuntimeError(f"Manifest {manifest['manifest_id']} does not contain a produced artifact")
    if parsed_url.scheme != "https" or parsed_url.netloc != "huggingface.co":
        raise RuntimeError("Artifact immutableLocation must use public Hugging Face HTTPS")
    if repo_id != manifest["repo_id"] or filename != manifest["filename"]:
        raise RuntimeError("Artifact immutableLocation does not match modelId and fileName")
    if not re.fullmatch(r"[a-f0-9]{40}", str(manifest["revision"])):
        raise RuntimeError("Artifact immutableLocation must pin a 40-character commit revision")
    if not str(manifest["filename"]).endswith(".litertlm"):
        raise RuntimeError("Artifact fileName must be a .litertlm file")
    if not re.fullmatch(r"[a-f0-9]{64}", str(manifest["sha256"])):
        raise RuntimeError("Artifact sha256 must be a 64-character digest")
    if int(manifest["size_bytes"]) <= 0:
        raise RuntimeError("Artifact sizeBytes must be positive")
    return manifest


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Download and validate the pinned SafeRide Gemma 4 E2B .litertlm artifact.",
        epilog=usage_notes(),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR), help="Directory for the verified artifact.")
    parser.add_argument("--manifest", default=str(MANIFEST_PATH), help="Structured tuned-artifact manifest JSON.")
    parser.add_argument("--check-only", action="store_true", help="Only verify the existing local artifact.")
    parser.add_argument(
        "--probe-only",
        action="store_true",
        help="Verify anonymous Hub metadata and one-byte range support without downloading the artifact.",
    )
    parser.add_argument("--replace-invalid", action="store_true", help="Delete an invalid local artifact before download.")
    parser.add_argument("--local-files-only", action="store_true", help="Do not use the network.")
    parser.add_argument("--skip-hub-metadata-check", action="store_true", help="Skip live Hub sibling metadata validation.")
    parser.add_argument("--direct-http", action="store_true", help="Use direct HTTP range-resume instead of hf_hub_download.")
    parser.add_argument("--curl", action="store_true", help="Use curl range-resume instead of hf_hub_download.")
    return parser.parse_args()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(16 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().lower()


def validate_local(path: Path, expected_size: int, expected_sha: str) -> tuple[bool, str]:
    if not path.is_file():
        return False, "missing"
    size = path.stat().st_size
    if size != expected_size:
        return False, f"size mismatch: expected {expected_size}, found {size}"
    digest = sha256_file(path)
    if digest != expected_sha:
        return False, f"sha256 mismatch: expected {expected_sha}, found {digest}"
    return True, "ok"


def import_hub_client():
    try:
        from huggingface_hub import HfApi, hf_hub_download
    except ModuleNotFoundError as error:
        raise RuntimeError(
            "Missing huggingface_hub. Install it with `py -3.12 -m pip install --user huggingface_hub` "
            "or run this script from a Python 3.12 venv that has it installed."
        ) from error
    return HfApi, hf_hub_download


def verify_hub_metadata(api_cls, manifest: dict[str, str | int]) -> None:
    api = api_cls()
    info = api.model_info(
        repo_id=str(manifest["repo_id"]),
        revision=str(manifest["revision"]),
        files_metadata=True,
    )
    sibling = next((entry for entry in info.siblings if entry.rfilename == manifest["filename"]), None)
    if sibling is None:
        raise RuntimeError(f"Hub metadata does not list {manifest['filename']}")

    size = getattr(sibling, "size", None)
    lfs = getattr(sibling, "lfs", None) or {}
    lfs_size = lfs.get("size") if isinstance(lfs, dict) else getattr(lfs, "size", None)
    lfs_sha = lfs.get("sha256") if isinstance(lfs, dict) else getattr(lfs, "sha256", None)

    observed_size = lfs_size or size
    if observed_size != manifest["size_bytes"]:
        raise RuntimeError(
            f"Hub metadata size mismatch for {manifest['filename']}: "
            f"expected {manifest['size_bytes']}, found {observed_size}"
        )
    if str(lfs_sha).lower() != manifest["sha256"]:
        raise RuntimeError(
            f"Hub metadata SHA-256 mismatch for {manifest['filename']}: "
            f"expected {manifest['sha256']}, found {lfs_sha}"
        )


def verify_public_hub_metadata(manifest: dict[str, str | int]) -> None:
    repo_id = quote(str(manifest["repo_id"]), safe="/")
    revision = quote(str(manifest["revision"]), safe="")
    request = urllib.request.Request(
        f"https://huggingface.co/api/models/{repo_id}/revision/{revision}?blobs=true",
        headers={"Accept": "application/json", "User-Agent": "saferide-artifact-probe/1.0"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        info = json.load(response)

    if info.get("sha") != manifest["revision"]:
        raise RuntimeError(
            f"Hub revision mismatch: expected {manifest['revision']}, found {info.get('sha')}"
        )
    sibling = next(
        (entry for entry in info.get("siblings", []) if entry.get("rfilename") == manifest["filename"]),
        None,
    )
    if sibling is None:
        raise RuntimeError(f"Hub metadata does not list {manifest['filename']}")
    lfs = sibling.get("lfs") or {}
    observed_size = lfs.get("size") or sibling.get("size")
    observed_sha = lfs.get("sha256") or lfs.get("oid")
    if observed_size != manifest["size_bytes"]:
        raise RuntimeError(
            f"Hub metadata size mismatch for {manifest['filename']}: "
            f"expected {manifest['size_bytes']}, found {observed_size}"
        )
    if str(observed_sha).lower() != manifest["sha256"]:
        raise RuntimeError(
            f"Hub metadata SHA-256 mismatch for {manifest['filename']}: "
            f"expected {manifest['sha256']}, found {observed_sha}"
        )


def verify_range_support(manifest: dict[str, str | int]) -> None:
    request = urllib.request.Request(
        str(manifest["immutable_url"]),
        headers={
            "Accept-Encoding": "identity",
            "Range": "bytes=0-0",
            "User-Agent": "saferide-artifact-probe/1.0",
        },
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        status = getattr(response, "status", response.getcode())
        content_range = response.headers.get("Content-Range", "")
        first_byte = response.read(2)
    match = re.fullmatch(r"bytes\s+0-0/(\d+)", content_range, flags=re.IGNORECASE)
    if status != 206 or not match:
        raise RuntimeError(
            f"Immutable artifact endpoint must support one-byte range requests; "
            f"received status {status} and Content-Range {content_range!r}"
        )
    if int(match.group(1)) != manifest["size_bytes"]:
        raise RuntimeError(
            f"Range response size mismatch: expected {manifest['size_bytes']}, found {match.group(1)}"
        )
    if len(first_byte) != 1:
        raise RuntimeError(f"Range response returned {len(first_byte)} bytes instead of one")


def direct_http_url(manifest: dict[str, str | int]) -> str:
    separator = "&" if "?" in str(manifest["immutable_url"]) else "?"
    return f"{manifest['immutable_url']}{separator}download=true"


def open_url_with_resume(url: str, start_at: int):
    headers = {"User-Agent": "saferide-artifact-downloader/1.0"}
    if start_at > 0:
        headers["Range"] = f"bytes={start_at}-"
    request = urllib.request.Request(url, headers=headers)
    return urllib.request.urlopen(request, timeout=60)


def direct_download(manifest: dict[str, str | int], target: Path) -> None:
    url = direct_http_url(manifest)
    expected_size = int(manifest["size_bytes"])
    part = target.with_name(f"{target.name}.part")
    part.parent.mkdir(parents=True, exist_ok=True)
    existing_size = part.stat().st_size if part.exists() else 0

    if existing_size >= expected_size:
        part.unlink()
        existing_size = 0

    response = open_url_with_resume(url, existing_size)
    status = getattr(response, "status", response.getcode())
    if existing_size > 0 and status != 206:
        print("Server did not honor byte-range resume; restarting partial download.")
        response.close()
        part.unlink(missing_ok=True)
        existing_size = 0
        response = open_url_with_resume(url, 0)
        status = getattr(response, "status", response.getcode())

    if status not in (200, 206):
        raise RuntimeError(f"Direct HTTP download failed with status {status}")

    mode = "ab" if existing_size > 0 and status == 206 else "wb"
    transferred = existing_size if mode == "ab" else 0
    next_progress = (transferred // (256 * 1024 * 1024) + 1) * 256 * 1024 * 1024
    print(f"Direct HTTP download {'resuming' if mode == 'ab' else 'starting'} at {transferred} bytes.")

    with response, part.open(mode + "") as handle:
        while True:
            chunk = response.read(8 * 1024 * 1024)
            if not chunk:
                break
            handle.write(chunk)
            transferred += len(chunk)
            if transferred >= next_progress:
                print(f"Downloaded {transferred // (1024 * 1024)} MB...")
                next_progress += 256 * 1024 * 1024

    if transferred != expected_size:
        raise RuntimeError(f"Direct HTTP download incomplete: expected {expected_size} bytes, found {transferred} bytes")
    part.replace(target)


def curl_download(manifest: dict[str, str | int], target: Path) -> None:
    curl = shutil.which("curl.exe") or shutil.which("curl")
    if not curl:
        raise RuntimeError("curl is not available on PATH")

    part = target.with_name(f"{target.name}.part")
    part.parent.mkdir(parents=True, exist_ok=True)
    url = direct_http_url(manifest)
    command = [
        curl,
        "--location",
        "--fail",
        "--retry",
        "20",
        "--retry-delay",
        "5",
        "--retry-connrefused",
        "--continue-at",
        "-",
        "--speed-time",
        "120",
        "--speed-limit",
        "1",
        "--output",
        str(part),
        url,
    ]
    result = subprocess.run(command, check=False)
    if result.returncode != 0:
        raise RuntimeError(f"curl download failed with exit code {result.returncode}")
    actual_size = part.stat().st_size if part.exists() else 0
    if actual_size != int(manifest["size_bytes"]):
        raise RuntimeError(f"curl download incomplete: expected {manifest['size_bytes']} bytes, found {actual_size} bytes")
    part.replace(target)


def main() -> int:
    args = parse_args()
    manifest = parse_manifest(Path(args.manifest).expanduser().resolve())
    output_dir = Path(args.output_dir).expanduser().resolve()
    target = output_dir / str(manifest["filename"])

    print("SafeRide Gemma 4 E2B Hugging Face artifact acquisition")
    print(f"Repo: {manifest['repo_id']}")
    print(f"Revision: {manifest['revision']}")
    print(f"File: {manifest['filename']}")
    print(f"Expected size: {manifest['size_bytes']} bytes")
    print(f"Expected SHA-256: {manifest['sha256']}")
    print(f"Target: {target}")

    if args.probe_only:
        if args.local_files_only or args.check_only or args.curl or args.direct_http:
            raise RuntimeError("--probe-only cannot be combined with download or local-file options")
        verify_public_hub_metadata(manifest)
        verify_range_support(manifest)
        print("Anonymous immutable revision, size, SHA-256 metadata, and byte-range support verified.")
        return 0

    valid, reason = validate_local(target, int(manifest["size_bytes"]), str(manifest["sha256"]))
    if valid:
        print("Local artifact already verified.")
        return 0

    if target.exists() and args.replace_invalid:
        print(f"Removing invalid local artifact: {reason}")
        target.unlink()
    elif target.exists() and not args.check_only:
        raise RuntimeError(f"Refusing to overwrite invalid local artifact without --replace-invalid ({reason}).")

    if args.check_only:
        raise RuntimeError(f"Local artifact is not verified: {reason}")

    output_dir.mkdir(parents=True, exist_ok=True)
    if args.curl:
        if args.local_files_only:
            raise RuntimeError("--curl cannot be combined with --local-files-only")
        if not args.skip_hub_metadata_check:
            verify_public_hub_metadata(manifest)
        curl_download(manifest, target)
    elif args.direct_http:
        if args.local_files_only:
            raise RuntimeError("--direct-http cannot be combined with --local-files-only")
        if not args.skip_hub_metadata_check:
            verify_public_hub_metadata(manifest)
        direct_download(manifest, target)
    else:
        HfApi, hf_hub_download = import_hub_client()
        if not args.skip_hub_metadata_check:
            verify_hub_metadata(HfApi, manifest)
        downloaded = Path(
            hf_hub_download(
                repo_id=str(manifest["repo_id"]),
                filename=str(manifest["filename"]),
                revision=str(manifest["revision"]),
                local_dir=str(output_dir),
                local_files_only=args.local_files_only,
            )
        )
        if downloaded.resolve() != target.resolve():
            shutil.copyfile(downloaded, target)

    valid, reason = validate_local(target, int(manifest["size_bytes"]), str(manifest["sha256"]))
    if not valid:
        raise RuntimeError(f"Downloaded artifact failed validation: {reason}")

    print("Artifact verified. Use the preseed utility for a deliberate Android device install.")
    print(f"Verified artifact: {target}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:  # noqa: BLE001 - CLI should report concise failure.
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
