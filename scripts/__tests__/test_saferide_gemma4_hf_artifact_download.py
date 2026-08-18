from __future__ import annotations

import importlib.util
import io
import json
import pathlib
import tempfile
import unittest
from email.message import Message
from unittest import mock


MODULE_PATH = pathlib.Path(__file__).resolve().parents[1] / "saferide-gemma4-hf-artifact-download.py"
SPEC = importlib.util.spec_from_file_location("saferide_gemma4_hf_artifact_download", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class FakeResponse(io.BytesIO):
    def __init__(self, body: bytes, *, status: int, headers: dict[str, str] | None = None) -> None:
        super().__init__(body)
        self.status = status
        self.headers = Message()
        for key, value in (headers or {}).items():
            self.headers[key] = value

    def getcode(self) -> int:
        return self.status


class SafeRideGemma4ArtifactDownloadTests(unittest.TestCase):
    def test_parses_structured_v058_manifest(self) -> None:
        manifest = MODULE.parse_manifest()

        self.assertEqual(
            manifest["repo_id"],
            "esherialabs/saferide-gemma-4-e2b-v058-original-419806-litertlm",
        )
        self.assertEqual(manifest["revision"], "e91ea27c3134fe21fc5bc995141675756e2c4a21")
        self.assertEqual(manifest["size_bytes"], 5_071_837_136)
        self.assertEqual(
            manifest["sha256"],
            "8b73fd844464f220955eeedc474c30f39e621458c7a6b092de5afa2c3d027fcd",
        )

    def test_rejects_immutable_location_that_does_not_match_model(self) -> None:
        payload = json.loads(MODULE.MANIFEST_PATH.read_text(encoding="utf-8"))
        payload["artifact"]["immutableLocation"] = payload["artifact"]["immutableLocation"].replace(
            "/esherialabs/", "/different-org/"
        )
        with tempfile.TemporaryDirectory() as temporary:
            path = pathlib.Path(temporary) / "manifest.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "does not match"):
                MODULE.parse_manifest(path)

    def test_anonymous_probe_verifies_revision_hash_size_and_range(self) -> None:
        manifest = MODULE.parse_manifest()
        metadata = {
            "sha": manifest["revision"],
            "siblings": [
                {
                    "rfilename": manifest["filename"],
                    "lfs": {
                        "size": manifest["size_bytes"],
                        "oid": manifest["sha256"],
                    },
                }
            ],
        }
        responses = [
            FakeResponse(json.dumps(metadata).encode("utf-8"), status=200),
            FakeResponse(
                b"x",
                status=206,
                headers={"Content-Range": f"bytes 0-0/{manifest['size_bytes']}"},
            ),
        ]

        with mock.patch.object(MODULE.urllib.request, "urlopen", side_effect=responses) as urlopen:
            MODULE.verify_public_hub_metadata(manifest)
            MODULE.verify_range_support(manifest)

        self.assertEqual(urlopen.call_count, 2)
        metadata_request = urlopen.call_args_list[0].args[0]
        self.assertIn("?blobs=true", metadata_request.full_url)
        range_request = urlopen.call_args_list[1].args[0]
        self.assertEqual(range_request.get_header("Range"), "bytes=0-0")

    def test_range_probe_rejects_non_resumable_endpoint(self) -> None:
        manifest = MODULE.parse_manifest()
        response = FakeResponse(b"x", status=200, headers={"Content-Length": "1"})
        with mock.patch.object(MODULE.urllib.request, "urlopen", return_value=response):
            with self.assertRaisesRegex(RuntimeError, "must support one-byte range"):
                MODULE.verify_range_support(manifest)


if __name__ == "__main__":
    unittest.main()
