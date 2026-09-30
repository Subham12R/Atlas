"""Offline checks for the public search boundary and upstream cancellation."""
import asyncio
import json
import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from pydantic import ValidationError

import api
import websearch


class FakeRequest:
    async def is_disconnected(self):
        return False


class SearchTests(unittest.IsolatedAsyncioTestCase):
    async def test_invalid_input_never_calls_upstream(self):
        for query, limit in [('', 5), (' ', 5), ('x' * 1001, 5), ('ok', 0), ('ok', 9)]:
            with self.subTest(query=query[:12], limit=limit), self.assertRaises(ValidationError):
                api.WebSearchRequest(query=query, max_results=limit)

    async def test_invalid_http_body_returns_422_without_calling_tavily(self):
        with patch.object(api.websearch, 'search') as upstream:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api.app),
                                         base_url='http://test') as client:
                for body in ({'query': ' '}, {'query': 'x' * 1001},
                             {'query': 'ok', 'max_results': 0},
                             {'query': 'ok', 'max_results': 9}):
                    with self.subTest(body=str(body)[:30]):
                        response = await client.post('/websearch', json=body,
                                                     headers={'Authorization': f'Bearer {api.API_TOKEN}'})
                        self.assertEqual(response.status_code, 422)
            upstream.assert_not_called()

    async def test_results_skip_malformed_urls_and_keep_valid_hits(self):
        malformed = json.loads((Path(__file__).parent / 'fixtures' / 'research' /
                                'search-results.json').read_text())[-1]
        class FakeResponse:
            def raise_for_status(self): pass
            def json(self):
                return {'results': [
                    {'title': 'Valid', 'url': 'https://example.org/a', 'content': 'text',
                     'published_date': '2026-01-01', 'score': 0.93},
                    {'url': 'file:///etc/passwd'}, {'url': 'http://localhost/a'},
                    {'url': 'not-a-url'}, {'url': 'http://192.168.1.1/'},
                    {'url': 'https://user:pass@example.org/a'},
                    {'url': 'http://example.org:invalid/'}, None,
                    {'title': 'missing url'}, malformed,
                ]}
        class FakeClient:
            def __init__(self, **kwargs): pass
            async def __aenter__(self): return self
            async def __aexit__(self, *args): pass
            async def post(self, *args, **kwargs): return FakeResponse()
        with patch.object(websearch.httpx, 'AsyncClient', FakeClient):
            self.assertEqual(await websearch.search('fake', 'test'), [
                {'title': 'Valid', 'url': 'https://example.org/a', 'content': 'text',
                 'published_date': '2026-01-01', 'score': 0.93}
            ])

    async def test_empty_results_are_not_a_failure(self):
        async def empty(*args):
            return []
        with patch.object(api.credentials_store, 'get_value', return_value='fake'), patch.object(
            api.websearch, 'search', side_effect=empty
        ):
            self.assertEqual(await api.web_search(api.WebSearchRequest(query='test'), FakeRequest()), {'results': []})

    async def test_missing_key_does_not_call_tavily(self):
        with patch.object(api.credentials_store, 'get_value', return_value=None), patch.object(
            api.websearch, 'search'
        ) as upstream:
            with self.assertRaises(api.HTTPException) as error:
                await api.web_search(api.WebSearchRequest(query='test'), FakeRequest())
            self.assertEqual(error.exception.status_code, 400)
            upstream.assert_not_called()

    async def test_rate_limit_is_distinct(self):
        request = httpx.Request('POST', 'https://api.tavily.com/search')
        response = httpx.Response(429, request=request)
        async def limited(*args):
            raise httpx.HTTPStatusError('rate limited', request=request, response=response)
        with patch.object(api.credentials_store, 'get_value', return_value='fake'), patch.object(
            api.websearch, 'search', side_effect=limited
        ):
            with self.assertRaises(api.HTTPException) as error:
                await api.web_search(api.WebSearchRequest(query='test'), FakeRequest())
            self.assertEqual(error.exception.status_code, 429)

    async def test_upstream_failure_is_visible_without_leaking_key(self):
        async def fail(*args):
            raise httpx.TimeoutException('timed out')
        with patch.object(api.credentials_store, 'get_value', return_value='fake'), patch.object(
            api.websearch, 'search', side_effect=fail
        ):
            with self.assertRaises(api.HTTPException) as error:
                await api.web_search(api.WebSearchRequest(query='test'), FakeRequest())
            self.assertEqual(error.exception.status_code, 504)
            self.assertNotIn('fake', str(error.exception.detail))

    async def test_disconnect_cancels_upstream(self):
        started = asyncio.Event()
        cancelled = asyncio.Event()

        async def slow_search():
            started.set()
            try:
                await asyncio.sleep(60)
            finally:
                cancelled.set()

        class FakeRequest:
            async def is_disconnected(self):
                return started.is_set()

        with self.assertRaises(asyncio.CancelledError):
            await api._search_until_disconnect(FakeRequest(), slow_search())
        self.assertTrue(cancelled.is_set())


if __name__ == '__main__':
    unittest.main()
