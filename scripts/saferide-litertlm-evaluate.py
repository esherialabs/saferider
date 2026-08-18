#!/usr/bin/env python3
"""Evaluate one exact LiteRT-LM artifact without retaining prompt/output text.

This utility is intended for controlled SafeRide model evidence. It verifies the
artifact bytes, performs one deterministic generation, and writes only hashes,
lengths, timing, memory, and structural metadata. It never writes the system
prompt, synthetic canary prompt, or generated response.
"""

from __future__ import annotations

import argparse
import dataclasses
import datetime as dt
import hashlib
import importlib.metadata
import json
import os
import platform
import resource
import time
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any


SYNTHETIC_CANARY = (
    "Provide three concise, non-legal safety-planning steps for a fictional "
    "adult who feels unsafe. Encourage trusted local support and emergency "
    "services when immediate danger exists."
)
TEXT_KEYS = frozenset({"content", "text"})


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat().replace("+00:00", "Z")


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_text(value: str) -> str:
    return sha256_bytes(value.encode("utf-8"))


def sha256_file(path: Path, chunk_size: int = 8 * 1024 * 1024) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(chunk_size):
            digest.update(chunk)
    return digest.hexdigest()


def write_private_json(path: Path, value: Any) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.parent.chmod(0o700)
    encoded = (json.dumps(value, indent=2, sort_keys=True) + "\n").encode("utf-8")
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(encoded)
    temporary.chmod(0o600)
    os.replace(temporary, path)
    return sha256_bytes(encoded)


def load_verified_system_prompt(path: Path) -> tuple[str, dict[str, str]]:
    value = json.loads(path.read_text(encoding="utf-8"))
    text = value["text"]
    expected = value["textSha256"]
    actual = sha256_text(text)
    if actual != expected:
        raise ValueError(f"system prompt text hash mismatch: expected {expected}, got {actual}")
    return text, {
        "prompt_id": value["promptId"],
        "policy_id": value["policyId"],
        "text_sha256": actual,
    }


def digest_string_values(value: Any) -> Any:
    """Preserve response shape while replacing every string value with a digest."""
    if isinstance(value, str):
        return {"type": "string", "characters": len(value), "sha256": sha256_text(value)}
    if isinstance(value, Mapping):
        return {str(key): digest_string_values(item) for key, item in value.items()}
    if isinstance(value, Sequence) and not isinstance(value, (bytes, bytearray)):
        return [digest_string_values(item) for item in value]
    if value is None or isinstance(value, (bool, int, float)):
        return value
    return {"type": type(value).__name__}


def extract_response_text(value: Any, *, parent_key: str | None = None) -> list[str]:
    values: list[str] = []
    if isinstance(value, str):
        if parent_key in TEXT_KEYS:
            values.append(value)
        return values
    if isinstance(value, Mapping):
        for key, item in value.items():
            values.extend(extract_response_text(item, parent_key=str(key)))
        return values
    if isinstance(value, Sequence) and not isinstance(value, (bytes, bytearray)):
        for item in value:
            values.extend(extract_response_text(item, parent_key=parent_key))
    return values


def process_memory() -> dict[str, int]:
    values: dict[str, int] = {}
    status = Path("/proc/self/status")
    if status.exists():
        for line in status.read_text(encoding="utf-8").splitlines():
            if line.startswith(("VmRSS:", "VmHWM:", "VmPeak:")):
                key, raw = line.split(":", 1)
                values[f"{key.lower()}_kib"] = int(raw.strip().split()[0])
    maximum = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    values["ru_maxrss_kib"] = int(maximum)
    return values


def package_versions(names: Sequence[str]) -> dict[str, str]:
    versions: dict[str, str] = {}
    for name in names:
        try:
            versions[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            continue
    return versions


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", required=True)
    parser.add_argument("--expected-model-sha256", required=True)
    parser.add_argument("--expected-model-size", type=int, required=True)
    parser.add_argument("--system-prompt-json", required=True)
    parser.add_argument("--cache-dir", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--cpu-threads", type=int, default=8)
    parser.add_argument("--max-num-tokens", type=int, default=2048)
    parser.add_argument("--max-output-tokens", type=int, default=64)
    parser.add_argument("--cancel-smoke", action="store_true")
    parser.add_argument("--cancel-max-output-tokens", type=int, default=256)
    parser.add_argument("--seed", type=int, default=419806)
    parser.add_argument("--network-mode", default="unspecified")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    model_path = Path(args.model).resolve()
    output_path = Path(args.output).resolve()
    cache_dir = Path(args.cache_dir).resolve()
    system_prompt_path = Path(args.system_prompt_json).resolve()

    started_at = now_iso()
    model_size = model_path.stat().st_size
    if model_size != args.expected_model_size:
        raise ValueError(
            f"model size mismatch: expected {args.expected_model_size}, got {model_size}"
        )
    model_sha256 = sha256_file(model_path)
    if model_sha256 != args.expected_model_sha256:
        raise ValueError(
            f"model hash mismatch: expected {args.expected_model_sha256}, got {model_sha256}"
        )

    system_prompt, system_prompt_evidence = load_verified_system_prompt(system_prompt_path)
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_dir.chmod(0o700)

    from litert_lm import Backend, Engine, SamplerConfig, ThinkingConfig

    memory_before_init = process_memory()
    init_started = time.monotonic()
    engine = Engine(
        str(model_path),
        backend=Backend.CPU(thread_count=args.cpu_threads),
        max_num_tokens=args.max_num_tokens,
        cache_dir=str(cache_dir),
        enable_benchmark=True,
    )
    init_seconds = time.monotonic() - init_started
    memory_after_init = process_memory()

    conversation = None
    cancel_conversation = None
    cancellation = None
    try:
        conversation = engine.create_conversation(
            system_message=system_prompt,
            thinking_config=ThinkingConfig(enable_thinking=False, thinking_token_budget=0),
            sampler_config=SamplerConfig(
                top_k=1,
                top_p=1.0,
                temperature=0.0,
                seed=args.seed,
            ),
            max_output_tokens=args.max_output_tokens,
        )
        generation_started = time.monotonic()
        response = conversation.send_message(
            SYNTHETIC_CANARY,
            max_output_tokens=args.max_output_tokens,
            thinking_config=ThinkingConfig(enable_thinking=False, thinking_token_budget=0),
        )
        generation_seconds = time.monotonic() - generation_started
        benchmark = dataclasses.asdict(conversation.get_benchmark_info())
        memory_after_generation = process_memory()

        if args.cancel_smoke:
            cancel_conversation = engine.create_conversation(
                system_message=system_prompt,
                thinking_config=ThinkingConfig(enable_thinking=False, thinking_token_budget=0),
                sampler_config=SamplerConfig(
                    top_k=1,
                    top_p=1.0,
                    temperature=0.0,
                    seed=args.seed,
                ),
                max_output_tokens=args.cancel_max_output_tokens,
            )
            stream = cancel_conversation.send_message_async(
                SYNTHETIC_CANARY,
                max_output_tokens=args.cancel_max_output_tokens,
                thinking_config=ThinkingConfig(enable_thinking=False, thinking_token_budget=0),
            )
            first_chunk_started = time.monotonic()
            try:
                first_chunk = next(stream)
            except StopIteration as error:
                raise RuntimeError("cancellation smoke returned no stream chunk") from error
            first_chunk_seconds = time.monotonic() - first_chunk_started
            first_chunk_text = "\n".join(extract_response_text(first_chunk))
            cancel_started = time.monotonic()
            cancel_conversation.cancel_process()
            additional_chunks = 0
            for _chunk in stream:
                additional_chunks += 1
            cancel_to_stream_end_seconds = time.monotonic() - cancel_started
            cancellation = {
                "status": "passed",
                "cancel_invoked_after_first_chunk": True,
                "first_chunk_seconds": first_chunk_seconds,
                "first_chunk_characters": len(first_chunk_text),
                "first_chunk_sha256": sha256_text(first_chunk_text),
                "first_chunk_structure_with_string_digests": digest_string_values(first_chunk),
                "additional_chunks_after_cancel": additional_chunks,
                "cancel_to_stream_end_seconds": cancel_to_stream_end_seconds,
                "max_output_tokens": args.cancel_max_output_tokens,
                "memory_after_cancel": process_memory(),
            }
    finally:
        if cancel_conversation is not None:
            cancel_conversation.close()
        if conversation is not None:
            conversation.close()
        engine.close()

    response_segments = [item for item in extract_response_text(response) if item]
    if not response_segments:
        raise RuntimeError("generation returned no response text fields")
    joined_response = "\n".join(response_segments)

    report = {
        "schema": "saferide-litertlm-runtime-evaluation",
        "schema_version": 1,
        "run_id": args.run_id,
        "started_at": started_at,
        "completed_at": now_iso(),
        "status": "passed",
        "privacy": {
            "prompt_text_retained": False,
            "response_text_retained": False,
            "raw_payload_logging": False,
        },
        "artifact": {
            "file_name": model_path.name,
            "size_bytes": model_size,
            "sha256": model_sha256,
        },
        "prompt": {
            "system": system_prompt_evidence,
            "synthetic_canary_sha256": sha256_text(SYNTHETIC_CANARY),
            "synthetic_canary_characters": len(SYNTHETIC_CANARY),
        },
        "response": {
            "text_segments": len(response_segments),
            "characters": len(joined_response),
            "sha256": sha256_text(joined_response),
            "structure_with_string_digests": digest_string_values(response),
        },
        "runtime": {
            "backend": "cpu",
            "cpu_threads": args.cpu_threads,
            "network_mode": args.network_mode,
            "max_num_tokens": args.max_num_tokens,
            "max_output_tokens": args.max_output_tokens,
            "sampler": {
                "top_k": 1,
                "top_p": 1.0,
                "temperature": 0.0,
                "seed": args.seed,
                "thinking_enabled": False,
            },
            "wall_time_seconds": {
                "engine_initialization": init_seconds,
                "generation": generation_seconds,
            },
            "benchmark": benchmark,
            "memory": {
                "before_engine_initialization": memory_before_init,
                "after_engine_initialization": memory_after_init,
                "after_generation": memory_after_generation,
            },
            "cancellation": cancellation,
        },
        "toolchain": {
            "python": platform.python_version(),
            "platform": platform.platform(),
            "packages": package_versions(
                (
                    "litert-lm",
                    "ai-edge-litert",
                    "ai-edge-litert-nightly",
                    "numpy",
                    "protobuf",
                )
            ),
        },
    }
    report_sha256 = write_private_json(output_path, report)
    print(
        json.dumps(
            {
                "status": "passed",
                "report_file": output_path.name,
                "report_sha256": report_sha256,
                "response_characters": len(joined_response),
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
