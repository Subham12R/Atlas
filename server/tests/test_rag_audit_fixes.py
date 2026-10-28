"""Regression tests for the memory/RAG audit: clean memory text, background
enrichment, per-chat memory deletion, document search, summarizer choice, and
the custom OpenAI-compatible cloud endpoint."""
import asyncio
import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

import api
import factory
from adapters.base import BaseAdapter, Reply
from adapters.custom_adapter import CustomAdapter
from brain import Brain, MemoryStore, Summarizer
from brain.db import connect
from brain.documents import Documents

TOKEN = 'a' * 64
HEADERS = {'Authorization': 'Bearer ' + TOKEN}


class FakeEmbedder:
    def embed(self, texts):
        return [[1.0, 0.0] for _ in texts]

    def embed_one(self, text):
        return [1.0, 0.0]


class FakeAdapter(BaseAdapter):
    name = 'fake'

    def __init__(self, gate: asyncio.Event | None = None):
        self.gate = gate
        self.prompts = []

    async def init(self):
        pass

    async def send(self, prompt, images=None):
        self.prompts.append(prompt)
        if self.gate is not None and 'running summary' in prompt:
            await self.gate.wait()
        if 'running summary' in prompt:
            return Reply('summary of ' + prompt.rsplit('User: ', 1)[-1].split('\n')[0], self.name)
        if 'triples' in prompt:
            return Reply('[["Atlas","uses","SQLite"]]', self.name)
        return Reply('answer', self.name)

    async def send_stream(self, prompt, images=None):
        yield (await self.send(prompt, images)).text

    async def new_chat(self):
        pass

    async def close(self):
        pass


def wrapped(prompt: str) -> str:
    """Exactly what the desktop renderer sends for an ordinary chat turn."""
    return ('[System Instruction - Personalization Settings]\n'
            'Please adhere to the following user preferences for this conversation:\n\n'
            "User's Name: Sam\nPlease address the user by name when appropriate.\n\n"
            '---\n\n'
            '[System Instruction - Formatting]\n'
            'Do not use em dashes (—) anywhere in your response. Do not use emojis.\n\n'
            + prompt)


class MemoryTextTests(unittest.TestCase):
    def test_instruction_blocks_are_not_stored_as_the_users_words(self):
        self.assertEqual(Brain._memory_text(wrapped('who is subham')), 'who is subham')

    def test_formatting_block_alone_and_plain_prompts(self):
        formatting = ('[System Instruction - Formatting]\nDo not use emojis.\n\n'
                      'File: a.md\n```\nx\n```')
        self.assertEqual(Brain._memory_text(formatting), '[Attached: a.md]')
        self.assertEqual(Brain._memory_text('  plain question  '), 'plain question')


class EnrichmentTests(unittest.IsolatedAsyncioTestCase):
    def make_brain(self, gate=None):
        self.store = MemoryStore(connect(':memory:', 2))
        self.summarizer = FakeAdapter(gate)
        return Brain(FakeAdapter(), self.store, FakeEmbedder(), 't1', 'fake',
                     summarizer=Summarizer(self.summarizer), auto_summary=True)

    async def test_reply_is_returned_before_enrichment_finishes(self):
        gate = asyncio.Event()
        brain = self.make_brain(gate)
        reply = await asyncio.wait_for(brain.send(wrapped('first question')), timeout=1)
        self.assertEqual(reply.text, 'answer')
        self.assertEqual(self.store.get_summary('t1'), '')  # still waiting on the summarizer
        gate.set()
        await brain.flush()
        self.assertEqual(self.store.get_summary('t1'), 'summary of first question')
        # The summarizer saw the user's words, not the instruction blocks.
        self.assertNotIn('Do not use em dashes', ''.join(self.summarizer.prompts))
        stored = self.store.con.execute("SELECT content FROM messages WHERE role='user'").fetchone()
        self.assertEqual(stored['content'], 'first question')

    async def test_enrichment_stays_on_the_thread_that_produced_it(self):
        gate = asyncio.Event()
        brain = self.make_brain(gate)
        await brain.send('about thread one')
        await brain.new_thread()
        gate.set()
        await brain.flush()
        self.assertEqual(self.store.get_summary('t1'), 'summary of about thread one')
        self.assertEqual(self.store.get_summary(brain.thread_id), '')

    async def test_close_does_not_wait_for_pending_enrichment(self):
        brain = self.make_brain(asyncio.Event())  # never released
        await brain.send('question')
        await asyncio.wait_for(brain.close(), timeout=1)


class DeleteThreadTests(unittest.TestCase):
    def test_deleting_a_chat_forgets_only_that_chats_memory(self):
        store = MemoryStore(connect(':memory:', 2))
        vec = [1.0, 0.0]
        for tid in ('a' * 32, 'b' * 32):
            store.create_thread(tid, 'fake')
            store.add_message(tid, 'user', f'note {tid[0]}', chunks=[(f'note {tid[0]}', vec)])
            store.set_summary(tid, f'summary {tid[0]}')
        shared = store.upsert_entity('Atlas', '', 'a' * 32)
        only_a = store.upsert_entity('Secret', '', 'a' * 32)
        other = store.upsert_entity('SQLite', '', 'b' * 32)
        store.add_edge(only_a, shared, 'mentions', 'a' * 32)
        store.add_edge(shared, other, 'uses', 'b' * 32)  # b still relies on a's entity

        store.delete_thread('a' * 32)

        texts = [text for text, _, _ in store.search(vec, k=5)]
        self.assertEqual(texts, ['note b'])
        self.assertEqual(store.get_summary('a' * 32), '')
        self.assertEqual(store.get_summary('b' * 32), 'summary b')
        names = {row['name'] for row in store.con.execute('SELECT name FROM entities')}
        self.assertEqual(names, {'Atlas', 'SQLite'})
        self.assertEqual(store.neighbors(['Secret']), [])
        self.assertEqual(store.neighbors(['SQLite']), [('Atlas', 'uses', 'SQLite')])
        self.assertEqual(store.con.execute('SELECT count(*) FROM vec_chunks').fetchone()[0], 1)

    def test_delete_thread_endpoint_validates_id(self):
        store = MemoryStore(connect(':memory:', 2))
        with patch.object(api, 'API_TOKEN', TOKEN), patch.object(api, 'get_store', return_value=store), \
                TestClient(api.app) as client:
            self.assertEqual(client.delete('/threads/not-a-thread', headers=HEADERS).status_code, 422)
            self.assertEqual(client.delete('/threads/' + 'c' * 32, headers=HEADERS).status_code, 204)


class DocumentSearchTests(unittest.TestCase):
    def setUp(self):
        self.docs = Documents(MemoryStore(connect(':memory:', 2)).con)

    def test_all_words_must_match_in_any_order_and_phrases_rank_first(self):
        self.docs.ingest_document('a.md', 'The release cutover happens on Monday.')
        self.docs.ingest_document('b.md', 'Monday is the day for the release   cutover.')
        self.docs.ingest_document('c.md', 'Only the release is mentioned here.')
        hits = self.docs.search_documents('Monday cutover', 5)
        self.assertEqual({hit['name'] for hit in hits}, {'a.md', 'b.md'})
        ranked = self.docs.search_documents('release cutover', 5)
        self.assertEqual([hit['score'] for hit in ranked], [1.0, 1.0])
        self.assertEqual(self.docs.search_documents('cutover Friday', 5), [])

    def test_non_ascii_words_match_case_insensitively(self):
        self.docs.ingest_document('r.md', 'Résumé für Ärzte')
        self.assertEqual(len(self.docs.search_documents('ärzte résumé', 5)), 1)


class SummarizerChoiceTests(unittest.TestCase):
    def build(self, provider, configured_key):
        def get_value(key):
            return 'k' if key == configured_key else ''
        with patch.object(factory, 'BRAIN_SUMMARIZER', ''), \
                patch.object(factory.credentials_store, 'get_value', side_effect=get_value), \
                patch.object(factory, 'get_store', return_value=MemoryStore(connect(':memory:', 2))), \
                patch.object(factory, 'get_embedder', return_value=FakeEmbedder()):
            return factory.build_brain(provider, model='claude-haiku-4-5' if provider == 'anthropic' else None)

    def test_cloud_chat_is_summarized_by_its_own_provider_and_model(self):
        brain = self.build('anthropic', 'ANTHROPIC_API_KEY')
        self.assertEqual(brain.summarizer.adapter.name, 'anthropic')
        self.assertEqual(brain.summarizer.adapter.model, 'claude-haiku-4-5')

    def test_local_chat_is_never_summarized_by_a_cloud_provider(self):
        brain = self.build('local', 'OPENAI_API_KEY')
        self.assertIsNone(brain.summarizer)
        self.assertFalse(brain.auto_summary)


class CustomEndpointTests(unittest.TestCase):
    def setUp(self):
        self.values: dict[str, str] = {}
        self.patches = [
            patch.object(api, 'API_TOKEN', TOKEN),
            patch.object(api.credentials_store, 'get_value', side_effect=lambda k: self.values.get(k, '')),
            patch.object(api.credentials_store, 'set_many', side_effect=self.values.update),
            patch.object(api.credentials_store, 'delete', side_effect=lambda k: self.values.pop(k, None)),
            patch.object(factory.credentials_store, 'get_value', side_effect=lambda k: self.values.get(k, '')),
            patch.object(api, '_local_base_url', return_value='http://127.0.0.1:11434/v1'),
            patch.object(api, '_discover_local_models', return_value=[]),
        ]
        for p in self.patches:
            p.start()
        self.client = TestClient(api.app)

    def tearDown(self):
        for p in reversed(self.patches):
            p.stop()

    def test_settings_require_https_off_this_machine_and_never_echo_the_key(self):
        bad = self.client.put('/settings/providers/custom', headers=HEADERS,
                              json={'base_url': 'http://api.example.com/v1', 'model': 'm'})
        self.assertEqual(bad.status_code, 400)
        self.assertNotIn('CUSTOM_BASE_URL', self.values)
        ok = self.client.put('/settings/providers/custom', headers=HEADERS, json={
            'base_url': 'https://api.example.com/v1/', 'model': ' llama-3.3-70b ', 'api_key': 'sk-x'})
        self.assertEqual(ok.status_code, 200)
        settings = self.client.get('/settings/providers', headers=HEADERS).json()['custom']
        self.assertEqual(settings, {'configured': True, 'base_url': 'https://api.example.com/v1',
                                    'model': 'llama-3.3-70b', 'api_key_configured': True})
        self.assertEqual(self.client.put('/settings/providers/custom', headers=HEADERS, json={
            'base_url': 'http://127.0.0.1:8080/v1'}).status_code, 200)
        self.client.delete('/settings/providers/custom', headers=HEADERS)
        self.assertFalse(self.client.get('/settings/providers', headers=HEADERS).json()['custom']['configured'])

    def test_configured_endpoint_is_a_cloud_candidate_and_builds_an_adapter(self):
        self.values.update(CUSTOM_BASE_URL='https://api.example.com/v1', CUSTOM_MODEL='m-1',
                           CUSTOM_API_KEY='sk-x')
        routed = self.client.post('/routing/turn', headers=HEADERS, json={
            'prompt': 'Fix this function', 'mode': 'auto',
            'preference': {'provider': 'custom', 'model': ''}}).json()
        self.assertEqual((routed['state'], routed['provider'], routed['model']), ('ready', 'custom', 'm-1'))
        adapter = factory.build_adapter('custom')
        self.assertIsInstance(adapter, CustomAdapter)
        self.assertEqual((str(adapter._client.base_url), adapter.model),
                         ('https://api.example.com/v1/', 'm-1'))
        self.values.clear()
        with self.assertRaises(factory.AuthMissing):
            factory.build_adapter('custom')


if __name__ == '__main__':
    unittest.main()


class AttachmentMemoryTests(unittest.IsolatedAsyncioTestCase):
    def test_file_bodies_are_remembered_by_name_only(self):
        prompt = wrapped('Summarize these') + ('\n\nFile: notes.md\n```\n' + 'x' * 900_000 + '\n```'
                                               '\n\nFile: data.csv\n```\na,b\n```')
        self.assertEqual(Brain._memory_text(prompt), 'Summarize these\n\n[Attached: notes.md, data.csv]')

    async def test_storing_a_turn_does_not_block_the_event_loop(self):
        store = MemoryStore(connect(':memory:', 2))
        brain = Brain(FakeAdapter(), store, FakeEmbedder(), 't1', 'fake', auto_summary=False)
        started = asyncio.Event()

        def slow_chunks(content):
            started.set()  # set from the worker thread; read after the await below
            import time
            time.sleep(0.3)
            return [(content, [1.0, 0.0])]

        brain._chunk_and_embed = slow_chunks
        ticks = 0

        async def heartbeat():
            nonlocal ticks
            while True:
                ticks += 1
                await asyncio.sleep(0.01)

        beat = asyncio.create_task(heartbeat())
        await brain.finish_agent_turn('question', 'a long answer', {})
        beat.cancel()
        self.assertGreater(ticks, 10)  # the loop kept running while chunks were embedded
        self.assertEqual(store.con.execute('SELECT count(*) FROM messages').fetchone()[0], 2)
