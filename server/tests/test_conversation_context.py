"""Each turn must see the chat's own conversation, however its server session came to be."""
import asyncio
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

import api
from adapters.anthropic_adapter import AnthropicAdapter
from adapters.base import alternating_turns
from adapters.openai_adapter import OpenAIAdapter
from tools.contracts import AgentTurnRequest

HEADERS = {'Authorization': 'Bearer ' + 'a' * 64}
HISTORY = [{'role': 'user', 'content': 'Our project label is silverpine.'},
           {'role': 'assistant', 'content': 'Noted: silverpine.'}]


class ConversationHistoryTests(unittest.TestCase):
    def test_openai_turn_is_sent_with_the_client_history(self):
        sent = []

        async def create(**kwargs):
            sent.append(kwargs['messages'])
            message = type('M', (), {'content': 'silverpine'})()
            return type('R', (), {'choices': [type('C', (), {'message': message})()],
                                  'model': 'gpt-4o', 'usage': None})()

        adapter = OpenAIAdapter('key')
        adapter.set_history([(t['role'], t['content']) for t in HISTORY])
        with patch.object(adapter._client.chat.completions, 'create', side_effect=create):
            asyncio.run(adapter.send('What label did we choose?'))
            # A second reset replaces (never duplicates) what the session held.
            adapter.set_history([(t['role'], t['content']) for t in HISTORY])
            asyncio.run(adapter.send('Again?'))
        self.assertEqual([m['content'] for m in sent[0]],
                         [HISTORY[0]['content'], HISTORY[1]['content'], 'What label did we choose?'])
        self.assertEqual(len(sent[1]), 3)

    def test_history_is_normalized_to_alternating_turns_starting_with_the_user(self):
        turns = [('assistant', 'Hi'), ('user', 'a'), ('user', 'b'), ('assistant', 'c')]
        self.assertEqual(alternating_turns(turns), [('user', 'a\n\nb'), ('assistant', 'c')])
        adapter = AnthropicAdapter('key')
        adapter.set_history(turns)
        self.assertEqual(adapter._messages, [{'role': 'user', 'content': 'a\n\nb'},
                                             {'role': 'assistant', 'content': 'c'}])

    def test_stream_endpoint_resets_the_writer_to_the_sent_history(self):
        class Writer:
            name = 'local'
            _client = type('Client', (), {'base_url': 'http://127.0.0.1:11434/v1'})()
            history = None

            def set_history(self, turns):
                self.history = turns

            async def send_stream(self, prompt, images=None):
                yield 'ok'

        writer = Writer()
        api.SESSIONS['ctx'] = (writer, asyncio.Lock())
        try:
            with patch.object(api, 'API_TOKEN', 'a' * 64), TestClient(api.app) as client:
                client.post('/sessions/ctx/messages/stream', headers=HEADERS,
                            json={'prompt': 'What label?', 'history': HISTORY})
                self.assertEqual(writer.history, [(t['role'], t['content']) for t in HISTORY])
                too_long = client.post('/sessions/ctx/messages/stream', headers=HEADERS, json={
                    'prompt': 'x', 'history': [{'role': 'user', 'content': 'y' * 8000}] * 5})
                self.assertEqual(too_long.status_code, 422)
        finally:
            api.SESSIONS.pop('ctx', None)

    def test_recreated_session_resumes_the_chats_memory_thread(self):
        captured = {}

        def build(provider, anonymous, model, thread_id=None):
            captured['thread_id'] = thread_id
            adapter = type('A', (), {'thread_id': thread_id})()

            async def init():
                return None
            adapter.init = init
            return adapter

        thread = 'ab' * 16
        with patch.object(api, 'API_TOKEN', 'a' * 64), patch.object(api, '_build', side_effect=build), \
             TestClient(api.app) as client:
            created = client.post('/sessions', headers=HEADERS,
                                  json={'provider': 'local', 'thread_id': thread})
            self.assertEqual(created.json()['thread_id'], thread)
            self.assertEqual(captured['thread_id'], thread)
            bad = client.post('/sessions', headers=HEADERS, json={'provider': 'local', 'thread_id': '../x'})
            self.assertEqual(bad.status_code, 422)
        for sid in [s for s in api.SESSIONS if s != 'ctx']:
            api.SESSIONS.pop(sid, None)

    def test_agent_turns_accept_a_longer_bounded_history(self):
        turns = [{'role': 'user' if i % 2 == 0 else 'assistant', 'content': f'turn {i}'} for i in range(12)]
        self.assertEqual(len(AgentTurnRequest(prompt='q', recent=turns).recent), 12)


if __name__ == '__main__':
    unittest.main()
