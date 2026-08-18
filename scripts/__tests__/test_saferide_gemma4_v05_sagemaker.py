import hashlib
import importlib.util
import json
import tarfile
import tempfile
import unittest
from pathlib import Path


STAGE_PATH = Path(__file__).resolve().parents[1] / "saferide-gemma4-v05-sagemaker-stage.py"
ENTRYPOINT_PATH = Path(__file__).resolve().parents[1] / "saferide-gemma4-v05-sagemaker-entrypoint.py"


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


STAGE = load_module("saferide_v05_sagemaker_stage", STAGE_PATH)
ENTRYPOINT = load_module("saferide_v05_sagemaker_entrypoint", ENTRYPOINT_PATH)


def file_sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


class SageMakerDatasetPackageTests(unittest.TestCase):
    def make_source(self, directory: Path, extra_path: str | None = None):
        root = directory / "legacy-handoff"
        root.mkdir()
        for relative in STAGE.DATASET_FILES:
            target = root / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(json.dumps({"fixture": relative}) + "\n", encoding="utf-8")
        manifest = {
            "schema": "com.saferide.ai.v05-controlled-colab-handoff",
            "schemaVersion": 1,
            "datasetId": STAGE.DATASET_ID,
            "sourceCommit": "8de9b7a5b5105fc244dffe5cea31a34d85994ba2",
            "createdAt": "2026-08-02T12:26:40.778Z",
            "files": [
                {"path": relative, "sha256": file_sha(root / relative)}
                for relative in STAGE.DATASET_FILES
            ],
            "privacy": {
                "containsReviewerIdentity": False,
                "containsCredentials": False,
                "containsRestrictedHoldoutBytes": False,
                "containsBlindPromptBytes": False,
            },
        }
        manifest_path = directory / "handoff-manifest.json"
        manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        embedded = root / "metadata" / "handoff-manifest.json"
        embedded.parent.mkdir(parents=True, exist_ok=True)
        embedded.write_bytes(manifest_path.read_bytes())
        if extra_path:
            extra = root / extra_path
            extra.parent.mkdir(parents=True, exist_ok=True)
            extra.write_text("forbidden\n", encoding="utf-8")
        archive_path = directory / "legacy.tar.gz"
        with tarfile.open(archive_path, "w:gz") as archive:
            archive.add(root, arcname=root.name)
        return archive_path, manifest_path

    def test_dataset_package_is_reproducible_and_excludes_restricted_evaluation_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source_archive, source_manifest = self.make_source(root)
            first = STAGE.package_dataset(source_archive, source_manifest, root / "first")
            second = STAGE.package_dataset(source_archive, source_manifest, root / "second")
            self.assertEqual(first["archiveSha256"], second["archiveSha256"])
            self.assertEqual(first["packageManifestSha256"], second["packageManifestSha256"])
            self.assertEqual(first["sourceCommit"], "8de9b7a5b5105fc244dffe5cea31a34d85994ba2")
            with tarfile.open(first["archivePath"], "r:gz") as archive:
                names = archive.getnames()
            self.assertFalse(any(STAGE.FORBIDDEN_PATH.search(name) for name in names))
            self.assertTrue(any(name.endswith("metadata/sagemaker-package-manifest.json") for name in names))

    def test_dataset_package_rejects_any_extra_or_restricted_file(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source_archive, source_manifest = self.make_source(root, "artifacts/reviews/private.json")
            with self.assertRaisesRegex(RuntimeError, "inventory differs"):
                STAGE.package_dataset(source_archive, source_manifest, root / "output")

    def test_embedded_manifest_must_match_controlled_external_manifest(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source_archive, source_manifest = self.make_source(root)
            source_manifest.write_text("{}\n", encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "manifests differ"):
                STAGE.package_dataset(source_archive, source_manifest, root / "output")


class SageMakerEntrypointTests(unittest.TestCase):
    def hyperparameters(self, **overrides):
        values = {
            "run-kind": "preflight",
            "run-id": "saferide-v05-preflight-20260802-01",
            "seed": "419805",
            "learning-rate": "0.00001",
            "epochs": "1",
            "max-steps": "1",
            "max-seq-length": "1024",
            "train-batch-size": "1",
            "eval-batch-size": "1",
            "gradient-accumulation-steps": "8",
            "lora-r": "8",
            "lora-alpha": "16",
            "lora-dropout": "0.05",
            "warmup-ratio": "0.03",
            "lr-scheduler-type": "cosine",
            "eval-steps": "1",
            "save-steps": "1",
            "early-stopping-patience": "3",
        }
        values.update(overrides)
        return values

    def test_preflight_runner_command_is_offline_and_uses_durable_checkpoints(self):
        command = ENTRYPOINT.runner_command(self.hyperparameters(), Path("/controlled/input"))
        self.assertIn("--base-model-path", command)
        self.assertIn(str(ENTRYPOINT.MODEL_CHANNEL), command)
        self.assertIn("--checkpoint-root", command)
        self.assertIn(str(ENTRYPOINT.CHECKPOINT_ROOT), command)
        self.assertNotIn("--allow-base-download", command)
        self.assertNotIn("--pilot-row-manifest", command)

    def test_pilot_runner_command_uses_frozen_pilot_manifest(self):
        values = self.hyperparameters(**{"run-kind": "pilot"})
        values.pop("max-steps")
        command = ENTRYPOINT.runner_command(values, Path("/controlled/input"))
        self.assertIn("--pilot-row-manifest", command)

    def test_unknown_hyperparameter_is_rejected(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "hyperparameters.json"
            path.write_text(json.dumps({**self.hyperparameters(), "unsafe-drift": "true"}), encoding="utf-8")
            original = ENTRYPOINT.HYPERPARAMETERS
            ENTRYPOINT.HYPERPARAMETERS = path
            try:
                with self.assertRaisesRegex(RuntimeError, "Unexpected SageMaker hyperparameters"):
                    ENTRYPOINT.read_hyperparameters()
            finally:
                ENTRYPOINT.HYPERPARAMETERS = original


if __name__ == "__main__":
    unittest.main()
