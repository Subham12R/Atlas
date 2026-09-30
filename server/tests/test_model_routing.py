import unittest

from policy import ExecutionMode, ExecutionPolicy, ModelCandidate
from routing import choose_model, classify_mode, is_loopback_endpoint


class ModelRoutingTests(unittest.TestCase):
    def setUp(self):
        self.local = ModelCandidate('local', 'installed:7b', frozenset({'research', 'coding', 'documentation'}), True)
        self.cloud = ModelCandidate('openai', 'cloud', frozenset({'research', 'coding', 'documentation'}), False)

    def test_auto_never_treats_a_remote_compatible_endpoint_as_local(self):
        self.assertTrue(is_loopback_endpoint('http://127.0.0.1:11434/v1'))
        self.assertTrue(is_loopback_endpoint('http://localhost:1234/v1'))
        for url in ('https://remote.example/v1', 'http://127.0.0.1.evil.test/v1',
                    'http://user@localhost:11434/v1', 'file:///tmp/model'):
            self.assertFalse(is_loopback_endpoint(url))

    def test_auto_classifies_explicit_modes_win_and_ambiguous_degrades(self):
        self.assertEqual(classify_mode('Fix this Python function', ExecutionMode.AUTO), (ExecutionMode.CODING, False))
        self.assertEqual(classify_mode('Research recent case law', ExecutionMode.AUTO), (ExecutionMode.RESEARCH, False))
        self.assertEqual(classify_mode('Write a README', ExecutionMode.AUTO), (ExecutionMode.DOCUMENTATION, False))
        self.assertEqual(classify_mode('Fix this function', ExecutionMode.RESEARCH), (ExecutionMode.RESEARCH, False))
        self.assertEqual(classify_mode('hello', ExecutionMode.AUTO), (ExecutionMode.DOCUMENTATION, True))

    def test_filters_before_preference_and_never_silently_falls_back(self):
        selected = choose_model('Fix this function', ExecutionMode.AUTO, [self.cloud, self.local], ExecutionPolicy())
        self.assertEqual((selected.state, selected.provider, selected.model, selected.mode),
                         ('ready', 'local', 'installed:7b', ExecutionMode.CODING))
        blocked = choose_model('Fix this function', ExecutionMode.AUTO, [self.cloud, self.local],
                               ExecutionPolicy(), ('openai', 'cloud'))
        self.assertEqual(blocked.state, 'no_eligible_model')
        self.assertIsNone(blocked.provider)
        preferred = choose_model('Fix this function', ExecutionMode.AUTO, [self.cloud, self.local],
                                 ExecutionPolicy(), ('local', 'installed:7b'))
        self.assertEqual(preferred.model, 'installed:7b')
        self.assertEqual(choose_model('Fix this function', ExecutionMode.AUTO, [self.cloud],
                                      ExecutionPolicy()).state, 'no_eligible_model')

    def test_low_confidence_uses_local_text_only_and_marks_degraded(self):
        decision = choose_model('hello', ExecutionMode.AUTO, [self.local], ExecutionPolicy())
        self.assertEqual((decision.state, decision.mode), ('degraded', ExecutionMode.DOCUMENTATION))
        self.assertIn('low confidence', decision.reason)
        self.assertEqual(choose_model('write a guide', ExecutionMode.AUTO,
                                      [ModelCandidate('local', 'code-only', frozenset({'coding'}), True)],
                                      ExecutionPolicy()).state, 'no_eligible_model')
