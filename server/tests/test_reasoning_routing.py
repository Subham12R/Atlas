import asyncio
import unittest
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient
from openai import BadRequestError

import api
from adapters.anthropic_adapter import AnthropicAdapter
from adapters.local_adapter import LocalAdapter
from policy import ExecutionMode
from reasoning import anthropic_thinking, auto_level, gemini_thinking, openai_effort

HEADERS = {'Authorization': 'Bearer ' + 'a' * 64}


class ReasoningMappingTests(unittest.TestCase):
    def test_levels_map_to_native_parameters_and_never_to_unsupported_models(self):
        self.assertIsNone(openai_effort('gpt-4o', 'high'))
        self.assertEqual(openai_effort('o4-mini', 'off'), 'low')
        self.assertEqual(openai_effort('gpt-5.1', 'off'), 'none')
        self.assertEqual(openai_effort('o4-mini', 'max'), 'high')
        self.assertIsNone(anthropic_thinking('off'))
        self.assertEqual(anthropic_thinking('max'), 16000)
        self.assertEqual(gemini_thinking('gemini-2.5-flash', 'off'), {'thinking_budget': 0, 'include_thoughts': False})
        self.assertEqual(gemini_thinking('gemini-2.5-pro', 'off'), {'thinking_budget': 128, 'include_thoughts': True})
        self.assertIsNone(gemini_thinking('gemini-1.5-flash', 'high'))

    def test_auto_level_follows_mode_but_never_exceeds_the_ceiling(self):
        self.assertEqual(auto_level(ExecutionMode.RESEARCH, 'max', False, False), 'high')
        self.assertEqual(auto_level(ExecutionMode.RESEARCH, 'low', False, False), 'low')
        self.assertEqual(auto_level(ExecutionMode.CODING, 'max', True, False), 'low')
        self.assertEqual(auto_level(ExecutionMode.CODING, 'off', False, False), 'off')

    def test_anthropic_thinking_raises_max_tokens_above_budget(self):
        adapter = AnthropicAdapter('key')
        adapter.reasoning = 'high'
        kwargs = adapter._chat_kwargs()
        self.assertEqual(kwargs['thinking'], {'type': 'enabled', 'budget_tokens': 8192})
        self.assertGreater(kwargs['max_tokens'], 8192)
        adapter.reasoning = 'off'
        self.assertNotIn('thinking', adapter._chat_kwargs())

    def test_local_model_that_rejects_reasoning_is_retried_once_without_it(self):
        calls = []

        async def create(**kwargs):
            calls.append(kwargs)
            if 'reasoning_effort' in kwargs:
                raise BadRequestError('model does not support thinking', body=None,
                                      response=httpx.Response(400, request=httpx.Request('POST', 'http://x')))
            message = type('M', (), {'content': 'ok'})()
            return type('R', (), {'choices': [type('C', (), {'message': message})()],
                                  'model': 'm', 'usage': None})()

        adapter = LocalAdapter(base_url='http://127.0.0.1:11434/v1', model='m')
        adapter.reasoning = 'high'
        with patch.object(adapter._client.chat.completions, 'create', side_effect=create):
            self.assertEqual(asyncio.run(adapter.send('hi')).text, 'ok')
            asyncio.run(adapter.send('again'))
        self.assertEqual([c.get('reasoning_effort') for c in calls], ['high', None, None])


class AutoRoutePolicyTests(unittest.TestCase):
    def route(self, keys: dict, local: list[str], **body):
        with patch.object(api, 'API_TOKEN', 'a' * 64), \
             patch.object(api.credentials_store, 'get_value', side_effect=lambda k: keys.get(k, '')), \
             patch.object(api, '_local_base_url', return_value='http://127.0.0.1:11434/v1'), \
             patch.object(api, '_discover_local_models', return_value=local), \
             TestClient(api.app) as client:
            return client.post('/routing/turn', json=body, headers=HEADERS).json()

    def test_auto_uses_cloud_only_after_opt_in_and_prefers_local(self):
        keys = {'OPENAI_API_KEY': 'k'}
        self.assertEqual(self.route(keys, [], prompt='Fix this function')['state'], 'no_eligible_model')
        cloud = self.route(keys, [], prompt='Fix this function', allow_cloud=True)
        self.assertEqual((cloud['provider'], cloud['model'], cloud['reasoning']), ('openai', 'gpt-4o', 'medium'))
        local = self.route(keys, ['installed:7b'], prompt='Fix this function', allow_cloud=True)
        self.assertEqual(local['provider'], 'local')

    def test_auto_calls_tools_for_current_information(self):
        keys = {'OPENAI_API_KEY': 'k', 'TAVILY_API_KEY': 't'}
        cloud = self.route(keys, [], prompt="What's the latest news on the merger?", allow_cloud=True)
        self.assertEqual((cloud['tool'], cloud['reasoning']), ('safeTools', 'low'))
        local = self.route(keys, ['installed:7b'], prompt="What's the latest news on the merger?")
        self.assertEqual((local['provider'], local['tool']), ('local', 'searchWeb'))
        offline = self.route({}, ['installed:7b'], prompt="What's the latest news on the merger?")
        self.assertEqual((offline['tool'], offline['state']), (None, 'degraded'))
        self.assertIn('no search key', offline['reason'])
        plain = self.route(keys, ['installed:7b'], prompt='Fix this function')
        self.assertIsNone(plain['tool'])

    def test_picked_model_gets_exact_level_and_tool_mode_needs_tool_support(self):
        keys = {'OPENAI_API_KEY': 'k'}
        picked = self.route(keys, [], prompt='hello', reasoning='max',
                            preference={'provider': 'openai', 'model': ''})
        self.assertEqual((picked['provider'], picked['reasoning']), ('openai', 'max'))
        no_tools = self.route(keys, ['installed:7b'], prompt='compare these', agent_mode='tools')
        self.assertEqual(no_tools['state'], 'no_eligible_model')
        tools = self.route(keys, ['installed:7b'], prompt='compare these', agent_mode='tools', allow_cloud=True)
        self.assertEqual(tools['provider'], 'openai')


if __name__ == '__main__':
    unittest.main()
