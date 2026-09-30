import asyncio
import unittest
from unittest.mock import patch

from brain.brain import Brain
from agents.runner import run_selected
from adapters.base import AdapterCapabilities, AdapterTurn, Reply, ToolCall
from tools.contracts import AgentTurnRequest, ToolResult
from tools.registry import ToolRegistry, ToolSpec
from pydantic import BaseModel


class FakeAdapter:
    name = 'fake'
    def __init__(self): self.prompts = []
    async def send(self, prompt, images=None):
        self.prompts.append(prompt)
        return Reply(text='final', provider='fake')
    async def send_stream(self, prompt, images=None):
        self.prompts.append(prompt)
        yield 'final'


class FakeStore:
    def create_thread(self, *args): pass


class BrainTurnTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.adapter = FakeAdapter()
        self.brain = Brain(self.adapter, FakeStore(), object(), 'thread', 'fake', auto_summary=False)
        self.stored = []
        self.brain._store_turn = lambda role, content, meta=None: self.stored.append((role, content))

    async def test_preparation_once_final_only_once(self):
        with patch('brain.brain.build_context', return_value=('memory', {'hits': []})) as recall:
            context, hits = self.brain.prepare_agent_turn('real question')
            await self.adapter.send('internal planning')
            await self.brain.finish_agent_turn('real question', 'final', hits, {'source_ids': ['S1']})
            recall.assert_called_once()
            self.assertEqual(context, 'memory')
            self.assertEqual(self.stored, [('user', 'real question'), ('assistant', 'final')])

    async def test_agent_tool_rounds_recall_and_persist_once(self):
        class Inputs(BaseModel): query: str
        async def search(context, params):
            return ToolResult(summary='found', data={'hits': ['current thread']})
        class Writer:
            name = 'openai'
            model = 'gpt-4o'
            capabilities = AdapterCapabilities(tool_calls=True)
            def __init__(self):
                self.turns = iter([
                    AdapterTurn('', (ToolCall('c1', 'memory_search', '{"query":"q"}'),)),
                    AdapterTurn('answer')
                ])
            async def run_turn(self, messages, tools): return next(self.turns)
        self.brain.adapter = Writer()
        registry = ToolRegistry([ToolSpec(name=name, input_model=Inputs, handler=search)
                                 for name in ('web_search', 'fetch_page', 'memory_search')])
        with patch('brain.brain.build_context', return_value=('memory', {'hits': []})) as recall, \
             patch('agents.runner.default_registry', return_value=registry):
            await run_selected(AgentTurnRequest(prompt='real question', mode='tools'),
                               self.brain, 'openai', 'gpt-4o', lambda event: None,
                               asyncio.Event())
        recall.assert_called_once_with(self.brain.store, self.brain.embedder, 'real question',
                                       'thread', self.brain.topk, self.brain.budget,
                                       self.brain.max_distance)
        self.assertEqual(self.stored, [('user', 'real question'), ('assistant', 'answer')])

    async def test_normal_send_and_stream_use_same_boundary(self):
        with patch('brain.brain.build_context', return_value=('memory', {'hits': []})) as recall:
            reply = await self.brain.send('q1')
            chunks = [chunk async for chunk in self.brain.send_stream('q2')]
            self.assertEqual(reply.text, 'final')
            self.assertEqual(chunks[0], 'final')
            self.assertEqual(self.adapter.prompts, ['memory\n\nq1', 'memory\n\nq2'])
            self.assertEqual(self.stored, [('user', 'q1'), ('assistant', 'final'),
                                           ('user', 'q2'), ('assistant', 'final')])
            self.assertEqual(recall.call_count, 2)


if __name__ == '__main__':
    unittest.main()
