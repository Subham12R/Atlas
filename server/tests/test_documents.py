import os
from unittest import TestCase
from unittest.mock import patch

from fastapi.testclient import TestClient

from api import app
from brain.db import connect
from brain.documents import Documents
from brain.store import MemoryStore


class DocumentTests(TestCase):
    def setUp(self):
        self.store = MemoryStore(connect(':memory:', 2))
        self.docs = Documents(self.store.con)

    def tearDown(self):
        self.store.con.close()

    def test_selected_document_search_retains_source_and_chunk_provenance(self):
        source_id = self.docs.ingest_document('notes.md', 'Alpha policy is offline.')
        hits = self.docs.search_documents('Alpha policy', 5)
        self.assertEqual(len(hits), 1)
        self.assertEqual(hits[0]['source_id'], source_id)
        self.assertEqual(hits[0]['name'], 'notes.md')
        self.assertIsInstance(hits[0]['chunk_id'], int)
        self.assertGreater(hits[0]['score'], 0)
        self.assertIn('Alpha policy', hits[0]['text'])

    def test_identical_upload_is_idempotent_but_changed_content_is_a_new_source(self):
        first = self.docs.ingest_document('notes.txt', 'First unique phrase')
        self.assertEqual(self.docs.ingest_document('notes.txt', 'First unique phrase'), first)
        second = self.docs.ingest_document('notes.txt', 'Second unique phrase')
        self.assertNotEqual(first, second)
        self.assertEqual(len(self.docs.list_documents()), 2)
        self.docs.delete_document(first)
        self.docs.delete_document(first)
        self.assertEqual(self.docs.search_documents('First unique phrase', 5), [])
        self.assertEqual(self.docs.search_documents('Second unique phrase', 5)[0]['source_id'], second)

    def test_identical_text_under_different_names_keeps_distinct_provenance(self):
        first = self.docs.ingest_document('first.txt', 'Same public text')
        second = self.docs.ingest_document('second.md', 'Same public text')
        self.assertNotEqual(first, second)
        self.assertEqual({hit['source_id'] for hit in self.docs.search_documents('Same public', 5)},
                         {first, second})

    def test_invalid_input_leaves_no_partial_records(self):
        for name, text in [('notes.pdf', 'secret'), ('../notes.md', 'secret'),
                           ('notes.txt', 'x' * (1024 * 1024 + 1)), ('notes.md', ''),
                           ('notes.md', 'hello\x00world')]:
            with self.subTest(name=name, size=len(text)), self.assertRaises(ValueError):
                self.docs.ingest_document(name, text)
        with self.assertRaisesRegex(ValueError, 'valid name'):
            self.docs.ingest_document('bad\ud800.md', 'text')
        self.assertEqual(self.docs.list_documents(), [])

    def test_account_reset_removes_indexed_documents(self):
        self.docs.ingest_document('notes.md', 'Unique phrase')
        self.store.wipe_all()
        self.assertEqual(self.docs.list_documents(), [])
        self.assertEqual(self.docs.search_documents('Unique phrase', 3), [])

    def test_account_reset_removes_documents_even_when_chat_memory_is_disabled(self):
        self.docs.ingest_document('notes.md', 'Private source')
        with patch('api.API_TOKEN', 'a' * 64), \
             patch('api.get_store', return_value=self.store), \
             patch('api.BRAIN_ENABLED', False), \
             patch('api.credentials_store.clear_all'), \
             patch('api.chat_store.clear_all'), TestClient(app) as client:
            response = client.post('/account/reset', headers={'Authorization': 'Bearer ' + 'a' * 64})
            self.assertEqual(response.status_code, 200)
        self.assertEqual(self.docs.list_documents(), [])

    def test_authenticated_api_ingests_lists_searches_and_deletes(self):
        with patch('api.API_TOKEN', 'a' * 64), \
             patch('api.get_store', return_value=self.store), TestClient(app) as client:
            headers = {'Authorization': 'Bearer ' + 'a' * 64}
            self.assertEqual(client.get('/documents').status_code, 401)
            self.assertEqual(client.post('/documents', json={
                'name': 'notes.md', 'text': 'Unauthorized content',
            }).status_code, 401)
            self.assertEqual(self.docs.list_documents(), [])
            bad = client.post('/documents', headers=headers, json={'name': 'notes.pdf', 'text': 'No'})
            self.assertEqual(bad.status_code, 400)
            response = client.post('/documents', headers=headers,
                                   json={'name': 'notes.md', 'text': 'Unique policy note'})
            self.assertEqual(response.status_code, 201)
            source_id = response.json()['source_id']
            self.assertEqual(client.get('/documents', headers=headers).json()[0]['source_id'], source_id)
            hit = client.get('/documents/search', params={'q': 'Unique policy'}, headers=headers).json()[0]
            self.assertEqual((hit['source_id'], hit['name']), (source_id, 'notes.md'))
            self.assertEqual(client.get('/documents/search', params={'q': 'x' * 513}, headers=headers).status_code, 422)
            self.assertEqual(client.delete(f'/documents/{source_id}', headers=headers).status_code, 204)
            self.assertEqual(client.get('/documents/search', params={'q': 'Unique policy'}, headers=headers).json(), [])
