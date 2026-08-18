import importlib.util
import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
SCRIPT = ROOT / "scripts" / "saferide-gemma4-v058-hf-benchmark-publish.py"


def load_module():
    spec = importlib.util.spec_from_file_location("saferide_hf_benchmark_publish", SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class BenchmarkPublicationContractTest(unittest.TestCase):
    def test_local_packages_are_allowlisted_and_hash_bound(self):
        module = load_module()
        packages = module.local_packages()
        self.assertEqual(set(packages), {"adapter", "mobile"})
        expected_paths = {
            "README.md",
            "benchmarks/README.md",
            "benchmarks/EXTERNAL_STANDARD_BENCHMARK_PLAN.md",
            "benchmarks/saferide-v058-standardized-benchmark-summary-2026-08-13.json",
            "benchmarks/saferide-v058-standardized-benchmark-summary-2026-08-13.csv",
        }
        for package in packages.values():
            self.assertEqual(set(package), expected_paths)
            self.assertFalse(any(path.endswith(".safetensors") for path in package))
            self.assertFalse(any(path.endswith(".litertlm") for path in package))

        json_file = packages["mobile"][
            "benchmarks/saferide-v058-standardized-benchmark-summary-2026-08-13.json"
        ]
        csv_file = packages["mobile"][
            "benchmarks/saferide-v058-standardized-benchmark-summary-2026-08-13.csv"
        ]
        self.assertEqual(
            json_file["sha256"],
            "50ca1bd8b58cff18eaeae85344a57011c5e0cf6d91b76b63ff51419f9128a7c2",
        )
        self.assertEqual(
            csv_file["sha256"],
            "21bed0fc99d36c5aa4b758c10e56b1bc8a97c242c5c2f55c786639c4bc6f4065",
        )

    def test_expected_heads_match_current_publication_evidence(self):
        module = load_module()
        heads = {item["key"]: item["expectedHead"] for item in module.REPOSITORIES}
        self.assertEqual(heads["adapter"], "01db593570c77b65597e987b23ffe5a07397f57c")
        self.assertEqual(heads["mobile"], "9901b122507e4f4f1f03fe414f8ed1778878e4b8")

    def test_result_must_remain_outside_repository(self):
        module = load_module()
        with self.assertRaisesRegex(RuntimeError, "outside repository"):
            module.safe_result_path(str(ROOT / "publication-result.json"))


if __name__ == "__main__":
    unittest.main()
