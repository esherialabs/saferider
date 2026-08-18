import argparse
import hashlib
import importlib.util
import json
import math
import tempfile
import unittest
from unittest import mock
from pathlib import Path


RUNNER_PATH = Path(__file__).resolve().parents[1] / "saferide-gemma4-finetune-runner.py"
SPEC = importlib.util.spec_from_file_location("saferide_gemma4_v05_finetune_runner", RUNNER_PATH)
assert SPEC and SPEC.loader
RUNNER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUNNER)


class V05ConfigurationTests(unittest.TestCase):
    @staticmethod
    def args(**overrides):
        values = {
            "max_seq_length": 1024,
            "train_batch_size": 1,
            "eval_batch_size": 1,
            "gradient_accumulation_steps": 8,
            "logging_steps": 5,
            "eval_steps": 25,
            "save_steps": 25,
            "early_stopping_patience": 3,
            "epochs": 1.0,
            "max_steps": None,
            "warmup_ratio": 0.03,
            "base_revision": "a" * 40,
            "base_model_id": "google/gemma-4-E2B-it",
            "seed": 419805,
            "learning_rate": 1e-5,
            "lora_r": 8,
            "lora_alpha": 16,
            "lora_dropout": 0.05,
            "lora_rank_approval_ref": None,
            "lr_scheduler_type": "cosine",
        }
        values.update(overrides)
        return argparse.Namespace(**values)

    def test_fixed_candidate_and_pilot_configuration_pass(self):
        RUNNER.validate_run_configuration(self.args(), "candidate", "v05")
        RUNNER.validate_run_configuration(self.args(), "pilot", "v05")

    def test_real_model_preflight_is_exactly_one_step_with_canonical_seed_and_rate(self):
        RUNNER.validate_run_configuration(
            self.args(max_steps=1, eval_steps=1, save_steps=1), "preflight", "v05"
        )
        with self.assertRaisesRegex(RuntimeError, "preflight requires"):
            RUNNER.validate_run_configuration(
                self.args(max_steps=2, eval_steps=1, save_steps=1), "preflight", "v05"
            )
        with self.assertRaisesRegex(RuntimeError, "preflight requires"):
            RUNNER.validate_run_configuration(
                self.args(max_steps=1, learning_rate=2e-5, eval_steps=1, save_steps=1),
                "preflight",
                "v05",
            )
        with self.assertRaisesRegex(RuntimeError, "cadence of 1 step"):
            RUNNER.validate_run_configuration(self.args(max_steps=1), "preflight", "v05")

    def test_step_cap_wrong_seed_and_unpinned_base_fail_before_model_access(self):
        with self.assertRaisesRegex(RuntimeError, "cannot use --max-steps"):
            RUNNER.validate_run_configuration(self.args(max_steps=1), "pilot", "v05")
        with self.assertRaisesRegex(RuntimeError, "seed"):
            RUNNER.validate_run_configuration(self.args(seed=1), "candidate", "v05")
        with self.assertRaisesRegex(RuntimeError, "immutable"):
            RUNNER.validate_run_configuration(self.args(base_revision="main"), "pilot", "v05")

    def test_fixed_training_parameters_cannot_drift(self):
        for field, value in [
            ("max_seq_length", 2048), ("train_batch_size", 2),
            ("gradient_accumulation_steps", 4), ("warmup_ratio", 0.1),
            ("lr_scheduler_type", "linear"), ("early_stopping_patience", 2),
        ]:
            with self.subTest(field=field), self.assertRaisesRegex(RuntimeError, "fixed sequence"):
                RUNNER.validate_run_configuration(self.args(**{field: value}), "candidate", "v05")

    def test_rank_16_requires_explicit_pilot_evidence(self):
        with self.assertRaisesRegex(RuntimeError, "rank 16"):
            RUNNER.validate_run_configuration(self.args(lora_r=16), "candidate", "v05")
        RUNNER.validate_run_configuration(
            self.args(lora_r=16, lora_rank_approval_ref="controlled:pilot-underfitting-decision"),
            "candidate",
            "v05",
        )

    def test_deterministic_pilot_manifest_is_hash_bound(self):
        row_ids = [f"v05-test-row-{index:04d}" for index in range(320)]
        inventory_hash = hashlib.sha256("\n".join(row_ids).encode("utf-8")).hexdigest()
        document = {
            "schema": "com.saferide.ai.v05-pilot-row-manifest",
            "datasetId": "saferide-synthetic-guidance-v0.5.0",
            "seed": 419805,
            "rowsPerCategoryLanguage": 16,
            "rowIdInventorySha256": inventory_hash,
            "rowIds": row_ids,
        }
        with tempfile.TemporaryDirectory() as directory:
            manifest = Path(directory) / "pilot.json"
            manifest.write_text(json.dumps(document), encoding="utf-8")
            self.assertEqual(RUNNER.load_pilot_row_ids(manifest, "v05", "pilot"), row_ids)
            document["rowIdInventorySha256"] = "0" * 64
            manifest.write_text(json.dumps(document), encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "inventory hash is stale"):
                RUNNER.load_pilot_row_ids(manifest, "v05", "pilot")

    def test_v05_register_selects_access_separated_profile(self):
        self.assertEqual(RUNNER.dataset_profile_for_register({"schema": "com.saferide.ai.v05-dataset-register"}), "v05")
        self.assertEqual(RUNNER.dataset_profile_for_register({"schema": "legacy"}), "v04")

    def test_training_runner_uses_training_only_gate_not_custodian_holdout_gate(self):
        completed = type("Completed", (), {"stdout": "ok", "stderr": "", "returncode": 0})()
        with mock.patch.object(RUNNER, "run_command", return_value=completed) as command:
            result = RUNNER.run_data_gate(
                Path("register.json"), None, None, True,
                dataset_profile="v05", artifact_root=Path("artifacts"),
                train_data=Path("train.jsonl"), dev_data=Path("dev.jsonl"),
            )
        invoked = command.call_args.args[0]
        self.assertIn("--training-strict", invoked)
        self.assertNotIn("--strict", invoked)
        self.assertTrue(result["passed"])

    def test_cuda_bf16_is_selected_when_the_training_device_supports_it(self):
        cuda = mock.Mock()
        cuda.is_bf16_supported.return_value = True
        torch = mock.Mock(cuda=cuda)
        self.assertTrue(RUNNER.cuda_bf16_supported(torch, True))
        self.assertFalse(RUNNER.cuda_bf16_supported(torch, False))

    def test_non_finite_gradient_history_is_blocked_and_cannot_be_written_as_json(self):
        with self.assertRaisesRegex(RuntimeError, "Non-finite training metric"):
            RUNNER.assert_finite_training_evidence({"logHistory": [{"grad_norm": math.nan}]})
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ValueError):
                RUNNER.write_metadata(Path(directory) / "run", {"grad_norm": math.nan})


if __name__ == "__main__":
    unittest.main()
