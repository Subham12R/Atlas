import asyncio
import time
import unittest
from unittest.mock import patch

from tools.contracts import TextAttachment, ToolContext
from tools.local_search import (AttachmentReadInput, AttachmentSearchInput,
                                MemoryInput, memory_search, search_attached_files,
                                read_attached_file)


class LocalToolTests(unittest.IsolatedAsyncioTestCase):
    def context(self):
        entry = TextAttachment(id='picked', name='note.md', mime='text/plain',
                               content='Atlas has two research modes.')
        return ToolContext(run_id='r', thread_id='mine',
                           allowed_tools=frozenset({'memory_search', 'search_attached_files',
                                                    'read_attached_file'}),
                           deadline=time.monotonic() + 10, cancelled=asyncio.Event(),
                           attachments={'picked': entry})

    async def test_only_selected_attachment_readable(self):
        ctx = self.context()
        result = await search_attached_files(ctx, AttachmentSearchInput(
            attachment_ids=['picked'], query='research'))
        self.assertEqual(result.source_ids, ['A1'])
        with self.assertRaises(ValueError):
            await search_attached_files(ctx, AttachmentSearchInput(
                attachment_ids=['other'], query='research'))
        with self.assertRaises(ValueError):
            await read_attached_file(ctx, AttachmentReadInput(attachment_id='../note.md'))
        result = await read_attached_file(ctx, AttachmentReadInput(attachment_id='picked', length=5))
        self.assertEqual(result.data['text'], 'Atlas')

    async def test_memory_is_current_thread_only_and_disabled_degrades(self):
        class Store:
            def search(self, embedding, **kwargs):
                self.scope = kwargs['scope_thread_id']
                return [('my note', 'mine', .2)]
        class Embedder:
            def embed_one(self, query): return [0.0]
        store = Store()
        with patch('factory.BRAIN_ENABLED', True), patch('factory.get_store', return_value=store), patch(
            'factory.get_embedder', return_value=Embedder()
        ):
            result = await memory_search(self.context(), MemoryInput(query='note'))
        self.assertEqual(store.scope, 'mine')
        self.assertEqual(result.data['hits'][0]['thread_id'], 'mine')
        with patch('factory.BRAIN_ENABLED', False):
            result = await memory_search(self.context(), MemoryInput(query='note'))
        self.assertTrue(result.data['unavailable'])


if __name__ == '__main__':
    unittest.main()
