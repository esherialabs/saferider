from __future__ import annotations

import importlib.util
import pathlib
import shutil
import tempfile
import unittest
from types import SimpleNamespace
from unittest import mock


MODULE_PATH = pathlib.Path(__file__).resolve().parents[1] / "saferide-gemma4-v058-hf-dataset-release.py"
SPEC = importlib.util.spec_from_file_location("saferide_v058_hf_dataset_release", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class V058HfDatasetReleaseTests(unittest.TestCase):
    def test_source_and_final_serialization_preserve_historical_ascii_modes(self) -> None:
        rows = [{"id": "sw-1", "text": "usalama — hiari"}]

        source = MODULE.source_jsonl_bytes(rows)
        final = MODULE.final_jsonl_bytes(rows)

        self.assertIn("—".encode("utf-8"), source)
        self.assertIn(b"\\u2014", final)
        self.assertNotEqual(source, final)

    def test_validate_composition_is_hash_and_training_split_strict(self) -> None:
        unique = [
            {"id": "one", "split": "train", "datasetId": "a"},
            {"id": "two", "split": "train", "datasetId": "b"},
        ]
        weighted = [unique[0], unique[1], unique[1]]

        with (
            mock.patch.object(MODULE, "EXPECTED_UNIQUE_ROWS", 2),
            mock.patch.object(MODULE, "EXPECTED_WEIGHTED_EXAMPLES", 3),
            mock.patch.object(
                MODULE,
                "EXPECTED_UNIQUE_SHA256",
                MODULE.sha256_bytes(MODULE.final_jsonl_bytes(unique)),
            ),
            mock.patch.object(
                MODULE,
                "EXPECTED_WEIGHTED_SHA256",
                MODULE.sha256_bytes(MODULE.final_jsonl_bytes(weighted)),
            ),
        ):
            MODULE.validate_composition(unique, weighted)

        invalid = [dict(unique[0], split="dev"), unique[1]]
        with (
            mock.patch.object(MODULE, "EXPECTED_UNIQUE_ROWS", 2),
            mock.patch.object(MODULE, "EXPECTED_WEIGHTED_EXAMPLES", 3),
        ):
            with self.assertRaisesRegex(RuntimeError, "Non-training row"):
                MODULE.validate_composition(invalid, weighted)

    def test_dataset_card_is_canonical_community_documentation(self) -> None:
        args = mock.Mock(repo_id=MODULE.DEFAULT_REPO_ID)
        card = MODULE.build_readme(args, {})

        self.assertEqual(
            card,
            MODULE.CANONICAL_DATASET_CARD_PATH.read_text(encoding="utf-8"),
        )
        self.assertIn("SafeRide Synthetic Bilingual Safety Guidance Dataset v0.5.8", card)
        self.assertIn("license: cc-by-4.0", card)
        self.assertIn("Creative Commons Attribution 4.0 International", card)
        self.assertNotIn("license-pending-legal-approval", card)
        self.assertIn("original-419806-unique", card)
        self.assertIn("original-419806-weighted", card)
        self.assertIn("1,376", card)
        self.assertIn("528", card)
        self.assertIn(MODULE.EXPECTED_UNIQUE_SHA256, card)
        self.assertIn(MODULE.EXPECTED_WEIGHTED_SHA256, card)
        self.assertIn(MODULE.ADAPTER_REPO, card)
        self.assertIn(MODULE.ADAPTER_REVISION, card)
        self.assertIn(MODULE.MOBILE_REPO, card)
        self.assertIn(MODULE.MOBILE_REVISION, card)
        self.assertNotIn("A11", card)
        self.assertNotIn("leadership-selected", card)
        self.assertNotIn("sealed holdout", card)
        self.assertNotIn("terminators", card)

    def test_dataset_card_supports_an_explicit_private_repo_override(self) -> None:
        replacement = "example/private-dataset"
        card = MODULE.build_readme(mock.Mock(repo_id=replacement), {})

        self.assertIn(replacement, card)
        self.assertNotIn(MODULE.DEFAULT_REPO_ID, card)

    def test_model_card_link_is_machine_readable_and_idempotent(self) -> None:
        original = "---\npipeline_tag: text-generation\n---\n\n# Model\n"
        revision = "a" * 40

        linked = MODULE.dataset_linked_model_card(original, MODULE.DEFAULT_REPO_ID, revision)
        linked_again = MODULE.dataset_linked_model_card(linked, MODULE.DEFAULT_REPO_ID, revision)

        self.assertIn("datasets:\n  - " + MODULE.DEFAULT_REPO_ID, linked)
        self.assertIn(revision, linked)
        self.assertEqual(linked.count("<!-- saferide-training-dataset:start -->"), 1)
        self.assertEqual(linked_again.count("<!-- saferide-training-dataset:start -->"), 1)
        self.assertEqual(linked_again.count(MODULE.DEFAULT_REPO_ID), 3)

    def test_resume_revision_download_verifies_without_reupload(self) -> None:
        revision = "a" * 40
        snapshot_targets: list[pathlib.Path] = []

        class FakeApi:
            def whoami(self) -> dict[str, str]:
                return {"name": "test"}

            def dataset_info(self, repo_id: str, *, revision: str) -> SimpleNamespace:
                self.repo_id = repo_id
                return SimpleNamespace(private=True, sha=revision)

            def upload_folder(self, **_kwargs: object) -> None:
                raise AssertionError("resume verification must not upload")

        def fake_snapshot_download(*, local_dir: str, **_kwargs: object) -> str:
            destination = pathlib.Path(local_dir)
            snapshot_targets.append(destination)
            shutil.copy2(artifact_dir / "payload.bin", destination / "payload.bin")
            (destination / ".gitattributes").write_text("test\n", encoding="utf-8")
            return str(destination)

        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            artifact_dir = root / "artifact"
            artifact_dir.mkdir()
            (artifact_dir / "payload.bin").write_bytes(b"verified bytes")
            args = SimpleNamespace(
                repo_id=MODULE.DEFAULT_REPO_ID,
                resume_revision=revision,
                revision="main",
                commit_message="unused",
            )

            with mock.patch.object(MODULE, "import_hub", return_value=(FakeApi, None, fake_snapshot_download)):
                result = MODULE.execute_upload(args, artifact_dir, root)

        self.assertEqual(result["revision"], revision)
        self.assertTrue(result["resumedExistingRevision"])
        self.assertEqual(result["verifiedFileCount"], 1)
        self.assertEqual(len(snapshot_targets), 1)
        self.assertNotIn(str(root), str(snapshot_targets[0]))


if __name__ == "__main__":
    unittest.main()
