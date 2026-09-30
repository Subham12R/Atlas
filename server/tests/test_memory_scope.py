import unittest

from brain.db import connect
from brain.store import MemoryStore


class MemoryScopeTests(unittest.TestCase):
    def test_thread_scope_is_applied_before_vector_candidate_limit(self):
        store = MemoryStore(connect(':memory:', 4))
        self.addCleanup(store.con.close)
        store.create_thread('active', 'fake')
        store.create_thread('other', 'fake')
        query = [1.0, 0.0, 0.0, 0.0]
        close = [1.0, 0.1, 0.0, 0.0]
        target = [0.0, 1.0, 0.0, 0.0]
        for index in range(30):
            store.add_message('other', 'assistant', f'near {index}', chunks=[(f'near {index}', close)])
        store.add_message('active', 'assistant', 'scoped hit', chunks=[('scoped hit', target)])

        hits = store.search(query, k=1, max_distance=1.5, scope_thread_id='active')

        self.assertEqual([hit[0] for hit in hits], ['scoped hit'])


if __name__ == '__main__':
    unittest.main()
