import asyncio
import os
import stat
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

import api
import free_search_setup
import websearch

HEADERS = {'Authorization': 'Bearer ' + 'a' * 64}


def make_executable(path: Path) -> None:
    path.write_text('#!/bin/sh\n')
    path.chmod(path.stat().st_mode | stat.S_IEXEC)


class FreeSearchSetupTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.bin = Path(self.tmp.name)
        self.saved = {}
        patches = [
            patch.object(free_search_setup, 'tool_dirs', return_value=[str(self.bin)]),
            patch.dict(os.environ, {'PATH': '/usr/bin:/bin'}),  # Finder-launched app PATH
            patch.object(free_search_setup.credentials_store, 'set_many', side_effect=self.saved.update),
        ]
        for p in patches:
            p.start()
            self.addCleanup(p.stop)
        self.addCleanup(self.tmp.cleanup)
        self.commands = []

        async def fake_run(*command, env=None, stdin=None):
            self.commands.append((command, env, stdin))
            if command[0] == 'sh':
                make_executable(self.bin / 'uv')
            elif command[1:3] == ('tool', 'install'):
                make_executable(self.bin / 'search-mcp')
        run = patch.object(free_search_setup, '_run', side_effect=fake_run)
        run.start()
        self.addCleanup(run.stop)
        self.verified = []

        async def fake_verify():
            self.verified.append(True)
        verify = patch.object(free_search_setup, '_verify', side_effect=fake_verify)
        verify.start()
        self.addCleanup(verify.stop)

    def test_finds_tools_outside_the_minimal_app_path(self):
        self.assertIsNone(free_search_setup.find_executable('search-mcp'))
        make_executable(self.bin / 'search-mcp')
        self.assertEqual(free_search_setup.find_executable('search-mcp'), str(self.bin / 'search-mcp'))

    def test_one_click_installs_pinned_package_with_existing_uv_and_selects_it(self):
        make_executable(self.bin / 'uv')
        result = asyncio.run(free_search_setup.install())
        self.assertEqual(result, {'installed': True, 'provider': 'free-search-mcp'})
        self.assertEqual([c[0] for c in self.commands],
                         [(str(self.bin / 'uv'), 'tool', 'install', 'free-search-mcp==0.13.1')])
        self.assertEqual(self.saved, {'WEB_SEARCH_PROVIDER': 'free-search-mcp'})
        self.assertEqual(self.verified, [True])

    def test_bootstraps_uv_without_editing_shell_profiles_then_is_idempotent(self):
        class Response:
            content = b'#!/bin/sh\necho install uv\n'
            def raise_for_status(self): pass

        async def get(self, url):
            self.url = url
            return Response()
        with patch('httpx.AsyncClient.get', get):
            asyncio.run(free_search_setup.install())
        sh = self.commands[0]
        self.assertEqual(sh[0], ('sh',))
        self.assertEqual(sh[1], {'INSTALLER_NO_MODIFY_PATH': '1'})
        self.assertEqual(self.commands[1][0][1:], ('tool', 'install', 'free-search-mcp==0.13.1'))
        self.commands.clear()
        asyncio.run(free_search_setup.install())
        self.assertEqual(self.commands, [])  # Already installed: nothing runs again.

    def test_failed_test_search_keeps_the_previous_provider(self):
        make_executable(self.bin / 'uv')

        async def broken():
            raise free_search_setup.SetupFailed('installed, but a test search failed: TimeoutError')
        with patch.object(free_search_setup, '_verify', side_effect=broken):
            with self.assertRaises(free_search_setup.SetupFailed):
                asyncio.run(free_search_setup.install())
        self.assertEqual(self.saved, {})

    def test_concurrent_clicks_install_once(self):
        make_executable(self.bin / 'uv')

        async def both():
            await asyncio.gather(free_search_setup.install(), free_search_setup.install())
        asyncio.run(both())
        self.assertEqual(len(self.commands), 1)


class SearchProviderSelectionTests(unittest.TestCase):
    def test_saved_choice_selects_provider_and_env_overrides_it(self):
        with patch.dict(os.environ, {}, clear=False):
            os.environ.pop('ATLAS_WEB_SEARCH_PROVIDER', None)
            with patch.object(websearch.credentials_store, 'get_value', return_value='free-search-mcp'):
                self.assertEqual(websearch.provider(), 'free-search-mcp')
                with patch.dict(os.environ, {'ATLAS_WEB_SEARCH_PROVIDER': 'tavily'}):
                    self.assertEqual(websearch.provider(), 'tavily')

    def test_settings_report_status_and_refuse_selecting_an_uninstalled_backend(self):
        with patch.object(api, 'API_TOKEN', 'a' * 64), \
             patch.object(api.credentials_store, 'get_value', return_value=''), \
             patch.object(websearch.credentials_store, 'get_value', return_value=''), \
             patch.object(free_search_setup, 'find_executable', return_value=None), \
             TestClient(api.app) as client:
            settings = client.get('/settings/search', headers=HEADERS).json()
            self.assertEqual(settings, {'configured': False, 'provider': 'tavily', 'available': False,
                                        'free_search': {'installed': False}})
            refused = client.put('/settings/search/provider', headers=HEADERS,
                                 json={'provider': 'free-search-mcp'})
            self.assertEqual(refused.status_code, 409)

    def test_install_failure_is_reported_not_swallowed(self):
        async def fail():
            raise free_search_setup.SetupFailed('uv failed: network unreachable')
        with patch.object(api, 'API_TOKEN', 'a' * 64), \
             patch.object(free_search_setup, 'install', side_effect=fail), TestClient(api.app) as client:
            response = client.post('/settings/search/free-search/install', headers=HEADERS)
        self.assertEqual(response.status_code, 502)
        self.assertIn('network unreachable', response.json()['detail'])


if __name__ == '__main__':
    unittest.main()
