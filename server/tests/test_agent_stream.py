import asyncio
import json
import unittest
from unittest.mock import patch

import httpx
import api


class FakeAdapter:
    name = 'fake'
    model = 'test'


class AgentStreamTests(unittest.IsolatedAsyncioTestCase):
    async def test_events_are_typed_and_unknown_mode_422(self):
        async def fake_run(body, session, provider, model, emit, cancelled):
            emit({'type': 'run.started', 'mode': body.mode})
            emit({'type': 'assistant.delta', 'text': 'answer'})
            emit({'type': 'run.completed', 'status': 'completed', 'sources': []})
        api.SESSIONS['test'] = (FakeAdapter(), asyncio.Lock())
        try:
            with patch('api.run_selected', side_effect=fake_run):
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api.app),
                                             base_url='http://test') as client:
                    bad = await client.post('/sessions/test/agent/stream',
                                            json={'prompt': 'q', 'mode': 'run_shell'},
                                            headers={'Authorization': f'Bearer {api.API_TOKEN}'})
                    self.assertEqual(bad.status_code, 422)
                    good = await client.post('/sessions/test/agent/stream',
                                             json={'prompt': 'question', 'mode': 'research'},
                                             headers={'Authorization': f'Bearer {api.API_TOKEN}'})
            self.assertEqual(good.status_code, 200)
            events = [json.loads(line[6:]) for line in good.text.splitlines()
                      if line.startswith('data: ')]
            self.assertEqual([event['type'] for event in events],
                             ['run.started', 'assistant.delta', 'run.completed'])
        finally:
            del api.SESSIONS['test']


if __name__ == '__main__':
    unittest.main()
