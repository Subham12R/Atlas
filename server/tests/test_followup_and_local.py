import asyncio
import unittest
from unittest.mock import patch

from adapters.base import AdapterTurn, ThinkingGuard, ThinkingRunaway, split_reasoning
from agents.query_rewrite import Rewrite, heuristic_query, needs_rewrite
from agents.runner import run_selected
from brain.retriever import _fit
from budget import fit_history, fit_items
from tools.contracts import AgentTurnRequest, RecentTurn, ToolResult

RECENT = [RecentTurn(role='user', content='who is dr sajal saha'),
          RecentTurn(role='assistant', content='Several people share that name.')]


class RewriteTests(unittest.IsolatedAsyncioTestCase):
    def test_fragment_followups_need_rewrite_but_standalone_does_not(self):
        self.assertTrue(needs_rewrite('from adamas university', RECENT))
        self.assertTrue(needs_rewrite('and what about his publications in the last five years please', RECENT))
        self.assertFalse(needs_rewrite('from adamas university', []))
        self.assertFalse(needs_rewrite('explain how transformers compute attention over long sequences today', RECENT))

    def test_heuristic_keeps_the_previous_subject(self):
        query = heuristic_query('from adamas university', RECENT)
        self.assertIn('sajal saha', query)
        self.assertIn('adamas', query)

    async def run_search(self, rewrite):
        queries = []
        class Registry:
            async def run(self, name, params, *a, **k):
                queries.append(params['query'])
                source = {'source_id': 'S1', 'title': 'T', 'url': 'https://example.org/',
                          'host': 'example.org', 'snippet': 'evidence'}
                return ToolResult(summary='found', data={'results': [source]}, source_ids=['S1'])
        seen = []
        class Writer:
            async def run_turn(self, messages, tools):
                seen.append(messages)
                return AdapterTurn('Answer [S1]')
        async def fake(*args, **kwargs):
            return rewrite
        events = []
        with patch('agents.runner.default_registry', return_value=Registry()), \
                patch('agents.runner.rewrite_query', fake):
            await run_selected(AgentTurnRequest(prompt='from adamas university', mode='search_web',
                                                recent=RECENT), Writer(), 'fake', 'm',
                               events.append, asyncio.Event())
        return queries, seen, events

    async def test_confident_rewrite_becomes_the_search_query(self):
        queries, seen, events = await self.run_search(Rewrite(query='Dr Sajal Saha Adamas University'))
        self.assertEqual(queries, ['Dr Sajal Saha Adamas University'])
        self.assertEqual(next(e['query'] for e in events if e['type'] == 'tool.started'),
                         'Dr Sajal Saha Adamas University')
        self.assertIn('Resolved question: Dr Sajal Saha Adamas University', seen[0][-1].content)
        self.assertIn('share a name', seen[0][0].content)

    async def test_unconfident_rewrite_asks_instead_of_searching(self):
        queries, _, events = await self.run_search(
            Rewrite(query='adamas university', confident=False, question='Which person do you mean?'))
        self.assertEqual(queries, [])
        self.assertEqual(next(e['text'] for e in events if e['type'] == 'assistant.delta'),
                         'Which person do you mean?')


class GuardTests(unittest.TestCase):
    def test_runaway_thinking_without_an_answer_is_aborted(self):
        guard = ThinkingGuard(max_chars=500)
        with self.assertRaises(ThinkingRunaway):
            for i in range(100):
                guard.feed('thinking', f'step {i} considering another distinct angle here. ')

    def test_repeating_thinking_is_aborted(self):
        guard = ThinkingGuard()
        with self.assertRaises(ThinkingRunaway):
            for _ in range(200):
                guard.feed('thinking', 'Wait, let me reconsider the question again. ')

    def test_answering_resets_the_budget(self):
        guard = ThinkingGuard(max_chars=100)
        guard.feed('thinking', 'short thought')
        guard.feed('text', 'Answer')
        guard.feed('thinking', 'x' * 1000)  # post-answer reasoning is not policed

    def test_bare_closing_think_tag_splits_reasoning(self):
        self.assertEqual(split_reasoning('reasoning here</think>The answer.'),
                         ('The answer.', 'reasoning here'))
        self.assertEqual(split_reasoning('<think>a</think>b'), ('b', 'a'))


class BudgetAndMemoryTests(unittest.TestCase):
    def test_fit_helpers_never_cut_inside_an_item(self):
        self.assertEqual(fit_items(['a' * 10, 'b' * 10, 'c' * 10], 25), ['a' * 10, 'b' * 10])
        self.assertEqual(fit_items(['a' * 50], 10), ['a' * 50])  # first item always survives
        turns = [RecentTurn(role='user', content='x' * 10) for _ in range(5)]
        self.assertEqual(len(fit_history(turns, 25)), 2)

    def test_memory_truncates_on_line_boundaries(self):
        text = _fit([('[Relevant memory]', ['- first fact here', '- second fact here', '- third fact here'])], 40)
        self.assertIn('- second fact here', text)
        self.assertNotIn('third', text)
        self.assertTrue(all(line.startswith(('-', '[')) for line in text.splitlines()))


def _response(content, reasoning='', finish='stop'):
    from types import SimpleNamespace as NS
    message = NS(content=content, tool_calls=None, reasoning_content=reasoning)
    return NS(choices=[NS(message=message, finish_reason=finish)])


class EmptyAnswerRecoveryTests(unittest.IsolatedAsyncioTestCase):
    async def test_thinking_only_reply_is_retried_without_reasoning(self):
        from adapters.base import TurnMessage
        from adapters.local_adapter import LocalAdapter
        adapter = LocalAdapter(model='qwen')
        calls = []

        async def fake_create(**kwargs):
            calls.append((adapter.reasoning, kwargs['messages'][-1]['content']))
            return _response('', 'long deliberation') if len(calls) == 1 else _response('Final answer [S1]')
        adapter._create = fake_create
        adapter.reasoning = 'high'
        turn = await adapter.run_turn([TurnMessage(role='user', content='who is x')], [])
        self.assertEqual(turn.text, 'Final answer [S1]')
        self.assertEqual([c[0] for c in calls], ['high', 'off'])
        self.assertIn('Answer directly', calls[1][1])
        self.assertEqual(adapter.reasoning, 'high')  # the user's setting is restored
        self.assertIn('long deliberation', turn.reasoning)

    async def test_normal_reply_is_not_retried(self):
        from adapters.base import TurnMessage
        from adapters.local_adapter import LocalAdapter
        adapter = LocalAdapter(model='qwen')
        count = []

        async def fake_create(**kwargs):
            count.append(1)
            return _response('Hello', 'short thought')
        adapter._create = fake_create
        self.assertEqual((await adapter.run_turn([TurnMessage(role='user', content='hi')], [])).text, 'Hello')
        self.assertEqual(len(count), 1)


class WebAnswerMemoryTests(unittest.TestCase):
    def test_web_sourced_answers_are_stored_but_not_recallable(self):
        from brain.brain import Brain

        class Store:
            def __init__(self): self.added = []
            def create_thread(self, *a): pass
            def add_message(self, thread_id, role, content, provider, meta=None, chunks=None):
                self.added.append((role, chunks))

        class Embedder:
            def embed(self, texts): return [[0.0] for _ in texts]
            def embed_one(self, text): return [0.0]
        store = Store()
        brain = Brain(adapter=type('A', (), {'name': 'a'})(), store=store, embedder=Embedder(),
                      thread_id='t', provider='local')
        brain._store_turn('assistant', 'Dr X is a physician [S1].', recallable=False)
        brain._store_turn('assistant', 'Plain chat answer.')
        self.assertEqual(store.added[0], ('assistant', []))
        self.assertTrue(store.added[1][1])


if __name__ == '__main__':
    unittest.main()
