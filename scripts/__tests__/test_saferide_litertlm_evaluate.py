import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = REPO_ROOT / "scripts" / "saferide-litertlm-evaluate.py"
SPEC = importlib.util.spec_from_file_location("saferide_litertlm_evaluate", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class SafeRideLiteRtLmEvaluateTests(unittest.TestCase):
    def test_digest_string_values_never_retains_raw_text(self):
        raw = {
            "content": [{"text": "synthetic completion"}],
            "role": "model",
            "count": 2,
        }

        digested = MODULE.digest_string_values(raw)
        encoded = json.dumps(digested)

        self.assertNotIn("synthetic completion", encoded)
        self.assertNotIn("model", encoded)
        self.assertEqual(
            digested["content"][0]["text"]["sha256"],
            hashlib.sha256(b"synthetic completion").hexdigest(),
        )
        self.assertEqual(digested["count"], 2)

    def test_extract_response_text_only_uses_content_and_text_fields(self):
        response = {
            "role": "model",
            "content": [{"type": "text", "text": "first"}, "second"],
            "metadata": {"label": "ignored"},
        }

        self.assertEqual(MODULE.extract_response_text(response), ["first", "second"])

    def test_load_verified_system_prompt_rejects_changed_text(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "prompt.json"
            path.write_text(
                json.dumps(
                    {
                        "promptId": "prompt",
                        "policyId": "policy",
                        "text": "changed",
                        "textSha256": "0" * 64,
                    }
                ),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(ValueError, "system prompt text hash mismatch"):
                MODULE.load_verified_system_prompt(path)


if __name__ == "__main__":
    unittest.main()
