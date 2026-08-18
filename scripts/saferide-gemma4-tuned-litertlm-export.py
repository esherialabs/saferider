#!/usr/bin/env python
"""Create a SafeRide tuned Gemma 4 E2B LiteRT-LM export artifact.

This is a private evidence utility for Step 5. It performs the only sequence
that can legitimately create a phone-runnable tuned artifact:

1. Download the pinned Hugging Face base checkpoint.
2. Download the pinned SafeRide PEFT/LoRA adapter.
3. Merge the adapter into the base checkpoint with PEFT.
4. Export the merged checkpoint through LiteRT Torch export_hf.
5. Package the result as a complete .litertlm file, hash it, and optionally
   upload it to a private Hugging Face repo.

Model files, raw logs, and export outputs belong under .ai-smoke/ or another
ignored private evidence directory. Do not commit generated artifacts.
"""

from __future__ import annotations

import argparse
import contextlib
import datetime as dt
import hashlib
import importlib.metadata
import json
import os
import shutil
import subprocess
import sys
import time
import traceback
from pathlib import Path
from typing import Any, Iterator


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT_ROOT = REPO_ROOT / ".ai-smoke" / "gemma4-tuned-mobile-export" / "runs"

DEFAULT_BASE_MODEL = "google/gemma-4-E2B-it"
DEFAULT_BASE_REVISION = "70af34e20bd4b7a91f0de6b22675850c43922a03"
DEFAULT_ADAPTER_REPO = "V-ince-18/saferide-gemma-4-e2b-lora"
DEFAULT_ADAPTER_REVISION = "e6d135a385352749995b988691c037e88b42a230"
DEFAULT_ADAPTER_SAFETENSORS_SHA256 = "8653e8ed65bfdd9eb20bbccbe95e93c1fe27b42199c5748316bde8cd27625714"
DEFAULT_TRAINING_RUN_ID = "saferide-gemma4-e2b-colab-v03-mitigation-lora-480step-20260704"
DEFAULT_EVAL_RUN_ID = "saferide-gemma4-e2b-v03-adapter-full-20260704"
DEFAULT_DATA_REGISTER_ID = "docs/security/saferide-gemma4-colab-input-register.synthetic-v0.3.candidate.json"
DEFAULT_SAFETY_REPORT = "docs/qa/saferide-gemma4-e2b-v03-adapter-scoring-evidence-2026-07-10.md"
DEFAULT_SAFETY_SUMMARY_ID = "saferide-gemma4-e2b-v03-adapter-safety-2026-07-30.1"
DEFAULT_PRIVATE_EVIDENCE_REPO = "V-ince-18/saferide-gemma-4-e2b-eval-evidence"
DEFAULT_PRIVATE_EVIDENCE_REPO_SHA = "f1ecd6fe4c293c2250fa4096fe923d14c123d4f0"
DEFAULT_ANDROID_PROOF = "docs/qa/saferide-gemma4-e2b-physical-android-runtime-smoke-2026-07-13.md"
DEFAULT_ROLLBACK_TARGET = "fail-closed:no-local-ai"
DEFAULT_ARTIFACT_NAME = "saferide-gemma4-e2b-v03-mitigation.litertlm"
CONTROL_ID = "saferide-tuned-artifact-controls-2026-08-10.1"
CONTROL_SHA256 = "ee70c852452f06f28e58294040f47a3b2b99fb09c2cc896d82ae8895c45e6deb"

EXPORT_PROFILES = (
    "default",
    "low-memory-probe",
    "fp16-source-probe",
    "fp16-source-only-probe",
    "fp16-source-ultra-low-memory-probe",
)
SOURCE_LOAD_DTYPES = ("float32", "float16", "bfloat16")

PACKAGE_NAMES = [
    "torch",
    "torchvision",
    "transformers",
    "peft",
    "accelerate",
    "safetensors",
    "huggingface_hub",
    "litert-torch",
    "litert-torch-nightly",
    "litert-lm",
    "litert-lm-builder",
    "ai-edge-litert-nightly",
    "ai-edge-quantizer-nightly",
    "tensorflow",
    "tf-nightly",
]


def parse_int_list(value: str) -> list[int]:
    values = [item.strip() for item in value.split(",") if item.strip()]
    if not values:
        raise argparse.ArgumentTypeError("expected at least one integer")
    parsed: list[int] = []
    for item in values:
        try:
            parsed.append(int(item))
        except ValueError as error:
            raise argparse.ArgumentTypeError(f"invalid integer: {item}") from error
    return parsed


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Merge the SafeRide v0.3 PEFT adapter and export a tuned .litertlm artifact.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Colab package baseline:\n"
            "  python -m pip install -r https://raw.githubusercontent.com/google-ai-edge/litert-torch/main/requirements.txt\n"
            "  python -m pip install --pre litert-torch-nightly\n"
            "  python -m pip install --upgrade peft accelerate huggingface_hub\n\n"
            "Private full run:\n"
            "  python scripts/saferide-gemma4-tuned-litertlm-export.py --trust-remote-code --upload-repo <private-hf-repo> --upload\n"
        ),
    )
    parser.add_argument("--run-id", default=f"saferide-gemma4-e2b-v03-tuned-litertlm-{dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')}")
    parser.add_argument("--output-root", default=str(DEFAULT_OUTPUT_ROOT))
    parser.add_argument("--base-model-id", default=DEFAULT_BASE_MODEL)
    parser.add_argument("--base-revision", default=DEFAULT_BASE_REVISION)
    parser.add_argument("--adapter-repo", default=DEFAULT_ADAPTER_REPO)
    parser.add_argument("--adapter-revision", default=DEFAULT_ADAPTER_REVISION)
    parser.add_argument("--adapter-safetensors-sha256", default=DEFAULT_ADAPTER_SAFETENSORS_SHA256)
    parser.add_argument("--training-run-id", default=DEFAULT_TRAINING_RUN_ID)
    parser.add_argument("--eval-run-id", default=DEFAULT_EVAL_RUN_ID)
    parser.add_argument("--data-register-id", default=DEFAULT_DATA_REGISTER_ID)
    parser.add_argument("--artifact-name", default=DEFAULT_ARTIFACT_NAME)
    parser.add_argument("--safety-report", default=DEFAULT_SAFETY_REPORT)
    parser.add_argument("--safety-summary-id", default=DEFAULT_SAFETY_SUMMARY_ID)
    parser.add_argument("--private-evidence-repo", default=DEFAULT_PRIVATE_EVIDENCE_REPO)
    parser.add_argument("--private-evidence-repo-sha", default=DEFAULT_PRIVATE_EVIDENCE_REPO_SHA)
    parser.add_argument("--android-proof", default=DEFAULT_ANDROID_PROOF)
    parser.add_argument("--rollback-target", default=DEFAULT_ROLLBACK_TARGET)
    parser.add_argument(
        "--immutable-artifact-uri",
        help="Credential-free immutable controlled-storage URI that will identify the exact produced artifact.",
    )
    parser.add_argument(
        "--candidate-min-ram-gb",
        type=float,
        help="Conservative unverified RAM floor for device QA; required for a produced manifest.",
    )
    parser.add_argument("--storage-buffer-bytes", type=int, default=536_870_912)
    parser.add_argument("--merge-only", action="store_true", help="Stop after writing the merged Transformers checkpoint.")
    parser.add_argument("--export-only", action="store_true", help="Use an existing --merged-dir and skip PEFT merge.")
    parser.add_argument("--merged-dir", help="Existing merged checkpoint directory for --export-only.")
    parser.add_argument("--local-files-only", action="store_true", help="Do not download from Hugging Face.")
    parser.add_argument("--trust-remote-code", action="store_true")
    parser.add_argument("--keep-temporary-files", action="store_true")
    parser.add_argument(
        "--export-profile",
        choices=EXPORT_PROFILES,
        default="default",
        help=(
            "Named export profile. low-memory-probe reduces cache/prefill for Colab diagnostics; "
            "fp16-source-probe applies source-load fp16 plus LiteRT experimental fp16; "
            "fp16-source-only-probe applies only source-load fp16; "
            "fp16-source-ultra-low-memory-probe further reduces cache/prefill graph size."
        ),
    )
    parser.add_argument("--prefill-lengths", type=parse_int_list, default=[128], help="Comma-separated LiteRT prefill lengths.")
    parser.add_argument("--cache-length", type=int, default=2048)
    parser.add_argument("--quantization-recipe", default="dynamic_wi8_afp32")
    parser.add_argument("--split-cache", action="store_true")
    parser.add_argument(
        "--disable-externalize-embedder",
        action="store_true",
        help="Disable external embedder export. Do not use for Gemma 4 unless upstream tooling changes.",
    )
    parser.add_argument(
        "--source-load-dtype",
        choices=SOURCE_LOAD_DTYPES,
        default="float32",
        help=(
            "Source model dtype for the LiteRT Torch load_model stage. The upstream exporter defaults to float32. "
            "Non-float32 values are experimental diagnostics and require physical Android proof before any claim."
        ),
    )
    parser.add_argument("--experimental-use-fp16", action="store_true")
    parser.add_argument("--sampler-temperature", type=float, default=0.2)
    parser.add_argument("--sampler-top-p", type=float, default=0.9)
    parser.add_argument("--sampler-top-k", type=int, default=10)
    parser.add_argument("--upload-repo", help="Private Hugging Face repo for produced artifact and metadata.")
    parser.add_argument("--upload", action="store_true", help="Upload produced public-safe metadata and artifact to --upload-repo.")
    parser.add_argument("--check", action="store_true", help="Check imports, Hugging Face access, and config without downloading weights.")
    parser.add_argument(
        "--offline-contract-check",
        action="store_true",
        help="Validate the repository export contract without network, model access, imports, or output creation.",
    )
    return parser.parse_args()


def apply_export_profile(args: argparse.Namespace) -> None:
    if args.export_profile == "low-memory-probe":
        args.cache_length = 512
        args.prefill_lengths = [32]
    elif args.export_profile == "fp16-source-probe":
        args.cache_length = 512
        args.prefill_lengths = [32]
        args.source_load_dtype = "float16"
        args.experimental_use_fp16 = True
    elif args.export_profile == "fp16-source-only-probe":
        args.cache_length = 512
        args.prefill_lengths = [32]
        args.source_load_dtype = "float16"
        args.experimental_use_fp16 = False
    elif args.export_profile == "fp16-source-ultra-low-memory-probe":
        args.cache_length = 128
        args.prefill_lengths = [16]
        args.source_load_dtype = "float16"
        args.experimental_use_fp16 = False


def rel(path: Path) -> str:
    try:
        return str(path.resolve().relative_to(REPO_ROOT)).replace("\\", "/")
    except ValueError:
        return str(path.resolve()).replace("\\", "/")


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True), encoding="utf-8")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(16 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().lower()


def package_versions() -> dict[str, str]:
    versions: dict[str, str] = {}
    for package_name in PACKAGE_NAMES:
        try:
            versions[package_name] = importlib.metadata.version(package_name)
        except importlib.metadata.PackageNotFoundError:
            versions[package_name] = "not-installed"
    return versions


def repository_revision() -> str:
    result = subprocess.run(
        ["git", "rev-parse", "HEAD"],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    revision = result.stdout.strip().lower()
    if len(revision) != 40 or any(character not in "0123456789abcdef" for character in revision):
        raise RuntimeError("Repository revision is not a full Git SHA.")
    return revision


def validate_immutable_artifact_uri(value: str | None) -> str:
    if not value or "://" not in value or any(character.isspace() for character in value):
        raise RuntimeError("--immutable-artifact-uri must be a credential-free immutable controlled-storage URI")
    if "?" in value or "#" in value or "@" in value.split("://", 1)[1].split("/", 1)[0]:
        raise RuntimeError("--immutable-artifact-uri must not contain credentials, query parameters, or fragments")
    return value


def tokenizer_metadata(merged_dir: Path, run_dir: Path) -> tuple[str, str]:
    candidate_names = {
        "tokenizer.json",
        "tokenizer.model",
        "tokenizer_config.json",
        "special_tokens_map.json",
        "added_tokens.json",
        "processor_config.json",
    }
    files = []
    for candidate in sorted(merged_dir.rglob("*")):
        if candidate.is_file() and candidate.name in candidate_names:
            files.append({
                "fileName": candidate.name,
                "sizeBytes": candidate.stat().st_size,
                "sha256": sha256_file(candidate),
            })
    if not files:
        raise RuntimeError("Merged checkpoint contains no tokenizer metadata files.")
    serialized = json.dumps(files, separators=(",", ":"), sort_keys=True).encode("utf-8")
    digest = hashlib.sha256(serialized).hexdigest()
    inventory_path = run_dir / "tokenizer-file-inventory.json"
    write_json(inventory_path, {
        "schema": "com.saferide.tokenizer-file-inventory",
        "schemaVersion": 1,
        "files": files,
        "aggregateSha256": digest,
    })
    return digest, f"controlled-run://{run_dir.name}/tokenizer-file-inventory.json"


def write_artifact_inventory(run_dir: Path, artifact: Path, immutable_uri: str) -> str:
    inventory_path = run_dir / "artifact-file-inventory.json"
    files = [{"path": artifact.name, "sha256": sha256_file(artifact)}]
    file_manifest_sha256 = hashlib.sha256(
        json.dumps(files, separators=(",", ":"), sort_keys=True).encode("utf-8"),
    ).hexdigest()
    write_json(inventory_path, {
        "schema": "com.saferide.ai.artifact-file-inventory",
        "schemaVersion": 1,
        "artifactId": immutable_uri,
        "immutableRevision": sha256_file(artifact),
        "fileManifestSha256": file_manifest_sha256,
        "files": files,
    })
    return f"controlled-run://{run_dir.name}/artifact-file-inventory.json"


def path_size_bytes(path: Path) -> int | None:
    if not path.exists():
        return None
    if path.is_file():
        return path.stat().st_size
    total = 0
    for child in path.rglob("*"):
        if child.is_file():
            total += child.stat().st_size
    return total


def runtime_diagnostics(paths: dict[str, Path] | None = None) -> dict[str, Any]:
    diagnostics: dict[str, Any] = {
        "createdAt": now_iso(),
        "python": sys.version.split()[0],
        "platform": sys.platform,
    }
    try:
        disk = shutil.disk_usage(Path.cwd())
        diagnostics["disk"] = {
            "cwd": str(Path.cwd()),
            "totalBytes": disk.total,
            "usedBytes": disk.used,
            "freeBytes": disk.free,
        }
    except Exception as error:  # noqa: BLE001 - diagnostics must be best effort.
        diagnostics["diskError"] = f"{type(error).__name__}: {error}"

    try:
        import psutil  # type: ignore

        memory = psutil.virtual_memory()
        diagnostics["systemMemory"] = {
            "totalBytes": int(memory.total),
            "availableBytes": int(memory.available),
            "usedBytes": int(memory.used),
            "percent": float(memory.percent),
        }
    except Exception as error:  # noqa: BLE001
        diagnostics["systemMemoryError"] = f"{type(error).__name__}: {error}"

    try:
        import torch  # type: ignore

        diagnostics["torch"] = {
            "version": getattr(torch, "__version__", "unknown"),
            "cudaAvailable": bool(torch.cuda.is_available()),
            "cudaDeviceCount": int(torch.cuda.device_count()) if torch.cuda.is_available() else 0,
        }
        if torch.cuda.is_available():
            devices = []
            for index in range(torch.cuda.device_count()):
                free_bytes, total_bytes = torch.cuda.mem_get_info(index)
                devices.append(
                    {
                        "index": index,
                        "name": torch.cuda.get_device_name(index),
                        "totalBytes": int(total_bytes),
                        "freeBytes": int(free_bytes),
                        "allocatedBytes": int(torch.cuda.memory_allocated(index)),
                        "reservedBytes": int(torch.cuda.memory_reserved(index)),
                    },
                )
            diagnostics["cudaDevices"] = devices
    except Exception as error:  # noqa: BLE001
        diagnostics["torchDiagnosticsError"] = f"{type(error).__name__}: {error}"

    try:
        result = subprocess.run(
            [
                "nvidia-smi",
                "--query-gpu=name,memory.total,memory.used,memory.free",
                "--format=csv,noheader,nounits",
            ],
            check=False,
            capture_output=True,
            text=True,
            timeout=15,
        )
        diagnostics["nvidiaSmi"] = {
            "returnCode": result.returncode,
            "stdout": result.stdout.strip(),
            "stderr": result.stderr.strip(),
        }
    except Exception as error:  # noqa: BLE001
        diagnostics["nvidiaSmiError"] = f"{type(error).__name__}: {error}"

    if paths:
        diagnostics["paths"] = {
            name: {
                "path": rel(path),
                "exists": path.exists(),
                "sizeBytes": path_size_bytes(path),
            }
            for name, path in paths.items()
        }
    return diagnostics


@contextlib.contextmanager
def source_load_dtype_patch(dtype_name: str) -> Iterator[None]:
    if dtype_name == "float32":
        yield
        return

    try:
        import torch  # type: ignore
        from litert_torch.generative.export_hf.core import export_lib  # type: ignore
    except Exception as error:  # noqa: BLE001
        raise RuntimeError(
            f"Cannot apply experimental source-load dtype patch {dtype_name}: {type(error).__name__}: {error}",
        ) from error

    dtype = {
        "float16": torch.float16,
        "bfloat16": torch.bfloat16,
    }[dtype_name]

    patch_targets = [
        (export_lib.transformers.AutoConfig, "from_pretrained", "dtype"),
        (export_lib.transformers.AutoModelForCausalLM, "from_pretrained", "torch_dtype"),
        (export_lib.transformers.AutoModelForCausalLM, "from_config", "torch_dtype"),
    ]
    if hasattr(export_lib.transformers, "AutoModelForImageTextToText"):
        patch_targets.extend(
            [
                (export_lib.transformers.AutoModelForImageTextToText, "from_pretrained", "torch_dtype"),
                (export_lib.transformers.AutoModelForImageTextToText, "from_config", "torch_dtype"),
            ],
        )

    originals = []

    def wrap(original: Any, keyword: str):
        def patched(*call_args: Any, **call_kwargs: Any):
            if call_kwargs.get(keyword) is torch.float32:
                call_kwargs[keyword] = dtype
            return original(*call_args, **call_kwargs)

        return patched

    try:
        for owner, attr, keyword in patch_targets:
            original = getattr(owner, attr)
            originals.append((owner, attr, original))
            setattr(owner, attr, wrap(original, keyword))
        yield
    finally:
        for owner, attr, original in reversed(originals):
            setattr(owner, attr, original)


def import_hub():
    try:
        from huggingface_hub import HfApi, snapshot_download
    except ModuleNotFoundError as error:
        raise RuntimeError("Missing huggingface_hub. Install it before running this export.") from error
    return HfApi, snapshot_download


def import_merge_deps():
    try:
        import torch  # type: ignore
        from peft import PeftModel  # type: ignore
        from transformers import AutoModelForCausalLM, AutoProcessor, AutoTokenizer  # type: ignore
    except Exception as error:  # noqa: BLE001 - dependency checks must preserve exact import blockers.
        raise RuntimeError(
            "Merge dependency import failed. Install compatible torch, transformers, peft, "
            "accelerate, safetensors, and huggingface_hub versions. "
            f"Observed error: {type(error).__name__}: {error}",
        ) from error
    return {
        "torch": torch,
        "PeftModel": PeftModel,
        "AutoModelForCausalLM": AutoModelForCausalLM,
        "AutoProcessor": AutoProcessor,
        "AutoTokenizer": AutoTokenizer,
    }


def import_export_deps():
    try:
        from litert_torch.generative.export_hf import export as hf_export  # type: ignore
    except Exception as error:  # noqa: BLE001 - dependency checks must preserve exact import blockers.
        raise RuntimeError(
            "LiteRT Torch export_hf import failed. In Colab install a compatible nightly stack:\n"
            "python -m pip install -r https://raw.githubusercontent.com/google-ai-edge/litert-torch/main/requirements.txt\n"
            "python -m pip install --pre litert-torch-nightly\n"
            "python -m pip install --upgrade peft accelerate huggingface_hub\n"
            f"Observed error: {type(error).__name__}: {error}",
        ) from error
    export_fn = getattr(hf_export, "export", hf_export)
    if not callable(export_fn):
        raise RuntimeError(
            "LiteRT Torch export_hf import succeeded, but no callable export function was found. "
            f"Observed object type: {type(hf_export).__name__}",
        )
    return export_fn


def hf_token_configured() -> bool:
    return bool(os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_HUB_TOKEN"))


def check_hf_access(args: argparse.Namespace) -> dict[str, Any]:
    HfApi, _ = import_hub()
    api = HfApi()
    base_info = api.model_info(args.base_model_id, revision=args.base_revision, files_metadata=True)
    adapter_info = api.model_info(args.adapter_repo, revision=args.adapter_revision, files_metadata=True)
    return {
        "base": {
            "repo": args.base_model_id,
            "revision": args.base_revision,
            "observedSha": base_info.sha,
            "safetensorsFiles": sum(1 for item in base_info.siblings if item.rfilename.endswith(".safetensors")),
        },
        "adapter": {
            "repo": args.adapter_repo,
            "revision": args.adapter_revision,
            "observedSha": adapter_info.sha,
            "files": len(adapter_info.siblings),
            "hasAdapterSafetensors": any(item.rfilename == "adapter_model.safetensors" for item in adapter_info.siblings),
        },
    }


def download_adapter(args: argparse.Namespace, run_dir: Path) -> Path:
    _, snapshot_download = import_hub()
    adapter_dir = run_dir / "adapter-snapshot"
    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_HUB_TOKEN")
    if args.local_files_only:
        cached_snapshot = Path(
            snapshot_download(
                repo_id=args.adapter_repo,
                revision=args.adapter_revision,
                local_files_only=True,
                token=token,
            ),
        ).resolve()
        if adapter_dir.exists():
            raise RuntimeError(f"Offline adapter destination already exists: {adapter_dir}")
        shutil.copytree(
            cached_snapshot,
            adapter_dir,
            symlinks=False,
            ignore=shutil.ignore_patterns(".cache"),
        )
        adapter_dir.chmod(0o700)
        for copied in adapter_dir.rglob("*"):
            if copied.is_file():
                copied.chmod(0o600)
        adapter_dir = adapter_dir.resolve()
    else:
        downloaded = snapshot_download(
            repo_id=args.adapter_repo,
            revision=args.adapter_revision,
            local_dir=str(adapter_dir),
            local_files_only=False,
            token=token,
        )
        adapter_dir = Path(downloaded).resolve()
    adapter_model = adapter_dir / "adapter_model.safetensors"
    if not adapter_model.is_file():
        raise RuntimeError(f"Adapter snapshot does not contain adapter_model.safetensors: {adapter_dir}")
    observed = sha256_file(adapter_model)
    if observed != args.adapter_safetensors_sha256.lower():
        raise RuntimeError(
            "Adapter SHA-256 mismatch for adapter_model.safetensors: "
            f"expected {args.adapter_safetensors_sha256.lower()}, got {observed}",
        )
    return adapter_dir


def save_tokenizer_and_processor(deps: dict[str, Any], args: argparse.Namespace, adapter_dir: Path, merged_dir: Path) -> None:
    tokenizer_source = adapter_dir / "tokenizer" if (adapter_dir / "tokenizer").is_dir() else args.base_model_id
    tokenizer_kwargs: dict[str, Any] = {
        "local_files_only": bool(args.local_files_only and tokenizer_source == args.base_model_id),
        "trust_remote_code": args.trust_remote_code,
    }
    if tokenizer_source == args.base_model_id:
        tokenizer_kwargs["revision"] = args.base_revision
    tokenizer = deps["AutoTokenizer"].from_pretrained(str(tokenizer_source), **tokenizer_kwargs)
    tokenizer.save_pretrained(merged_dir)

    try:
        processor = deps["AutoProcessor"].from_pretrained(
            args.base_model_id,
            revision=args.base_revision,
            local_files_only=args.local_files_only,
            trust_remote_code=args.trust_remote_code,
        )
        processor.save_pretrained(merged_dir)
    except Exception as error:  # noqa: BLE001 - processor is optional for text-only export.
        print(f"processor_save_warning {type(error).__name__}")


def merge_adapter(args: argparse.Namespace, run_dir: Path) -> tuple[Path, dict[str, Any]]:
    deps = import_merge_deps()
    torch = deps["torch"]
    adapter_dir = download_adapter(args, run_dir)
    merged_dir = run_dir / "merged-transformers"
    merged_dir.mkdir(parents=True, exist_ok=True)

    cuda_available = bool(torch.cuda.is_available())
    dtype = torch.float16 if cuda_available else torch.float32
    model_kwargs: dict[str, Any] = {
        "revision": args.base_revision,
        "local_files_only": args.local_files_only,
        "low_cpu_mem_usage": True,
        "trust_remote_code": args.trust_remote_code,
        "device_map": "auto" if cuda_available else None,
        "dtype": dtype,
    }
    model_kwargs = {key: value for key, value in model_kwargs.items() if value is not None}

    try:
        base = deps["AutoModelForCausalLM"].from_pretrained(args.base_model_id, **model_kwargs)
    except TypeError:
        dtype_value = model_kwargs.pop("dtype")
        model_kwargs["torch_dtype"] = dtype_value
        base = deps["AutoModelForCausalLM"].from_pretrained(args.base_model_id, **model_kwargs)

    peft_model = deps["PeftModel"].from_pretrained(
        base,
        str(adapter_dir),
        local_files_only=True,
    )
    merged = peft_model.merge_and_unload(safe_merge=True)
    merged.save_pretrained(merged_dir, safe_serialization=True, max_shard_size="5GB")
    save_tokenizer_and_processor(deps, args, adapter_dir, merged_dir)

    merged_files = []
    for path in sorted(merged_dir.rglob("*")):
        if path.is_file():
            merged_files.append({"path": rel(path), "sizeBytes": path.stat().st_size, "sha256": sha256_file(path)})

    return merged_dir, {
        "adapterDir": rel(adapter_dir),
        "mergedDir": rel(merged_dir),
        "cudaAvailable": cuda_available,
        "mergedFiles": merged_files,
    }


def export_litertlm(args: argparse.Namespace, run_dir: Path, merged_dir: Path) -> tuple[Path, dict[str, Any]]:
    hf_export = import_export_deps()
    export_dir = run_dir / "litert-export"
    export_dir.mkdir(parents=True, exist_ok=True)

    export_start = {
        "schema": "com.saferide.gemma4.tuned-litertlm-export-start",
        "createdAt": now_iso(),
        "exportProfile": args.export_profile,
        "sourceLoadDtype": args.source_load_dtype,
        "experimentalSourceLoadPatch": args.source_load_dtype != "float32",
        "cacheLength": args.cache_length,
        "prefillLengths": args.prefill_lengths,
        "quantizationRecipe": args.quantization_recipe,
        "splitCache": args.split_cache,
        "externalizeEmbedder": not args.disable_externalize_embedder,
        "experimentalUseFp16": args.experimental_use_fp16,
        "diagnostics": runtime_diagnostics(
            {
                "runDir": run_dir,
                "mergedDir": merged_dir,
                "exportDir": export_dir,
            },
        ),
    }
    write_json(run_dir / "export-start.json", export_start)
    print(f"export_profile {args.export_profile}")
    print(f"source_load_dtype {args.source_load_dtype}")
    print(f"cache_length {args.cache_length}")
    print(f"prefill_lengths {args.prefill_lengths}")
    if args.source_load_dtype != "float32":
        print("experimental_source_load_patch True")

    started = time.perf_counter()
    with source_load_dtype_patch(args.source_load_dtype):
        hf_export(
            model=str(merged_dir),
            output_dir=str(export_dir),
            task="text_generation",
            keep_temporary_files=args.keep_temporary_files,
            trust_remote_code=args.trust_remote_code,
            prefill_lengths=args.prefill_lengths,
            cache_length=args.cache_length,
            quantization_recipe=args.quantization_recipe,
            split_cache=args.split_cache,
            externalize_embedder=not args.disable_externalize_embedder,
            bundle_litert_lm=True,
            export_vision_encoder=False,
            export_audio_encoder=False,
            use_jinja_template=True,
            sampler_temperature=args.sampler_temperature,
            sampler_top_p=args.sampler_top_p,
            sampler_top_k=args.sampler_top_k,
            experimental_use_fp16=args.experimental_use_fp16,
        )
    elapsed_ms = int((time.perf_counter() - started) * 1000)

    produced = export_dir / "model.litertlm"
    if not produced.is_file():
        candidates = sorted(export_dir.rglob("*.litertlm"))
        if candidates:
            produced = candidates[0]
        else:
            raise RuntimeError(f"LiteRT export completed but no .litertlm file was found under {export_dir}")

    artifact = run_dir / args.artifact_name
    if produced.resolve() != artifact.resolve():
        shutil.copyfile(produced, artifact)
    digest = sha256_file(artifact)
    size = artifact.stat().st_size
    return artifact, {
        "exportDir": rel(export_dir),
        "sourceLitertlm": rel(produced),
        "artifactPath": rel(artifact),
        "artifactSha256": digest,
        "artifactSizeBytes": size,
        "elapsedMs": elapsed_ms,
    }


def upload_private_artifact(args: argparse.Namespace, run_dir: Path, artifact: Path, evidence_manifest: Path) -> dict[str, Any]:
    if not args.upload_repo:
        raise RuntimeError("--upload requires --upload-repo")
    if os.environ.get("HF_UPLOAD_EXECUTE") != "true":
        raise RuntimeError("Refusing upload unless HF_UPLOAD_EXECUTE=true is set.")

    HfApi, _ = import_hub()
    api = HfApi()
    api.create_repo(args.upload_repo, repo_type="model", private=True, exist_ok=True)
    path_prefix = f"artifacts/{args.run_id}"
    uploaded = []
    for local_path, repo_path in [
        (artifact, f"{path_prefix}/{artifact.name}"),
        (evidence_manifest, f"{path_prefix}/evidence-manifest.json"),
        (run_dir / "metadata.json", f"{path_prefix}/metadata.json"),
    ]:
        api.upload_file(
            repo_id=args.upload_repo,
            repo_type="model",
            path_or_fileobj=str(local_path),
            path_in_repo=repo_path,
            commit_message=f"Add SafeRide v0.3 tuned LiteRT-LM artifact evidence for {args.run_id}",
        )
        uploaded.append(repo_path)
    info = api.model_info(args.upload_repo, repo_type="model")
    return {"repo": args.upload_repo, "private": info.private, "repoSha": info.sha, "uploadedPaths": uploaded}


def base_metadata(args: argparse.Namespace, run_dir: Path) -> dict[str, Any]:
    return {
        "schema": "com.saferide.gemma4.tuned-litertlm-export",
        "createdAt": now_iso(),
        "issue": "ESH-4184",
        "runId": args.run_id,
        "outputRoot": rel(run_dir),
        "baseModel": args.base_model_id,
        "baseRevision": args.base_revision,
        "adapterModel": args.adapter_repo,
        "adapterRevision": args.adapter_revision,
        "adapterRepoSha": args.adapter_revision,
        "trainingRunId": args.training_run_id,
        "evalRunId": args.eval_run_id,
        "dataRegisterId": args.data_register_id,
        "safetyReport": args.safety_report,
        "androidProof": args.android_proof,
        "rollbackTargetManifestId": args.rollback_target,
        "exportConfig": {
            "exportProfile": args.export_profile,
            "sourceLoadDtype": args.source_load_dtype,
            "experimentalSourceLoadPatch": args.source_load_dtype != "float32",
            "cacheLength": args.cache_length,
            "prefillLengths": args.prefill_lengths,
            "quantizationRecipe": args.quantization_recipe,
            "splitCache": args.split_cache,
            "externalizeEmbedder": not args.disable_externalize_embedder,
            "experimentalUseFp16": args.experimental_use_fp16,
        },
        "privacy": {
            "rawPromptLoggingToStdout": False,
            "rawCompletionLoggingToStdout": False,
            "survivorDataUsed": False,
            "outputStorage": "ignored private evidence storage",
        },
        "environment": {
            "python": sys.version.split()[0],
            "platform": sys.platform,
            "hfTokenConfigured": hf_token_configured(),
            "packages": package_versions(),
        },
    }


def write_success_manifest(
    args: argparse.Namespace,
    run_dir: Path,
    merged_dir: Path,
    artifact: Path,
    artifact_info: dict[str, Any],
) -> Path:
    immutable_uri = validate_immutable_artifact_uri(args.immutable_artifact_uri)
    tokenizer_sha256, _tokenizer_inventory_ref = tokenizer_metadata(merged_dir, run_dir)
    artifact_inventory_ref = write_artifact_inventory(run_dir, artifact, immutable_uri)
    produced_at = now_iso()
    manifest = {
        "schema": "com.saferide.tuned-mobile-artifact-manifest",
        "schemaVersion": 2,
        "status": "artifact-produced",
        "manifestId": f"{args.run_id}.artifact-produced",
        "modelId": "saferide/gemma-4-e2b-tuned-litertlm",
        "stateHistory": [
            {
                "state": "training-complete",
                "enteredAt": "2026-07-04T00:00:00.000Z",
                "evidenceRefs": [args.training_run_id],
            },
            {
                "state": "adapter-evaluated",
                "enteredAt": "2026-07-10T00:00:00.000Z",
                "evidenceRefs": [args.safety_summary_id],
            },
            {
                "state": "export-blocked",
                "enteredAt": "2026-07-14T00:00:00.000Z",
                "evidenceRefs": ["docs/qa/saferide-gemma4-e2b-v03-tuned-mobile-artifact-path-2026-07-14.md"],
            },
            {
                "state": "artifact-produced",
                "enteredAt": produced_at,
                "evidenceRefs": [f"controlled-run://{args.run_id}/metadata.json"],
            },
        ],
        "adapterModel": args.adapter_repo,
        "adapterRevision": args.adapter_revision,
        "adapterRepoSha": args.adapter_revision,
        "trainingRunId": args.training_run_id,
        "dataRegisterId": args.data_register_id,
        "baseModel": args.base_model_id,
        "baseRevision": args.base_revision,
        "exportDecisionDoc": "docs/qa/saferide-gemma4-e2b-v03-tuned-mobile-artifact-path-2026-07-14.md",
        "exportRunner": "scripts/saferide-gemma4-tuned-litertlm-export.py",
        "exportRunbook": "docs/qa/saferide-gemma4-e2b-v03-tuned-litertlm-colab-export-runbook-2026-07-14.md",
        "exportPath": {
            "decision": "merge-peft-then-export-litertlm",
            "requiredSteps": [
                "Verify this produced manifest with scripts/saferide-tuned-artifact-check.mjs.",
                "Obtain organization artifact attestation bound to the exact artifact SHA-256.",
                "Run the exact-artifact Android device matrix before promotion.",
            ],
        },
        "exportTooling": {
            "environmentClass": "approved-high-memory-only",
            "exporterRepositoryRevision": repository_revision(),
            "pythonVersion": sys.version.split()[0],
            "packages": package_versions(),
            "tokenizer": {
                "model": args.base_model_id,
                "revision": args.base_revision,
                "metadataSha256": tokenizer_sha256,
            },
        },
        "runtime": {
            "contextWindow": args.cache_length,
            "maxOutputTokens": 128,
            "backendPlan": ["gpu", "cpu-text"],
            "cachePolicy": "app-cache",
        },
        "deviceRequirements": {
            "minAndroidApi": 26,
            "minRamGb": args.candidate_min_ram_gb,
            "storageRequiredBytes": artifact_info["artifactSizeBytes"] + args.storage_buffer_bytes,
        },
        "artifact": {
            "fileName": artifact.name,
            "format": "litertlm",
            "downloadMode": "controlled-import",
            "immutableLocation": immutable_uri,
            "sha256": artifact_info["artifactSha256"],
            "sizeBytes": artifact_info["artifactSizeBytes"],
            "fileInventoryRef": artifact_inventory_ref,
        },
        "attestation": {
            "status": "pending",
            "processId": "HANDOFF-AI-ARTIFACT-ATTESTATION",
            "attestationRef": None,
            "approverRole": None,
            "approvedAt": None,
        },
        "safetyReport": {
            "reportDoc": args.safety_report,
            "summaryId": args.safety_summary_id,
            "privateEvidenceRepo": args.private_evidence_repo,
            "privateEvidenceRepoSha": args.private_evidence_repo_sha,
        },
        "androidProof": {
            "baseRuntimeManifestId": "litert-community-gemma-4-e2b-litertlm-prototype-2026-06-29.1",
            "baseRuntimeDeviceMatrixDoc": args.android_proof,
            "baseRuntimePhysicalDeviceProof": True,
            "tunedArtifactPhysicalDeviceProof": False,
            "deviceEvidenceId": None,
            "deviceEvidenceRef": None,
        },
        "controlPolicy": {
            "controlId": CONTROL_ID,
            "sha256": CONTROL_SHA256,
        },
        "approvals": {
            "legal": "approved",
            "safety": "blocked",
            "release": "blocked",
        },
        "rollbackTargetManifestId": args.rollback_target,
        "limitations": [
            "Artifact production is not Android runtime, safety, release, UNICEF, or survivor-readiness proof.",
            "Public Hugging Face research distribution is approved, but SafeRide in-app use remains controlled-import-only until attestation, evaluation, and exact physical-device evidence pass.",
            "Any non-float32 source-load export is an experimental converter diagnostic until Android runtime proof confirms behavior.",
        ],
        "createdAt": produced_at,
        "createdByRole": "ML release owner",
    }
    path = run_dir / "evidence-manifest.json"
    write_json(path, manifest)
    return path


def run_check(args: argparse.Namespace, run_dir: Path) -> int:
    metadata = base_metadata(args, run_dir)
    try:
        metadata["hfAccess"] = check_hf_access(args)
        metadata["hfAccessAvailable"] = True
    except Exception as error:  # noqa: BLE001 - write check metadata even when HF access is blocked.
        metadata["hfAccessAvailable"] = False
        metadata["hfAccessError"] = f"{type(error).__name__}: {error}"
    try:
        import_merge_deps()
        metadata["mergeDepsAvailable"] = True
    except Exception as error:  # noqa: BLE001
        metadata["mergeDepsAvailable"] = False
        metadata["mergeDepsError"] = str(error)
    try:
        import_export_deps()
        metadata["exportDepsAvailable"] = True
    except Exception as error:  # noqa: BLE001
        metadata["exportDepsAvailable"] = False
        metadata["exportDepsError"] = str(error)
    write_json(run_dir / "metadata.json", metadata)
    print("SafeRide tuned LiteRT-LM export check complete.")
    print("Run metadata was written to the private run directory.")
    if metadata["hfAccessAvailable"]:
        print(f"base_sha {metadata['hfAccess']['base']['observedSha']}")
        print(f"adapter_sha {metadata['hfAccess']['adapter']['observedSha']}")
    else:
        print(f"hf_access_available {metadata['hfAccessAvailable']}")
    print(f"merge_deps_available {metadata['mergeDepsAvailable']}")
    print(f"export_deps_available {metadata['exportDepsAvailable']}")
    return 0 if metadata["hfAccessAvailable"] and metadata["mergeDepsAvailable"] and metadata["exportDepsAvailable"] else 2


def run_offline_contract_check(args: argparse.Namespace) -> int:
    controls_path = REPO_ROOT / "config" / "ai" / "tuned-artifact-controls.v2.json"
    if not controls_path.is_file() or sha256_file(controls_path) != CONTROL_SHA256:
        raise RuntimeError("Pinned tuned artifact control hash does not match the repository controls.")
    if not args.artifact_name.endswith(".litertlm"):
        raise RuntimeError("Artifact name must end with .litertlm")
    if args.rollback_target != "fail-closed:no-local-ai":
        raise RuntimeError("Tuned artifact rollback must remain fail-closed until a separately approved target exists.")
    for label, revision in {
        "base revision": args.base_revision,
        "adapter revision": args.adapter_revision,
        "private evidence revision": args.private_evidence_repo_sha,
    }.items():
        if len(revision) < 40 or any(character not in "0123456789abcdef" for character in revision.lower()):
            raise RuntimeError(f"{label} must be an immutable hexadecimal revision")
    print("SafeRide tuned LiteRT-LM offline export contract: PASS")
    print("No network, model access, imports, model download, or output creation was attempted.")
    return 0


def main() -> int:
    args = parse_args()
    apply_export_profile(args)
    if args.offline_contract_check:
        return run_offline_contract_check(args)
    if args.merge_only and args.export_only:
        raise RuntimeError("--merge-only and --export-only cannot be combined")
    if args.upload and not args.upload_repo:
        raise RuntimeError("--upload requires --upload-repo")
    if args.cache_length <= 0:
        raise RuntimeError("--cache-length must be positive")
    if args.storage_buffer_bytes < 0:
        raise RuntimeError("--storage-buffer-bytes cannot be negative")
    if not args.check and not args.merge_only:
        validate_immutable_artifact_uri(args.immutable_artifact_uri)
        if args.candidate_min_ram_gb is None or args.candidate_min_ram_gb <= 0:
            raise RuntimeError("--candidate-min-ram-gb is required and must be positive for an artifact-producing run")

    run_dir = Path(args.output_root).expanduser().resolve() / args.run_id
    run_dir.mkdir(parents=True, exist_ok=True)

    if args.check:
        return run_check(args, run_dir)

    metadata = base_metadata(args, run_dir)
    write_json(run_dir / "metadata.json", metadata)

    try:
        if args.export_only:
            if not args.merged_dir:
                raise RuntimeError("--export-only requires --merged-dir")
            merged_dir = Path(args.merged_dir).expanduser().resolve()
            if not merged_dir.is_dir():
                raise RuntimeError(f"Merged checkpoint directory not found: {merged_dir}")
            merge_info = {"mergedDir": rel(merged_dir), "skipped": True}
        else:
            merged_dir, merge_info = merge_adapter(args, run_dir)
        metadata["merge"] = merge_info
        write_json(run_dir / "metadata.json", metadata)

        if args.merge_only:
            print("SafeRide tuned LiteRT-LM merge complete.")
            print("Merged checkpoint was written to the private run directory.")
            print("Merge-only mode. No .litertlm artifact was produced.")
            return 0

        artifact, artifact_info = export_litertlm(args, run_dir, merged_dir)
        metadata["export"] = artifact_info
        write_json(run_dir / "metadata.json", metadata)
        evidence_manifest = write_success_manifest(args, run_dir, merged_dir, artifact, artifact_info)

        upload_info = None
        if args.upload:
            upload_info = upload_private_artifact(args, run_dir, artifact, evidence_manifest)
            metadata["upload"] = upload_info
            write_json(run_dir / "metadata.json", metadata)

        print("SafeRide tuned LiteRT-LM export complete.")
        print(f"run_id {args.run_id}")
        print(f"artifact_file {artifact.name}")
        print(f"artifact_size_bytes {artifact_info['artifactSizeBytes']}")
        print(f"artifact_sha256 {artifact_info['artifactSha256']}")
        print(f"evidence_manifest_file {evidence_manifest.name}")
        if upload_info:
            print("private_artifact_upload_complete true")
        print("No raw prompts or completions were printed to stdout.")
        return 0
    except Exception as error:  # noqa: BLE001 - CLI should preserve evidence before exiting.
        metadata["failure"] = {
            "type": type(error).__name__,
            "message": str(error),
            "traceback": traceback.format_exc(limit=8),
            "createdAt": now_iso(),
            "diagnostics": runtime_diagnostics({"runDir": run_dir}),
        }
        write_json(run_dir / "metadata.json", metadata)
        print(f"Export failed: {type(error).__name__}", file=sys.stderr)
        print("Failure metadata was written to the private run directory.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
