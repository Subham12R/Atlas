"""Offline checks for the public search boundary and upstream cancellation."""
import asyncio
import json
import sys
import types
import unittest
from contextlib import asynccontextmanager
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

    @patch.dict('os.environ', {'ATLAS_WEB_SEARCH_PROVIDER': 'tavily'})
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

    async def test_explicit_free_search_normalizes_bounded_json_without_tavily_key(self):
        payload = {'results': [
            {'title': 'Public guide', 'url': 'https://example.org/guide#part',
             'snippet': 'A short excerpt', 'score': 0.8, 'published_date': '2026-01-01'},
            {'title': 'Local endpoint', 'url': 'http://127.0.0.1/private', 'snippet': 'secret'},
            {'title': 'File', 'url': 'file:///etc/passwd', 'snippet': 'secret'},
        ]}
        class FakeClient:
            def __init__(self, **kwargs): pass
            async def __aenter__(self): return self
            async def __aexit__(self, *args): pass
            async def post(self, *args, **kwargs):
                class EmptyResponse:
                    def raise_for_status(self): pass
                    def json(self): return {'results': []}
                return EmptyResponse()
        with patch.dict('os.environ', {'ATLAS_WEB_SEARCH_PROVIDER': 'free-search-mcp'}), patch.object(
            websearch, '_free_search', return_value=payload, create=True
        ) as mcp, patch.object(websearch.httpx, 'AsyncClient', FakeClient):
            results = await websearch.search(None, 'public guide', 2)
        self.assertEqual(results, [{'title': 'Public guide', 'url': 'https://example.org/guide#part',
                                    'content': 'A short excerpt', 'published_date': '2026-01-01',
                                    'score': 0.8}])
        mcp.assert_awaited_once_with('public guide', 2)

    async def test_mcp_client_calls_only_search_with_bounded_json_and_no_downloads(self):
        calls = []
        @asynccontextmanager
        async def transport(params):
            calls.append(('spawn', params.command, params.args, params.env))
            yield 'read', 'write'
        class Session:
            def __init__(self, read, write): pass
            async def __aenter__(self): return self
            async def __aexit__(self, *args): pass
            async def initialize(self): pass
            async def call_tool(self, name, arguments):
                calls.append(('tool', name, arguments))
                return types.SimpleNamespace(is_error=False, structured_content={
                    'results': [{'title': 'Guide', 'url': 'https://example.org/',
                                 'snippet': 'Excerpt'}]})
        modules = {'mcp': types.SimpleNamespace(ClientSession=Session,
                                                  StdioServerParameters=lambda **kw: types.SimpleNamespace(**kw)),
                   'mcp.client': types.ModuleType('mcp.client'),
                   'mcp.client.stdio': types.SimpleNamespace(stdio_client=transport)}
        with patch.dict(sys.modules, modules), patch.object(websearch, 'find_executable',
                                                           return_value='/fixture/search-mcp'):
            data = await websearch._free_search('guide', 3)
        self.assertEqual(data['results'][0]['snippet'], 'Excerpt')
        self.assertEqual(calls[0], ('spawn', '/fixture/search-mcp', ['--transport', 'stdio'],
                                    {'SEARCH_MCP_DOWNLOAD_ENABLED': 'false',
                                     'SEARCH_MCP_TRANSPORT': 'stdio',
                                     'SEARCH_MCP_SAFESEARCH': 'strict'}))
        self.assertEqual(calls[1], ('tool', 'search',
                                    {'query': 'guide', 'max_results': 3, 'format': 'json'}))

    async def test_free_search_engine_failure_is_not_reported_as_no_results(self):
        with patch.dict('os.environ', {'ATLAS_WEB_SEARCH_PROVIDER': 'free-search-mcp'}), patch.object(
            websearch, '_free_search', return_value={'results': [], 'errors': {'bing': 'unavailable'}}
        ), self.assertRaisesRegex(websearch.SearchUnavailable, 'failed'):
            await websearch.search(None, 'public guide', 2)

    async def test_free_search_unavailable_is_not_an_empty_result(self):
        with patch.dict('os.environ', {'ATLAS_WEB_SEARCH_PROVIDER': 'free-search-mcp'}), patch.object(
            websearch, '_free_search', side_effect=RuntimeError('search-mcp unavailable'), create=True
        ), self.assertRaisesRegex(RuntimeError, 'unavailable'):
            await websearch.search(None, 'public guide', 2)

    async def test_empty_results_are_not_a_failure(self):
        async def empty(*args):
            return []
        with patch.object(api.credentials_store, 'get_value', return_value='fake'), patch.object(
            api.websearch, 'search', side_effect=empty
        ):
            self.assertEqual(await api.web_search(api.WebSearchRequest(query='test'), FakeRequest()), {'results': []})

    async def test_free_search_endpoint_needs_no_tavily_key(self):
        async def free_search(*args):
            return [{'title': 'Guide', 'url': 'https://example.org/', 'content': 'Public excerpt'}]
        with patch.dict('os.environ', {'ATLAS_WEB_SEARCH_PROVIDER': 'free-search-mcp'}), patch.object(
            api.credentials_store, 'get_value', return_value=None
        ), patch.object(websearch, 'find_executable', return_value='/fixture/search-mcp'), patch.object(
            api.websearch, 'search', side_effect=free_search) as upstream:
            response = await api.web_search(api.WebSearchRequest(query='public guide'), FakeRequest())
        self.assertEqual(response['results'][0]['url'], 'https://example.org/')
        upstream.assert_awaited_once_with(None, 'public guide', 5)

    async def test_free_search_missing_install_returns_actionable_503(self):
        with patch.dict('os.environ', {'ATLAS_WEB_SEARCH_PROVIDER': 'free-search-mcp'}), patch.object(
            websearch, 'find_executable', return_value=None
        ), patch.object(api.credentials_store, 'get_value', return_value=None), patch.object(
            api.websearch, 'search'
        ) as upstream, self.assertRaises(api.HTTPException) as error:
            await api.web_search(api.WebSearchRequest(query='guide'), FakeRequest())
        self.assertEqual(error.exception.status_code, 503)
        self.assertIn('search-mcp', error.exception.detail)
        upstream.assert_not_called()

    async def test_unknown_backend_fails_closed_without_searching(self):
        with patch.dict('os.environ', {'ATLAS_WEB_SEARCH_PROVIDER': 'arbitrary-command'}), patch.object(
            api.websearch, 'search'
        ) as upstream, self.assertRaises(api.HTTPException) as error:
            await api.web_search(api.WebSearchRequest(query='guide'), FakeRequest())
        self.assertEqual(error.exception.status_code, 503)
        upstream.assert_not_called()

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
