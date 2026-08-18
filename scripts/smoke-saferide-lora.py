#!/usr/bin/env python
"""Text-only SafeRide LoRA smoke harness.

This validates the superseded Gemma 3n adapter behavior separately from the
mobile runtime. It intentionally does not make APK/mobile claims. The active
SafeRide target is Gemma 4 E2B through LiteRT-LM.
"""

from __future__ import annotations

import argparse
import importlib.util
import sys


ADAPTER_ID = "esherialabs/saferide-gemma-3n"
DEFAULT_PROMPT = (
    "A woman reports unwanted touching on a matatu and is afraid to go to the police. "
    "Give concise, survivor-centred next steps for Kenya. Do not invent facts."
)


def missing_packages() -> list[str]:
    required = ["torch", "transformers", "peft", "accelerate", "safetensors"]
    return [name for name in required if importlib.util.find_spec(name) is None]


def main() -> int:
    parser = argparse.ArgumentParser(description="Legacy smoke test for the superseded SafeRide Gemma 3n LoRA adapter.")
    parser.add_argument("--prompt", default=DEFAULT_PROMPT)
    parser.add_argument("--max-new-tokens", type=int, default=128)
    parser.add_argument("--check", action="store_true", help="Only check Python dependencies.")
    args = parser.parse_args()

    missing = missing_packages()
    if missing:
        print("Missing Python packages: " + ", ".join(missing), file=sys.stderr)
        print(
            "Use Python 3.12, then install: "
            "python -m pip install -r requirements-ai-smoke.txt",
            file=sys.stderr,
        )
        return 2

    if args.check:
        print("SafeRide LoRA smoke dependencies are installed.")
        return 0

    import torch
    from peft import PeftModel
    from transformers import AutoModelForImageTextToText, AutoProcessor

    dtype = torch.float16 if torch.cuda.is_available() else torch.float32
    device_map = "auto" if torch.cuda.is_available() else None

    processor = AutoProcessor.from_pretrained(ADAPTER_ID, trust_remote_code=True)
    base_model_id = "unsloth/gemma-3n-e4b-it-unsloth-bnb-4bit"
    model = AutoModelForImageTextToText.from_pretrained(
        base_model_id,
        torch_dtype=dtype,
        device_map=device_map,
        trust_remote_code=True,
    )
    model = PeftModel.from_pretrained(model, ADAPTER_ID)
    model.eval()

    messages = [
        {
            "role": "user",
            "content": [{"type": "text", "text": args.prompt}],
        }
    ]
    text = processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
    inputs = processor(text=[text], return_tensors="pt")
    if torch.cuda.is_available():
        inputs = {key: value.to(model.device) for key, value in inputs.items()}

    with torch.no_grad():
        output_ids = model.generate(
            **inputs,
            max_new_tokens=args.max_new_tokens,
            do_sample=False,
        )

    print(processor.batch_decode(output_ids, skip_special_tokens=True)[0])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
