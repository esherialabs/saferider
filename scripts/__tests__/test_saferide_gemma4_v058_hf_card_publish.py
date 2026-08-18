from __future__ import annotations

import importlib.util
import json
import pathlib
import re
import stat
import tempfile
import unittest
from types import SimpleNamespace
from unittest import mock


MODULE_PATH = pathlib.Path(__file__).resolve().parents[1] / "saferide-gemma4-v058-hf-card-publish.py"
SPEC = importlib.util.spec_from_file_location("saferide_v058_hf_card_publish", MODULE_PATH)
assert SPEC is not None and SPEC.loader is not None
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class FakeCard:
    @classmethod
    def load(cls, path: str) -> object:
        source = pathlib.Path(path)
        if not source.is_file():
            raise AssertionError(f"missing card: {path}")
        content = source.read_text(encoding="utf-8")
        match = re.search(r"^license:\s*([^\s]+)\s*$", content, flags=re.MULTILINE)
        if match is None:
            raise AssertionError(f"missing license metadata: {path}")
        return SimpleNamespace(data=SimpleNamespace(license=match.group(1)))


class FakeHub:
    def __init__(
        self,
        *,
        token_role: str = "fineGrained",
        public_repo: str | None = None,
        unexpected_head_repo: str | None = None,
        mutate_after_upload_repo: str | None = None,
    ) -> None:
        self.token_role = token_role
        self.public_repo = public_repo
        self.unexpected_head_repo = unexpected_head_repo
        self.mutate_after_upload_repo = mutate_after_upload_repo
        self.uploads: list[dict[str, object]] = []
        self.settings_updates: list[dict[str, object]] = []
        self.uploaded_revisions: dict[str, str] = {}
        self.uploaded_files: dict[str, dict[str, bytes]] = {}
        self.repo_private = {
            spec["repoId"]: spec["repoId"] != public_repo for spec in MODULE.REPOSITORIES
        }
        self.revisions = {
            spec["repoId"]: chr(ord("a") + index) * 40
            for index, spec in enumerate(MODULE.REPOSITORIES)
        }

    def api_class(self):
        outer = self

        class FakeApi:
            def __init__(self, *, token: object) -> None:
                self.token = token

            def whoami(self, *, token: str) -> dict[str, object]:
                return {"auth": {"accessToken": {"role": outer.token_role}}}

            def dataset_info(self, repo_id: str, **kwargs: object) -> SimpleNamespace:
                return outer.info(repo_id, kwargs.get("revision"))

            def model_info(self, repo_id: str, **kwargs: object) -> SimpleNamespace:
                return outer.info(repo_id, kwargs.get("revision"))

            def upload_folder(self, **kwargs: object) -> SimpleNamespace:
                repo_id = str(kwargs["repo_id"])
                outer.uploads.append(kwargs)
                folder = pathlib.Path(str(kwargs["folder_path"]))
                allowed = {str(value) for value in kwargs["allow_patterns"]}
                outer.uploaded_files[repo_id] = {
                    path: (folder / path).read_bytes() for path in allowed
                }
                revision = outer.revisions[repo_id]
                outer.uploaded_revisions[repo_id] = revision
                return SimpleNamespace(oid=revision)

            def update_repo_settings(self, **kwargs: object) -> None:
                repo_id = str(kwargs["repo_id"])
                outer.settings_updates.append(kwargs)
                if kwargs.get("private") is not None:
                    outer.repo_private[repo_id] = bool(kwargs["private"])

        return FakeApi

    def info(self, repo_id: str, revision: object) -> SimpleNamespace:
        spec = next(spec for spec in MODULE.REPOSITORIES if spec["repoId"] == repo_id)
        if revision is not None:
            sha = str(revision)
        elif repo_id in self.uploaded_revisions:
            sha = self.uploaded_revisions[repo_id]
        elif repo_id == self.unexpected_head_repo:
            sha = "f" * 40
        else:
            sha = spec["expectedHead"]

        non_readme_blob = "1" * 40
        if repo_id == self.mutate_after_upload_repo and revision is not None:
            non_readme_blob = "2" * 40
        siblings = [
            SimpleNamespace(
                rfilename="artifact.bin",
                size=123,
                blob_id=non_readme_blob,
                lfs=SimpleNamespace(sha256="3" * 64, size=123),
            ),
        ]
        managed_paths = {remote_path for remote_path, _ in spec["managedFiles"]}
        for path in sorted(managed_paths):
            content = self.uploaded_files.get(repo_id, {}).get(path, b"existing")
            siblings.append(
                SimpleNamespace(
                    rfilename=path,
                    size=len(content),
                    blob_id=("0" if path == "README.md" else "4") * 40,
                    lfs=None,
                )
            )
        return SimpleNamespace(
            private=self.repo_private[repo_id],
            gated=False,
            sha=sha,
            siblings=siblings,
        )

    def download(self, *, repo_id: str, filename: str, local_dir: str, **_kwargs: object) -> str:
        spec = next(spec for spec in MODULE.REPOSITORIES if spec["repoId"] == repo_id)
        local_path = dict(spec["managedFiles"])[filename]
        source = MODULE.REPO_ROOT / local_path
        destination = pathlib.Path(local_dir) / filename
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(self.uploaded_files.get(repo_id, {}).get(filename, source.read_bytes()))
        return str(destination)

    @staticmethod
    def metadata(*_args: object, **_kwargs: object) -> SimpleNamespace:
        return SimpleNamespace(size=123, etag="3" * 64)

    @staticmethod
    def url(*_args: object, **_kwargs: object) -> str:
        return "https://huggingface.invalid/public-artifact"

    def imported(self) -> tuple[object, object, object, object, object, object]:
        return self.api_class(), self.download, FakeCard, FakeCard, self.metadata, self.url


class V058HfCardPublishTests(unittest.TestCase):
    def test_local_cards_parse_and_bind_expected_files(self) -> None:
        fake = FakeHub()
        with mock.patch.object(MODULE, "import_hub", return_value=fake.imported()):
            cards = MODULE.local_cards()

        self.assertEqual(set(cards), {"dataset", "adapter", "mobile"})
        for spec in MODULE.REPOSITORIES:
            card = cards[spec["key"]]
            self.assertEqual(card["path"], (MODULE.REPO_ROOT / spec["localPath"]).resolve())
            self.assertEqual(len(card["sha256"]), 64)
            self.assertGreater(card["sizeBytes"], 1_000)
            self.assertEqual(card["license"], spec["expectedLicense"])
            self.assertEqual(set(card["files"]), {path for path, _ in spec["managedFiles"]})

    def test_publication_uploads_only_managed_docs_makes_public_and_verifies_anonymously(self) -> None:
        fake = FakeHub()
        with tempfile.TemporaryDirectory() as temporary:
            result_path = pathlib.Path(temporary) / "publication.json"
            with (
                mock.patch.object(MODULE, "import_hub", return_value=fake.imported()),
                mock.patch.object(
                    MODULE,
                    "anonymous_artifact_checks",
                    return_value={"artifact.bin": {"verified": True}},
                ),
            ):
                result = MODULE.publish_cards(
                    "fresh-token",
                    result_path,
                    public_release_authorized=True,
                )

            recorded = json.loads(result_path.read_text(encoding="utf-8"))
            permissions = stat.S_IMODE(result_path.stat().st_mode)

        self.assertEqual(result["status"], "public-documentation-and-artifact-access-verified")
        self.assertEqual(recorded, result)
        self.assertEqual(permissions & 0o077, 0)
        self.assertEqual(len(fake.uploads), 3)
        self.assertEqual(len(fake.settings_updates), 3)
        for upload, spec in zip(fake.uploads, MODULE.REPOSITORIES, strict=True):
            self.assertEqual(upload["parent_commit"], spec["expectedHead"])
            self.assertEqual(upload["repo_type"], spec["repoType"])
            expected_paths = sorted(path for path, _ in spec["managedFiles"])
            self.assertEqual(upload["allow_patterns"], expected_paths)
            publication = result["repositories"][spec["key"]]
            self.assertEqual(publication["artifactRevision"], spec["artifactRevision"])
            self.assertEqual(publication["license"], spec["expectedLicense"])
            self.assertEqual(publication["uploadedPaths"], expected_paths)
            self.assertTrue(publication["downloadedBytesMatched"])
            self.assertTrue(publication["artifactInventoryUnchanged"])
            self.assertEqual(set(publication["files"]), set(expected_paths))
            self.assertFalse(publication["privateAfter"])
            self.assertTrue(publication["publicAfter"])
            self.assertFalse(publication["gatedAfter"])
            self.assertTrue(publication["anonymousAccessVerified"])

    def test_preflight_rejects_a_public_repository_before_upload(self) -> None:
        repo_id = MODULE.REPOSITORIES[1]["repoId"]
        fake = FakeHub(public_repo=repo_id)
        with tempfile.TemporaryDirectory() as temporary:
            result_path = pathlib.Path(temporary) / "publication.json"
            with mock.patch.object(MODULE, "import_hub", return_value=fake.imported()):
                with self.assertRaisesRegex(RuntimeError, "Refusing non-private repository"):
                    MODULE.publish_cards(
                        "fresh-token",
                        result_path,
                        public_release_authorized=True,
                    )

        self.assertEqual(fake.uploads, [])

    def test_preflight_rejects_an_unexpected_remote_head_before_upload(self) -> None:
        repo_id = MODULE.REPOSITORIES[2]["repoId"]
        fake = FakeHub(unexpected_head_repo=repo_id)
        with tempfile.TemporaryDirectory() as temporary:
            result_path = pathlib.Path(temporary) / "publication.json"
            with mock.patch.object(MODULE, "import_hub", return_value=fake.imported()):
                with self.assertRaisesRegex(RuntimeError, "Unexpected remote head"):
                    MODULE.publish_cards(
                        "fresh-token",
                        result_path,
                        public_release_authorized=True,
                    )

        self.assertEqual(fake.uploads, [])

    def test_publication_rejects_a_non_fine_grained_token(self) -> None:
        fake = FakeHub(token_role="write")
        with tempfile.TemporaryDirectory() as temporary:
            result_path = pathlib.Path(temporary) / "publication.json"
            with mock.patch.object(MODULE, "import_hub", return_value=fake.imported()):
                with self.assertRaisesRegex(RuntimeError, "must be fine-grained"):
                    MODULE.publish_cards(
                        "broad-token",
                        result_path,
                        public_release_authorized=True,
                    )

        self.assertEqual(fake.uploads, [])

    def test_publication_records_explicit_user_authorized_write_token_exception(self) -> None:
        fake = FakeHub(token_role="write")
        with tempfile.TemporaryDirectory() as temporary:
            result_path = pathlib.Path(temporary) / "publication.json"
            with (
                mock.patch.object(MODULE, "import_hub", return_value=fake.imported()),
                mock.patch.object(
                    MODULE,
                    "anonymous_artifact_checks",
                    return_value={"artifact.bin": {"verified": True}},
                ),
            ):
                result = MODULE.publish_cards(
                    "broad-token",
                    result_path,
                    allow_user_authorized_write_token=True,
                    public_release_authorized=True,
                )

        self.assertFalse(result["credential"]["leastPrivilegeSatisfied"])
        self.assertTrue(result["credential"]["userAuthorizedWriteTokenException"])
        self.assertEqual(result["credential"]["role"], "write")

    def test_publication_rejects_an_artifact_change(self) -> None:
        repo_id = MODULE.REPOSITORIES[0]["repoId"]
        fake = FakeHub(mutate_after_upload_repo=repo_id)
        with tempfile.TemporaryDirectory() as temporary:
            result_path = pathlib.Path(temporary) / "publication.json"
            with mock.patch.object(MODULE, "import_hub", return_value=fake.imported()):
                with self.assertRaisesRegex(RuntimeError, "Artifact-bearing repository bytes changed"):
                    MODULE.publish_cards(
                        "fresh-token",
                        result_path,
                        public_release_authorized=True,
                    )
            recorded = json.loads(result_path.read_text(encoding="utf-8"))

        self.assertEqual(len(fake.uploads), 1)
        self.assertEqual(recorded["status"], "failed-private-documentation-publication")
        self.assertEqual(recorded["repositories"], {})

    def test_publication_requires_explicit_public_release_authorization(self) -> None:
        fake = FakeHub()
        with tempfile.TemporaryDirectory() as temporary:
            result_path = pathlib.Path(temporary) / "publication.json"
            with mock.patch.object(MODULE, "import_hub", return_value=fake.imported()):
                with self.assertRaisesRegex(RuntimeError, "public-release authorization"):
                    MODULE.publish_cards("fresh-token", result_path)

        self.assertEqual(fake.uploads, [])

    def test_anonymous_verification_failure_rolls_all_repositories_back_to_private(self) -> None:
        fake = FakeHub()
        with tempfile.TemporaryDirectory() as temporary:
            result_path = pathlib.Path(temporary) / "publication.json"
            with (
                mock.patch.object(MODULE, "import_hub", return_value=fake.imported()),
                mock.patch.object(
                    MODULE,
                    "anonymous_repo_info",
                    side_effect=RuntimeError("anonymous verification failed"),
                ),
            ):
                with self.assertRaisesRegex(RuntimeError, "anonymous verification failed"):
                    MODULE.publish_cards(
                        "fresh-token",
                        result_path,
                        public_release_authorized=True,
                    )
            recorded = json.loads(result_path.read_text(encoding="utf-8"))

        self.assertEqual(recorded["status"], "failed-public-release-rolled-back")
        self.assertTrue(recorded["rollback"]["attempted"])
        self.assertTrue(recorded["rollback"]["completed"])
        self.assertTrue(all(fake.repo_private.values()))

    def test_cards_do_not_retain_superseded_license_metadata(self) -> None:
        for spec in MODULE.REPOSITORIES:
            card = (MODULE.REPO_ROOT / spec["localPath"]).read_text(encoding="utf-8")
            self.assertIn(f"license: {spec['expectedLicense']}", card)
            self.assertNotIn("license: gemma", card)
            self.assertNotIn("license-pending-legal-approval", card)
            self.assertIn(MODULE.PUBLIC_CONTACT, card)


if __name__ == "__main__":
    unittest.main()
