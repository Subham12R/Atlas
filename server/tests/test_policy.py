from unittest import TestCase

from pydantic import ValidationError

from api import ChatOnce, Message
from policy import (
    ExecutionMode,
    ExecutionPolicy,
    ModelCandidate,
    eligible_models,
    resolve_explicit_mode,
)


class ModeContractTests(TestCase):
    def test_explicit_coding_mode_is_preserved(self):
        decision = resolve_explicit_mode(ExecutionMode.CODING)
        self.assertEqual(decision.requested_mode, ExecutionMode.CODING)
        self.assertEqual(decision.effective_mode, ExecutionMode.CODING)

    def test_auto_is_unresolved(self):
        decision = resolve_explicit_mode(ExecutionMode.AUTO)
        self.assertEqual(decision.requested_mode, ExecutionMode.AUTO)
        self.assertIsNone(decision.effective_mode)

    def test_unknown_mode_is_rejected(self):
        with self.assertRaises(ValueError):
            resolve_explicit_mode("unknown")

    def test_default_policy_denies_cloud_and_tools(self):
        policy = ExecutionPolicy()
        self.assertFalse(policy.allow_cloud)
        self.assertEqual(policy.allowed_tools, frozenset())

    def test_eligibility_filters_capabilities_and_cloud_before_ranking(self):
        cloud = ModelCandidate("openai", "cloud", frozenset({"research"}), is_local=False)
        local = ModelCandidate("local", "research", frozenset({"research"}), is_local=True)
        coding = ModelCandidate("local", "coding", frozenset({"coding"}), is_local=True)
        candidates = [cloud, local, coding]
        self.assertEqual(eligible_models(ExecutionMode.RESEARCH, candidates, ExecutionPolicy()), [local])
        self.assertEqual(
            eligible_models(ExecutionMode.RESEARCH, candidates, ExecutionPolicy(allow_cloud=True)),
            [cloud, local],
        )

    def test_auto_does_not_select_models_before_classification(self):
        candidate = ModelCandidate("local", "any", frozenset({"research"}), is_local=True)
        self.assertEqual(eligible_models(ExecutionMode.AUTO, [candidate], ExecutionPolicy()), [])


class RequestModeTests(TestCase):
    def test_omitted_mode_defaults_to_auto_on_both_turn_requests(self):
        for body in (Message(prompt="hello"), ChatOnce(provider="local", prompt="hello")):
            with self.subTest(type=type(body).__name__):
                self.assertEqual(body.model_dump(mode="json")["mode"], "auto")

    def test_explicit_mode_and_images_survive_request_validation(self):
        body = Message.model_validate({
            "prompt": "review this", "mode": "coding",
            "images": [{"data": "YWJj", "mime": "image/png"}],
        })
        self.assertEqual(body.model_dump(mode="json"), {
            "prompt": "review this", "images": [{"data": "YWJj", "mime": "image/png"}],
            "mode": "coding", "reasoning": None, "history": None,
        })
        once = ChatOnce.model_validate({"provider": "local", "prompt": "outline", "mode": "documentation"})
        self.assertEqual(once.mode, ExecutionMode.DOCUMENTATION)

    def test_unknown_mode_is_rejected_on_both_turn_requests(self):
        for schema, fields in ((Message, {"prompt": "hello"}),
                               (ChatOnce, {"provider": "local", "prompt": "hello"})):
            with self.subTest(type=schema.__name__), self.assertRaises(ValidationError):
                schema.model_validate({**fields, "mode": "unknown"})
