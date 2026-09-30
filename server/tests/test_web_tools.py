import asyncio
import socket
import time
import unittest
from unittest.mock import patch

from tools.contracts import ToolContext
from tools.web import UnsafePage, FetchInput, SearchInput, fetch_page, search_web, validate_target, read_page


class WebToolTests(unittest.IsolatedAsyncioTestCase):
    async def test_search_registers_only_server_issued_source_ids(self):
        ctx = ToolContext(run_id='r', allowed_tools=frozenset({'web_search', 'fetch_page'}),
                          deadline=time.monotonic()+90, cancelled=asyncio.Event())
        hits = [{'title': 'A', 'url': 'https://example.org/a#top', 'content': 'snippet'},
                {'title': 'Duplicate', 'url': 'https://example.org/a#bottom', 'content': 'same page'}]
        async def fake(*args): return hits
        with patch('tools.web.credentials_store.get_value', return_value='fake'), patch(
            'tools.web.websearch.search', side_effect=fake
        ):
            result = await search_web(ctx, SearchInput(query='question'))
        self.assertEqual(result.source_ids, ['S1'])
        self.assertEqual(ctx.sources['S1']['url'], 'https://example.org/a')
        with self.assertRaises(UnsafePage):
            await fetch_page(ctx, FetchInput(source_id='S9'))

    async def test_explicit_free_search_tool_keeps_source_ids_without_key(self):
        ctx = ToolContext(run_id='free', allowed_tools=frozenset({'web_search'}),
                          deadline=time.monotonic()+90, cancelled=asyncio.Event())
        async def free(*args):
            return [{'title': 'Guide', 'url': 'https://example.org/', 'content': 'Excerpt'}]
        with patch.dict('os.environ', {'ATLAS_WEB_SEARCH_PROVIDER': 'free-search-mcp'}), patch(
            'tools.web.credentials_store.get_value', return_value=None
        ), patch('websearch.find_executable', return_value='/fixture/search-mcp'), patch(
            'tools.web.websearch.search', side_effect=free) as upstream:
            result = await search_web(ctx, SearchInput(query='guide'))
        self.assertEqual(result.source_ids, ['S1'])
        upstream.assert_awaited_once_with(None, 'guide', 8)

    async def test_validates_every_address_and_target(self):
        def fake_dns(host, port, **kwargs):
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('8.8.8.8', port)),
                    (socket.AF_INET, socket.SOCK_STREAM, 6, '', ('127.0.0.1', port))]
        with patch('tools.web.socket.getaddrinfo', fake_dns):
            with self.assertRaises(UnsafePage): validate_target('https://example.org/')
        for url in ('http://127.0.0.1/', 'http://[::1]/', 'http://localhost/',
                    'file:///etc/passwd', 'https://user:pass@example.org/',
                    'https://example.org:8080/', 'https://example.org\n.evil/'):
            with self.subTest(url=url), self.assertRaises(UnsafePage):
                validate_target(url)

    async def test_redirect_is_validated_and_body_limited(self):
        def fake_one(url, ip, host, port, deadline=None):
            return 302, {'location': 'http://127.0.0.1/private'}, b''
        with patch('tools.web.validate_target', side_effect=[('8.8.8.8', 'example.org', 443),
                                                                 UnsafePage('blocked')]), patch(
            'tools.web._fetch_one', fake_one
        ):
            with self.assertRaises(UnsafePage): read_page('https://example.org/')

    async def test_page_socket_timeout_uses_remaining_total_deadline(self):
        deadline = time.monotonic() + 0.5
        with patch('tools.web.socket.create_connection', side_effect=TimeoutError) as connect:
            with self.assertRaises(TimeoutError):
                from tools.web import _fetch_one
                _fetch_one('https://example.org/', '8.8.8.8', 'example.org', 443, deadline)
        self.assertLessEqual(connect.call_args.kwargs['timeout'], 0.5)

    async def test_page_body_and_content_type_are_bounded(self):
        safe = ('8.8.8.8', 'example.org', 443)
        with patch('tools.web.validate_target', return_value=safe), patch(
            'tools.web._fetch_one', return_value=(200, {'content-type': 'text/plain'},
                                                  b'x' * (1024 * 1024 + 1))
        ), self.assertRaises(UnsafePage):
            read_page('https://example.org/')
        with patch('tools.web.validate_target', return_value=safe), patch(
            'tools.web._fetch_one', return_value=(200, {'content-type': 'application/pdf'}, b'%PDF')
        ), self.assertRaises(UnsafePage):
            read_page('https://example.org/')

    async def test_page_fetch_has_mime_limit_and_no_arbitrary_url(self):
        ctx = ToolContext(run_id='r', allowed_tools=frozenset({'fetch_page'}),
                          deadline=time.monotonic()+90, cancelled=asyncio.Event(),
                          sources={'S1': {'url': 'https://example.org/a', 'title': 'A'}})
        with patch('tools.web.read_page', return_value=('A', 'clean text', 'https://example.org/a')):
            result = await fetch_page(ctx, FetchInput(source_id='S1'))
        self.assertEqual(result.data['text'], 'clean text')
        self.assertTrue(result.untrusted)


if __name__ == '__main__':
    unittest.main()
