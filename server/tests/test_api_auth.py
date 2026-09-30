"""Local API enforces the browser-origin allowlist and bearer token."""
import unittest
from unittest.mock import patch

import httpx
import api


class ApiAuthTests(unittest.IsolatedAsyncioTestCase):
    async def test_untrusted_origin_cannot_read_or_mutate_without_token(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api.app),
                                     base_url='http://127.0.0.1:8000') as client:
            with patch.object(api.credentials_store, 'set_many') as write:
                for headers, expected in (({'Origin': 'https://untrusted.example'}, 403),
                                          ({'Origin': 'null'}, 401),
                                          ({'Origin': 'https://untrusted.example',
                                            'Authorization': 'Bearer incorrect'}, 403)):
                    response = await client.get('/chats', headers=headers)
                    self.assertEqual(response.status_code, expected)
                    if headers['Origin'] != 'null':
                        self.assertNotIn('access-control-allow-origin', response.headers)
                response = await client.put('/settings/providers/openai',
                                            json={'api_key': 'not-a-real-key'},
                                            headers={'Origin': 'https://untrusted.example'})
                self.assertEqual(response.status_code, 403)
                non_ascii = await client.get('/providers', headers={
                    b'authorization': b'Bearer \xff'
                })
                self.assertEqual(non_ascii.status_code, 401)
                preflight = await client.options('/chats', headers={
                    'Origin': 'https://untrusted.example',
                    'Access-Control-Request-Method': 'POST',
                    'Access-Control-Request-Headers': 'authorization',
                })
                self.assertEqual(preflight.status_code, 400)
                self.assertNotIn('access-control-allow-origin', preflight.headers)
                write.assert_not_called()

    async def test_authorized_requests_work_only_from_allowed_origins(self):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api.app),
                                     base_url='http://127.0.0.1:8000') as client:
            response = await client.get('/providers', headers={
                'Authorization': f'Bearer {api.API_TOKEN}',
                'Origin': 'https://untrusted.example',
            })
            self.assertEqual(response.status_code, 403)
            allowed = await client.get('/providers', headers={
                'Authorization': f'Bearer {api.API_TOKEN}', 'Origin': 'null',
            })
            self.assertEqual(allowed.status_code, 200)
            self.assertNotIn(api.API_TOKEN, allowed.text)
            docs = await client.get('/openapi.json')
            self.assertEqual(docs.status_code, 401)


if __name__ == '__main__':
    unittest.main()
