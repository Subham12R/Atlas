import unittest
import asyncio
from unittest.mock import patch

from fastapi.testclient import TestClient
import api


class RoutingApiTests(unittest.TestCase):
    def test_autoroute_is_authenticated_local_only_and_explainable(self):
        with patch.object(api, 'API_TOKEN', 'a' * 64), \
             patch.object(api.credentials_store, 'get_value', return_value='installed:7b'), \
             patch.object(api, '_local_base_url', return_value='http://127.0.0.1:11434/v1'), \
             TestClient(api.app) as client:
            body = {'prompt': 'Fix this function', 'mode': 'auto'}
            self.assertEqual(client.post('/routing/turn', json=body).status_code, 401)
            headers = {'Authorization': 'Bearer ' + 'a' * 64}
            result = client.post('/routing/turn', json=body, headers=headers)
            self.assertEqual(result.status_code, 200)
            self.assertEqual({k: result.json()[k] for k in ('state', 'mode', 'provider', 'model')},
                             {'state': 'ready', 'mode': 'coding', 'provider': 'local', 'model': 'installed:7b'})
            self.assertTrue(result.json()['reason'])
            forbidden = client.post('/routing/turn', json={**body, 'preference': {'provider': 'openai', 'model': 'gpt-4o'}}, headers=headers)
            self.assertEqual(forbidden.json()['state'], 'no_eligible_model')
            self.assertIsNone(forbidden.json()['provider'])
            self.assertEqual(client.post('/routing/turn', json={**body, 'mode': 'unknown'}, headers=headers).status_code, 422)

    def test_discovered_local_model_is_eligible_without_saved_default(self):
        with patch.object(api, 'API_TOKEN', 'a' * 64), \
             patch.object(api.credentials_store, 'get_value', return_value=''), \
             patch.object(api, '_local_base_url', return_value='http://127.0.0.1:11434/v1'), \
             patch.object(api, '_discover_local_models', return_value=['installed:7b', 'embed-small']), \
             TestClient(api.app) as client:
            result = client.post('/routing/turn', json={'prompt': 'Fix this function', 'preference':
                                 {'provider': 'local', 'model': 'installed:7b'}},
                                 headers={'Authorization': 'Bearer ' + 'a' * 64})
            self.assertEqual(result.json()['model'], 'installed:7b')
            blocked = client.post('/routing/turn', json={'prompt': 'Fix this function', 'preference':
                                  {'provider': 'local', 'model': 'embed-small'}},
                                  headers={'Authorization': 'Bearer ' + 'a' * 64})
            self.assertEqual(blocked.json()['state'], 'no_eligible_model')

    def test_auto_disables_cloud_summarizer_before_local_turn(self):
        class LocalWriter:
            name = 'local'
            _client = type('Client', (), {'base_url': 'http://127.0.0.1:11434/v1'})()
        class BrainLike:
            provider = 'local'
            adapter = LocalWriter()
            summarizer = object()
            auto_summary = True
            async def send(self, *_):
                if self.auto_summary:
                    raise AssertionError('cloud summarizer would receive this turn')
                return type('Reply', (), {'text': 'safe', 'provider': 'local', 'meta': None})()
        session = BrainLike()
        api.SESSIONS['local-fixture'] = (session, asyncio.Lock())
        try:
            with patch.object(api, 'API_TOKEN', 'a' * 64), TestClient(api.app) as client:
                result = client.post('/sessions/local-fixture/messages', json={'prompt': 'hello'},
                                     headers={'Authorization': 'Bearer ' + 'a' * 64})
                self.assertEqual(result.status_code, 200)
                self.assertEqual(result.json()['text'], 'safe')
                self.assertFalse(session.auto_summary)
        finally:
            api.SESSIONS.pop('local-fixture', None)

    def test_remote_local_adapter_is_not_an_auto_escape_hatch(self):
        with patch.object(api, 'API_TOKEN', 'a' * 64), \
             patch.object(api.credentials_store, 'get_value', return_value='installed:7b'), \
             patch.object(api, '_local_base_url', return_value='https://remote.example/v1'), \
             TestClient(api.app) as client:
            result = client.post('/routing/turn', json={'prompt': 'Fix this function'},
                                 headers={'Authorization': 'Bearer ' + 'a' * 64})
            self.assertEqual(result.json()['state'], 'no_eligible_model')
        class RemoteAdapter:
            name = 'local'
            _client = type('Client', (), {'base_url': 'https://remote.example/v1'})()
        api.SESSIONS['remote-fixture'] = (RemoteAdapter(), asyncio.Lock())
        try:
            with patch.object(api, 'API_TOKEN', 'a' * 64), TestClient(api.app) as client:
                response = client.post('/sessions/remote-fixture/messages',
                    json={'prompt': 'hello'}, headers={'Authorization': 'Bearer ' + 'a' * 64})
                self.assertEqual(response.status_code, 403)
        finally:
            api.SESSIONS.pop('remote-fixture', None)

    def test_direct_auto_turn_cannot_bypass_local_only_policy(self):
        class CloudAdapter:
            name = 'openai'
            async def send(self, *_):
                raise AssertionError('cloud send must not be invoked')
            async def send_stream(self, *_):
                raise AssertionError('cloud stream must not be invoked')
                yield ''
        api.SESSIONS['cloud-fixture'] = (CloudAdapter(), asyncio.Lock())
        try:
            with patch.object(api, 'API_TOKEN', 'a' * 64), TestClient(api.app) as client:
                headers = {'Authorization': 'Bearer ' + 'a' * 64}
                for path in ('messages', 'messages/stream'):
                    response = client.post('/sessions/cloud-fixture/' + path,
                                           json={'prompt': 'hello', 'mode': 'auto'}, headers=headers)
                    self.assertEqual(response.status_code, 403)
                once = client.post('/chat', json={'prompt': 'hello', 'mode': 'auto',
                                                  'provider': 'openai'}, headers=headers)
                self.assertEqual(once.status_code, 403)
        finally:
            api.SESSIONS.pop('cloud-fixture', None)

    def test_unconfigured_local_model_never_silently_routes_cloud(self):
        with patch.object(api, 'API_TOKEN', 'a' * 64), \
             patch.object(api.credentials_store, 'get_value', return_value=''), \
             patch.object(api, '_local_base_url', return_value='http://127.0.0.1:11434/v1'), \
             patch.object(api, '_discover_local_models', return_value=[]), \
             TestClient(api.app) as client:
            result = client.post('/routing/turn', json={'prompt': 'hello'},
                                 headers={'Authorization': 'Bearer ' + 'a' * 64})
            self.assertEqual(result.json()['state'], 'no_eligible_model')
