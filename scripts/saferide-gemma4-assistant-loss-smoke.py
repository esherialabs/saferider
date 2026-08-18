#!/usr/bin/env python
"""Offline tiny causal-model smoke for canonical formatting and assistant-only loss."""

from __future__ import annotations

import hashlib
import importlib.util
import json
import math
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[1]
RUNNER_PATH = REPO_ROOT / "scripts" / "saferide-gemma4-finetune-runner.py"


def load_runner():
    spec = importlib.util.spec_from_file_location("saferide_gemma4_finetune_runner", RUNNER_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError("Could not load the repository fine-tuning runner.")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class TinyCanonicalTokenizer:
    chat_template = "saferide-offline-tiny-canonical-template-v1"
    pad_token_id = 0

    @staticmethod
    def apply_chat_template(
        messages: list[dict[str, str]], *, tokenize: bool, add_generation_prompt: bool, return_tensors: Any
    ) -> list[int]:
        if not tokenize or return_tensors is not None:
            raise RuntimeError("Tiny smoke expects tokenized canonical output without tensors.")
        rendered = "".join(f"<{message['role']}>{message['content']}</{message['role']}>" for message in messages)
        if add_generation_prompt:
            rendered += "<assistant>"
        return [ord(character) for character in rendered]


def softmax(values: list[float]) -> list[float]:
    maximum = max(values)
    exponentials = [math.exp(value - maximum) for value in values]
    total = sum(exponentials)
    return [value / total for value in exponentials]


def loss_and_gradient(
    logits: list[list[float]], input_ids: list[int], labels: list[int]
) -> tuple[float, list[list[float]], int]:
    gradients = [[0.0 for _ in row] for row in logits]
    loss = 0.0
    supervised = 0
    for index in range(1, len(input_ids)):
        target = labels[index]
        if target == -100:
            continue
        context = input_ids[index - 1]
        probabilities = softmax(logits[context])
        loss -= math.log(max(probabilities[target], 1e-12))
        for token, probability in enumerate(probabilities):
            gradients[context][token] += probability - (1.0 if token == target else 0.0)
        supervised += 1
    if supervised == 0:
        raise RuntimeError("Tiny smoke found no supervised assistant tokens.")
    return loss / supervised, gradients, supervised


def run_smoke() -> dict[str, Any]:
    runner = load_runner()
    row = {
        "id": "offline-synthetic-gradient-smoke",
        "messages": [
            {"role": "system", "content": "S"},
            {"role": "user", "content": "U"},
            {"role": "assistant", "content": "A"},
            {"role": "user", "content": "V"},
            {"role": "assistant", "content": "B"},
        ],
    }
    encoded = runner.encode_assistant_only_row(TinyCanonicalTokenizer(), row, 512)
    vocab_size = max(encoded["input_ids"]) + 1
    logits = [[0.0 for _ in range(vocab_size)] for _ in range(vocab_size)]
    before, gradients, supervised = loss_and_gradient(logits, encoded["input_ids"], encoded["labels"])
    gradient_norm = math.sqrt(sum(value * value for row_gradient in gradients for value in row_gradient))
    learning_rate = 0.25
    for context in range(vocab_size):
        for target in range(vocab_size):
            logits[context][target] -= learning_rate * gradients[context][target] / supervised
    after, _, after_supervised = loss_and_gradient(logits, encoded["input_ids"], encoded["labels"])
    masked = sum(label == -100 for label in encoded["labels"])
    if encoded["assistant_turn_count"] != 2:
        raise RuntimeError("Tiny smoke did not label both assistant turns.")
    if supervised != encoded["assistant_token_count"] or after_supervised != supervised:
        raise RuntimeError("Tiny smoke supervised-token accounting is inconsistent.")
    if masked == 0 or gradient_norm <= 0 or not after < before:
        raise RuntimeError("Tiny smoke failed its mask, gradient, or one-step loss-decrease assertion.")
    fingerprint = hashlib.sha256(
        json.dumps(
            {"input_ids": encoded["input_ids"], "labels": encoded["labels"]},
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()
    return {
        "schema": "com.saferide.ai.assistant-loss-smoke",
        "schemaVersion": 1,
        "fixture": "repository-authored-synthetic",
        "assistantTurns": encoded["assistant_turn_count"],
        "supervisedAssistantTokens": supervised,
        "maskedSystemUserAndPaddingTokens": masked,
        "maskedGradientContributions": 0,
        "gradientNormPositive": True,
        "lossDecreasedAfterOneStep": True,
        "formatAndLabelFingerprintSha256": fingerprint,
        "rawContentRecorded": False,
        "modelDownloads": 0,
        "passed": True,
    }


def main() -> int:
    report = run_smoke()
    print("SafeRide offline tiny-model assistant-loss smoke: PASS")
    print(json.dumps(report, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
