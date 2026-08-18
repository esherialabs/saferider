import argparse
import hashlib
import importlib.util
import tempfile
import unittest
from pathlib import Path
from unittest import mock


REPO_ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = REPO_ROOT / "scripts" / "saferide-gemma4-tuned-litertlm-export.py"
SPEC = importlib.util.spec_from_file_location("saferide_gemma4_tuned_litertlm_export", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class SafeRideTunedLiteRtLmExportTests(unittest.TestCase):
    def test_offline_adapter_resolves_cache_before_copying_private_snapshot(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            cached = root / "cached-snapshot"
            cached.mkdir()
            adapter_bytes = b"synthetic adapter bytes"
            (cached / "adapter_model.safetensors").write_bytes(adapter_bytes)
            (cached / "adapter_config.json").write_text("{}\n", encoding="utf-8")
            cache_metadata = cached / ".cache"
            cache_metadata.mkdir()
            (cache_metadata / "ignored").write_text("metadata", encoding="utf-8")

            calls = []

            def snapshot_download(**kwargs):
                calls.append(kwargs)
                self.assertNotIn("local_dir", kwargs)
                self.assertTrue(kwargs["local_files_only"])
                return str(cached)

            args = argparse.Namespace(
                adapter_repo="esherialabs/synthetic-adapter",
                adapter_revision="a" * 40,
                adapter_safetensors_sha256=hashlib.sha256(adapter_bytes).hexdigest(),
                local_files_only=True,
            )
            run_dir = root / "run"
            run_dir.mkdir()

            with mock.patch.object(MODULE, "import_hub", return_value=(object, snapshot_download)):
                copied = MODULE.download_adapter(args, run_dir)

            self.assertEqual(len(calls), 1)
            self.assertEqual(copied, (run_dir / "adapter-snapshot").resolve())
            self.assertEqual((copied / "adapter_model.safetensors").read_bytes(), adapter_bytes)
            self.assertFalse((copied / ".cache").exists())


if __name__ == "__main__":
    unittest.main()
