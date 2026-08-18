import importlib.util
import unittest
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = REPO_ROOT / "scripts" / "saferide-gemma4-adapter-eval.py"
SPEC = importlib.util.spec_from_file_location("saferide_gemma4_adapter_eval", MODULE_PATH)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class FakeTensor:
    def __init__(self, length: int):
        self.shape = (1, length)


class MissingTemplateTokenizer:
    pass


class FailingTemplateTokenizer:
    def apply_chat_template(self, *_args, **_kwargs):
        raise ValueError("synthetic template failure")


class ContextTokenizer:
    pad_token_id = 0
    eos_token_id = 1

    def apply_chat_template(self, *_args, **_kwargs):
        return {"input_ids": FakeTensor(900)}


class SafeRideAdapterEvalTests(unittest.TestCase):
    def test_plan_and_prompt_inventory_validate_without_ml_imports(self):
        plan, paths, prompt_config = MODULE.load_and_validate_plan(MODULE.DEFAULT_PLAN)
        prompts = MODULE.parse_prompt_suite(paths["promptSuite"])
        self.assertEqual(len(prompts), 120)
        self.assertEqual(prompt_config["textSha256"], plan["systemPrompt"]["textSha256"])
        self.assertTrue(any(row["promptId"] == "JAIL-010" for row in prompts))

    def test_v05_plan_requires_both_seed_artifacts_and_selected_checkpoint(self):
        plan_path = REPO_ROOT / "config" / "ai" / "evaluation" / "comparator-plan.v0.5.json"
        plan, paths, _prompt_config = MODULE.load_and_validate_plan(plan_path)
        self.assertEqual(
            {artifact["slot"] for artifact in plan["artifacts"]},
            {"base", "v03", "v05-seed-a", "v05-seed-b", "v05"},
        )
        prompts = MODULE.parse_prompt_suite(paths["promptSuite"])
        self.assertEqual(len(prompts), 120)

    def test_missing_or_failing_chat_template_has_no_manual_fallback(self):
        with self.assertRaises(MODULE.CanonicalTemplateError):
            MODULE.canonical_template_inputs(MissingTemplateTokenizer(), "system", "user")
        with self.assertRaises(MODULE.CanonicalTemplateError):
            MODULE.canonical_template_inputs(FailingTemplateTokenizer(), "system", "user")

    def test_context_overflow_is_explicit_and_never_truncated(self):
        completion, state = MODULE.generate_one(
            model=object(),
            tokenizer=ContextTokenizer(),
            torch=object(),
            system_prompt="system",
            user_prompt="user",
            config={
                "maxSequenceLength": 1024,
                "maxNewTokens": 256,
                "doSample": False,
                "temperature": None,
                "topP": None,
                "topK": None,
                "seed": 1,
            },
        )
        self.assertIsNone(completion)
        self.assertEqual(state["state"], "error")
        self.assertEqual(state["errorCode"], "CONTEXT_LIMIT")
        self.assertFalse(state["hitTokenCap"])

    def test_raw_output_root_must_be_git_ignored(self):
        accepted = MODULE.controlled_output_root(str(REPO_ROOT / ".ai-smoke" / "unit-test"))
        self.assertTrue(str(accepted).startswith(str(REPO_ROOT / ".ai-smoke")))
        with self.assertRaises(RuntimeError):
            MODULE.controlled_output_root(str(REPO_ROOT / "docs" / "qa"))


if __name__ == "__main__":
    unittest.main()
