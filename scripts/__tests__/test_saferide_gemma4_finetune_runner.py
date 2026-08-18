import argparse
import importlib.util
import math
import tempfile
import unittest
from collections import UserDict
from pathlib import Path


RUNNER_PATH = Path(__file__).resolve().parents[1] / "saferide-gemma4-finetune-runner.py"
SPEC = importlib.util.spec_from_file_location("saferide_gemma4_finetune_runner", RUNNER_PATH)
assert SPEC and SPEC.loader
RUNNER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUNNER)

SMOKE_PATH = Path(__file__).resolve().parents[1] / "saferide-gemma4-assistant-loss-smoke.py"
SMOKE_SPEC = importlib.util.spec_from_file_location("saferide_gemma4_assistant_loss_smoke", SMOKE_PATH)
assert SMOKE_SPEC and SMOKE_SPEC.loader
SMOKE = importlib.util.module_from_spec(SMOKE_SPEC)
SMOKE_SPEC.loader.exec_module(SMOKE)


class FakeTokenizer:
    chat_template = "fake-canonical-template-v1"
    pad_token_id = 0

    @staticmethod
    def render(messages, add_generation_prompt):
        text = "".join(f"<{item['role']}>{item['content']}</{item['role']}>" for item in messages)
        if add_generation_prompt:
            text += "<assistant>"
        return text

    def apply_chat_template(self, messages, *, tokenize, add_generation_prompt, return_tensors):
        assert tokenize is True
        assert return_tensors is None
        return [ord(character) for character in self.render(messages, add_generation_prompt)]


class UnstableTokenizer(FakeTokenizer):
    def apply_chat_template(self, messages, *, tokenize, add_generation_prompt, return_tensors):
        prefix = "unstable" if add_generation_prompt else "stable"
        return [ord(character) for character in prefix + self.render(messages, add_generation_prompt)]


class MappingTokenizer(FakeTokenizer):
    def apply_chat_template(self, messages, *, tokenize, add_generation_prompt, return_tensors):
        input_ids = super().apply_chat_template(
            messages,
            tokenize=tokenize,
            add_generation_prompt=add_generation_prompt,
            return_tensors=return_tensors,
        )
        return UserDict({"input_ids": input_ids, "attention_mask": [1] * len(input_ids)})


class AssistantOnlyFormattingTests(unittest.TestCase):
    def setUp(self):
        self.row = {
            "id": "synthetic-row-1",
            "messages": [
                {"role": "system", "content": "S"},
                {"role": "user", "content": "U"},
                {"role": "assistant", "content": "A"},
                {"role": "user", "content": "V"},
                {"role": "assistant", "content": "B"},
            ],
        }

    def test_masks_system_and_user_tokens_and_trains_each_assistant_turn(self):
        encoded = RUNNER.encode_assistant_only_row(FakeTokenizer(), self.row, 1024)
        rendered = "".join(chr(token) for token in encoded["input_ids"])
        labelled = "".join(
            rendered[index] for index, label in enumerate(encoded["labels"]) if label != -100
        )
        self.assertEqual(labelled, "A</assistant>B</assistant>")
        self.assertEqual(encoded["assistant_turn_count"], 2)
        self.assertGreater(encoded["assistant_token_count"], 2)
        for marker in ["<system>S</system>", "<user>U</user>", "<user>V</user>"]:
            start = rendered.index(marker)
            self.assertTrue(all(label == -100 for label in encoded["labels"][start : start + len(marker)]))

    def test_accepts_transformers_mapping_style_tokenizer_results(self):
        encoded = RUNNER.encode_assistant_only_row(MappingTokenizer(), self.row, 1024)
        self.assertEqual(encoded["assistant_turn_count"], 2)
        self.assertGreater(encoded["assistant_token_count"], 2)

    def test_missing_chat_template_fails_without_manual_role_fallback(self):
        tokenizer = FakeTokenizer()
        tokenizer.chat_template = None
        with self.assertRaisesRegex(RuntimeError, "manual role-label fallback is forbidden"):
            RUNNER.encode_assistant_only_row(tokenizer, self.row, 1024)

    def test_non_prefix_stable_template_fails_closed(self):
        with self.assertRaisesRegex(RuntimeError, "assistant-only labels cannot be proven"):
            RUNNER.encode_assistant_only_row(UnstableTokenizer(), self.row, 1024)

    def test_overlength_row_is_rejected_instead_of_truncated(self):
        with self.assertRaisesRegex(RuntimeError, "silent truncation is forbidden"):
            RUNNER.encode_assistant_only_row(FakeTokenizer(), self.row, 10)


class CandidateConfigurationTests(unittest.TestCase):
    @staticmethod
    def args(**overrides):
        values = {
            "max_seq_length": 1024,
            "train_batch_size": 1,
            "eval_batch_size": 1,
            "gradient_accumulation_steps": 8,
            "logging_steps": 5,
            "eval_steps": 5,
            "save_steps": 5,
            "early_stopping_patience": 3,
            "epochs": 1.0,
            "max_steps": None,
            "warmup_ratio": 0.03,
            "base_revision": "a" * 40,
        }
        values.update(overrides)
        return argparse.Namespace(**values)

    def test_candidate_requires_full_epoch_and_immutable_revision(self):
        RUNNER.validate_run_configuration(self.args(), "candidate")
        with self.assertRaisesRegex(RuntimeError, "at least 1"):
            RUNNER.validate_run_configuration(self.args(epochs=0.5), "candidate")
        with self.assertRaisesRegex(RuntimeError, "immutable"):
            RUNNER.validate_run_configuration(self.args(base_revision="main"), "candidate")

    def test_step_cap_is_pilot_only(self):
        with self.assertRaisesRegex(RuntimeError, "cannot use --max-steps"):
            RUNNER.validate_run_configuration(self.args(max_steps=10), "candidate")

    def test_failure_handoff_redacts_credentials_and_url_tokens(self):
        query_key = "".join(["to", "ken"])
        message = RUNNER.sanitized_error_message(RuntimeError(f"download failed ?{query_key}=visible-value"))
        self.assertNotIn("visible-value", message)
        self.assertIn("[redacted]", message)

    def test_training_lock_pins_direct_and_transitive_python_dependencies(self):
        pins = RUNNER.load_training_lock(RUNNER.DEFAULT_REQUIREMENTS, RUNNER.DEFAULT_CONSTRAINTS)
        self.assertGreater(len(pins), 8)
        self.assertEqual(pins["huggingface-hub"], "1.5.0")
        self.assertEqual(pins["protobuf"], "6.33.6")
        self.assertEqual(pins["torch"], "2.7.0")
        self.assertEqual(pins["transformers"], "5.5.4")

    def test_training_lock_rejects_an_installed_version_mismatch(self):
        with self.assertRaisesRegex(RuntimeError, "do not match the approved training lock"):
            RUNNER.verify_installed_training_lock(
                {"torch": "2.7.0"},
                version_getter=lambda _name: "2.8.0",
            )

    def test_training_lock_accepts_a_cuda_local_version_of_the_exact_torch_release(self):
        installed = RUNNER.verify_installed_training_lock(
            {"torch": "2.7.0"},
            version_getter=lambda _name: "2.7.0+cu126",
        )
        self.assertEqual(installed["torch"], "2.7.0+cu126")

    def test_cuda_bf16_is_preferred_only_when_the_device_supports_it(self):
        class FakeCuda:
            @staticmethod
            def is_bf16_supported():
                return True

        class FakeTorch:
            cuda = FakeCuda()

        self.assertTrue(RUNNER.cuda_bf16_supported(FakeTorch(), True))
        self.assertFalse(RUNNER.cuda_bf16_supported(FakeTorch(), False))

    def test_non_finite_training_evidence_fails_closed(self):
        RUNNER.assert_finite_training_evidence({"loss": 1.0, "history": [{"grad_norm": 2.0}]})
        for value in (math.nan, math.inf, -math.inf):
            with self.assertRaisesRegex(RuntimeError, "Non-finite training metric"):
                RUNNER.assert_finite_training_evidence({"history": [{"grad_norm": value}]})

    def test_metadata_writer_rejects_non_standard_json_numbers(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                RUNNER.write_metadata(Path(directory) / "run", {"grad_norm": math.nan})


class OfflineGradientSmokeTests(unittest.TestCase):
    def test_two_assistant_turns_have_nonzero_gradient_and_masked_turns_have_none(self):
        report = SMOKE.run_smoke()
        self.assertTrue(report["passed"])
        self.assertEqual(report["assistantTurns"], 2)
        self.assertGreater(report["supervisedAssistantTokens"], 0)
        self.assertGreater(report["maskedSystemUserAndPaddingTokens"], 0)
        self.assertEqual(report["maskedGradientContributions"], 0)
        self.assertTrue(report["lossDecreasedAfterOneStep"])
        self.assertFalse(report["rawContentRecorded"])
        self.assertEqual(report["modelDownloads"], 0)


if __name__ == "__main__":
    unittest.main()
