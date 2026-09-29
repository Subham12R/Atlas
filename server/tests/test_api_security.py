import os
from unittest import TestCase
from unittest.mock import patch

from fastapi.testclient import TestClient

from api import app


class LocalApiSecurityTests(TestCase):
    def test_every_api_route_requires_the_local_token(self):
        with patch.dict(os.environ, {"ATLAS_API_TOKEN": "a" * 64}), TestClient(app) as client:
            self.assertEqual(client.get('/providers').status_code, 401)
            self.assertEqual(client.get('/providers', headers={'Authorization': 'Bearer wrong'}).status_code, 401)
            self.assertEqual(client.get('/providers', headers={'Authorization': 'Bearer ' + 'a' * 64}).status_code, 200)

    def test_missing_token_configuration_fails_closed(self):
        with patch.dict(os.environ, {"ATLAS_API_TOKEN": ""}), TestClient(app) as client:
            self.assertEqual(client.get('/providers').status_code, 503)

    def test_browser_origins_are_restricted_and_do_not_bypass_auth(self):
        token = 'a' * 64
        with patch.dict(os.environ, {"ATLAS_API_TOKEN": token}), TestClient(app) as client:
            bad = client.options('/providers', headers={
                'Origin': 'https://untrusted.example',
                'Access-Control-Request-Method': 'GET',
                'Access-Control-Request-Headers': 'authorization',
            })
            self.assertNotIn('access-control-allow-origin', bad.headers)
            self.assertEqual(client.get('/providers', headers={
                'Origin': 'https://untrusted.example', 'Authorization': 'Bearer ' + token,
            }).status_code, 403)
            for origin in ('null', 'http://localhost:5173', 'http://127.0.0.1:5173'):
                with self.subTest(origin=origin):
                    allowed = client.options('/providers', headers={
                        'Origin': origin, 'Access-Control-Request-Method': 'GET',
                        'Access-Control-Request-Headers': 'authorization',
                    })
                    self.assertEqual(allowed.status_code, 200)
                    self.assertEqual(allowed.headers.get('access-control-allow-origin'), origin)
            self.assertEqual(client.get('/providers', headers={'Origin': 'null'}).status_code, 401)
