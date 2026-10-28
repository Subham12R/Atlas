"""Hybrid (vector + BM25 + entity graph) retrieval, chunking, migration and [D#] citations."""
import asyncio
import sqlite3
import struct
import tempfile
import unittest
import zlib
from pathlib import Path
from unittest.mock import patch

import sqlite_vec
from fastapi.testclient import TestClient

import api
from agents.research import validate_citations
from brain.backfill import backfill_once
from brain.chunking import chunk_pages, chunk_text
from brain.db import connect
from brain.documents import Documents
from brain.graph import extract_entities
from brain.retriever import build_context
from brain.store import MemoryStore

TOKEN = 'a' * 64


class KeywordEmbedder:
    """Deterministic 'meaning': one axis per topic word; text with no topic word gets its own
    (hash-chosen) axis, so unrelated texts are far apart rather than identical."""
    AXES = ('leave', 'flight', 'database', 'pasta')
    DIM = 24

    def _vec(self, text):
        lowered = text.lower()
        vec = [float(word in lowered) for word in self.AXES] + [0.0] * (self.DIM - len(self.AXES))
        if not any(vec):
            vec[len(self.AXES) + zlib.crc32(lowered.encode()) % (self.DIM - len(self.AXES))] = 1.0
        norm = sum(v * v for v in vec) ** 0.5
        return [v / norm for v in vec]

    def embed(self, texts, titles=None):
        return [self._vec(t) for t in texts]

    def embed_one(self, text):
        return self._vec(text)


def fill(store, model):
    async def run():
        while await backfill_once(store, model):
            pass
    asyncio.run(run())


class ChunkingTests(unittest.TestCase):
    def test_chunks_follow_structure_and_stay_bounded(self):
        text = '# Leave\n\n' + ('Employees accrue paid leave every month. ' * 30) + '\n\n# Travel\n\nFlights are booked by HR.'
        chunks = chunk_text(text, max_chars=400, overlap=80)
        self.assertTrue(all(len(c) <= 400 for c in chunks))
        self.assertTrue(chunks[0].startswith('# Leave'))  # heading kept with its paragraph
        self.assertTrue(any(c.startswith('# Travel') for c in chunks))

    def test_pdf_page_markers_become_chunk_pages(self):
        pages = chunk_pages('[Page 1]\nIntro text.\n\n[Page 3]\nLater text.')
        self.assertEqual(pages, [('Intro text.', 1), ('Later text.', 3)])
        self.assertEqual(chunk_pages('no markers'), [('no markers', None)])


class GraphTests(unittest.TestCase):
    def test_entities_are_names_not_grammar(self):
        found = extract_entities('The Acme Corp office is in Kolkata. Unused leave carries over. '
                                 'We use Electron and React with the RAG pipeline.')
        self.assertEqual(found, ['Acme Corp', 'Kolkata', 'Electron', 'React', 'RAG'])

    def test_deleting_a_document_removes_its_graph_and_vectors(self):
        store = MemoryStore(connect(':memory:', 24, 'test'))
        docs = Documents(store.con)
        keep = docs.ingest_document('a.md', 'Acme Corp is based in Kolkata.')
        drop = docs.ingest_document('b.md', 'Acme Corp opened an office in Tokyo.')
        fill(store, KeywordEmbedder())
        docs.delete_document(drop)
        names = {r[0] for r in store.con.execute('SELECT name FROM doc_entities')}
        self.assertEqual(names, {'Acme Corp', 'Kolkata'})
        self.assertEqual(store.con.execute('SELECT count(*) FROM vec_doc_chunks').fetchone()[0], 1)
        self.assertEqual(store.con.execute('SELECT count(*) FROM vec_doc_entities').fetchone()[0], 2)
        self.assertEqual(store.con.execute('SELECT weight FROM doc_entity_edges').fetchall()[0][0], 1)
        self.assertEqual([d['source_id'] for d in docs.list_documents()], [keep])


class HybridRetrievalTests(unittest.TestCase):
    def setUp(self):
        self.store = MemoryStore(connect(':memory:', 24, 'test'))
        self.docs = Documents(self.store.con)
        self.model = KeywordEmbedder()
        self.docs.ingest_document('policy.pdf', '[Page 1]\nIntro.\n\n[Page 2]\nAnnual leave is 24 days per year.')
        self.docs.ingest_document('trip.md', 'Our flight to Tokyo departs on Monday with Air India.')
        self.docs.ingest_document('notes.md', 'Atlas keeps memory in a SQLite database.')
        fill(self.store, self.model)

    def retrieve(self, query, model=True):
        return self.docs.retrieve(query, self.model.embed_one(query) if model else None, 2, 0.3, 0.2)

    def test_meaning_keywords_and_graph_each_find_the_right_passage(self):
        top = self.retrieve('How many leave days do I get?')[0]
        self.assertEqual((top['name'], top['page']), ('policy.pdf', 2))
        self.assertIn('meaning', top['via'])
        # Named entity only: reached through the graph even without a matching topic vector.
        by_name = self.retrieve('When does Air India depart?', model=False)
        self.assertEqual(by_name[0]['name'], 'trip.md')
        self.assertIn('graph', by_name[0]['via'])

    def test_off_topic_questions_retrieve_nothing(self):
        self.assertEqual(self.retrieve('best pasta recipe'), [])
        self.assertEqual(self.retrieve('hi'), [])

    def test_keyword_search_works_before_the_model_loads(self):
        hits = self.retrieve('SQLite database memory', model=False)
        self.assertEqual([h['name'] for h in hits], ['notes.md'])
        self.assertIn('keywords', hits[0]['via'])  # 'SQLite' also reaches it via the graph

    def test_context_cites_documents_by_id_with_pages(self):
        context, recall = build_context(self.store, self.model, 'how much annual leave?', 't1',
                                        documents=self.docs, doc_max_distance=0.3, entity_distance=0.2)
        self.assertIn('[D1] policy.pdf, page 2:', context)
        self.assertIn('cite it with its ID in square brackets', context)
        self.assertEqual([(d['source_id'], d['name'], d['page']) for d in recall['documents']],
                         [('D1', 'policy.pdf', 2)])


class MigrationTests(unittest.TestCase):
    def test_old_database_is_reindexed_for_the_new_model(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = str(Path(tmp) / 'brain.db')
            # A 1.0.8 database: 384-d vectors, no page column, no keyword index, no model record.
            old = sqlite3.connect(path)
            old.enable_load_extension(True)
            sqlite_vec.load(old)
            old.executescript("""
                CREATE TABLE threads (id TEXT PRIMARY KEY, provider TEXT, title TEXT DEFAULT '',
                    rolling_summary TEXT DEFAULT '', meta TEXT, created_at TEXT DEFAULT (datetime('now')));
                CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id TEXT NOT NULL,
                    role TEXT NOT NULL, content TEXT NOT NULL, provider TEXT, meta TEXT,
                    created_at TEXT DEFAULT (datetime('now')));
                CREATE TABLE chunks (id INTEGER PRIMARY KEY AUTOINCREMENT, message_id INTEGER NOT NULL,
                    thread_id TEXT NOT NULL, text TEXT NOT NULL);
                CREATE TABLE documents (source_id TEXT PRIMARY KEY, name TEXT NOT NULL,
                    content_hash TEXT NOT NULL, byte_size INTEGER NOT NULL, UNIQUE(name, content_hash));
                CREATE TABLE document_chunks (id INTEGER PRIMARY KEY AUTOINCREMENT,
                    source_id TEXT NOT NULL, text TEXT NOT NULL);
                CREATE VIRTUAL TABLE vec_chunks USING vec0(embedding float[384] distance_metric=cosine);
                INSERT INTO threads(id, provider) VALUES ('t1', 'fake');
                INSERT INTO messages(thread_id, role, content) VALUES ('t1', 'user', 'my flight is Monday');
                INSERT INTO chunks(message_id, thread_id, text) VALUES (1, 't1', 'my flight is Monday');
                INSERT INTO documents VALUES ('d1', 'old.md', 'h', 10);
                INSERT INTO document_chunks(source_id, text) VALUES ('d1', 'database notes');
            """)
            old.execute('INSERT INTO vec_chunks(rowid, embedding) VALUES (1, ?)',
                        (struct.pack('384f', *([0.1] * 384)),))
            old.commit()
            old.close()

            store = MemoryStore(connect(path, 24, 'new-model'))
            self.assertEqual(store.con.execute('SELECT count(*) FROM vec_chunks').fetchone()[0], 0)
            self.assertEqual(store.keyword_search('flight')[0][1], 'my flight is Monday')
            self.assertEqual(Documents(store.con).retrieve('database notes', None, 2)[0]['name'], 'old.md')
            fill(store, KeywordEmbedder())
            self.assertEqual(store.dense_search(KeywordEmbedder().embed_one('flight'), 1)[0][1],
                             'my flight is Monday')
            store.con.close()
            # Reopening with the same model keeps the vectors.
            again = MemoryStore(connect(path, 24, 'new-model'))
            self.assertEqual(again.con.execute('SELECT count(*) FROM vec_chunks').fetchone()[0], 1)
            again.con.close()


class CitationTests(unittest.TestCase):
    def test_issued_document_ids_survive_and_invented_ones_are_removed(self):
        answer, unknown = validate_citations('Leave is 24 days (D1). Sick leave is 12 [D9]. Web says [S1].',
                                             {'D1', 'S1'})
        self.assertEqual(answer, 'Leave is 24 days [D1]. Sick leave is 12 . Web says [S1].')
        self.assertEqual(unknown, ['D9'])


class StatusEndpointTests(unittest.TestCase):
    def test_status_reports_model_state_and_pending_chunks(self):
        store = MemoryStore(connect(':memory:', 24, 'test'))
        Documents(store.con).ingest_document('a.md', 'Some text.')
        with patch.object(api, 'API_TOKEN', TOKEN), patch.object(api, 'get_store', return_value=store), \
                TestClient(api.app) as client:
            status = client.get('/memory/status', headers={'Authorization': 'Bearer ' + TOKEN}).json()
        self.assertEqual(status['state'], 'idle')
        self.assertEqual(status['pending_document_chunks'], 1)


if __name__ == '__main__':
    unittest.main()
