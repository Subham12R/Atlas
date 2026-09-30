"""Model thinking is surfaced separately from the answer and never stored as the reply."""
import asyncio
import unittest
from types import SimpleNamespace as NS
from unittest.mock import patch

from adapters.base import AdapterTurn, ReasoningSplitter, split_reasoning
from adapters.local_adapter import LocalAdapter
from tools.contracts import AgentEventAdapter


def chunk(content=None, reasoning=None):
    delta = NS(content=content, reasoning_content=reasoning, tool_calls=None)
    return NS(choices=[NS(delta=delta, finish_reason=None)])


class Stream:
    def __init__(self, chunks):
        self.chunks = chunks

    def __aiter__(self):
        return self._gen()

    async def _gen(self):
        for item in self.chunks:
            yield item


async def collect(agen):
    return [item async for item in agen]


class SplitterTests(unittest.TestCase):
    def test_inline_think_tags_split_across_chunks_and_control_tokens_dropped(self):
        splitter = ReasoningSplitter()
        out = []
        for piece in ('<thi', 'nk>plan it', '</th', 'ink>\n<|begin_of_box|>391<|end_', 'of_box|> a<b'):
            out += splitter.feed(piece)
        out += splitter.flush()
        thinking = ''.join(t for kind, t in out if kind == 'thinking')
        answer = ''.join(t for kind, t in out if kind == 'text')
        self.assertEqual(thinking, 'plan it')
        self.assertEqual(answer, '\n391 a<b')

    def test_full_text_helper(self):
        self.assertEqual(split_reasoning('<think>why</think>Answer'), ('Answer', 'why'))
        self.assertEqual(split_reasoning('Plain <|end_of_box|>answer'), ('Plain answer', ''))


class OpenAICompatibleThinkingTests(unittest.TestCase):
    def test_lm_studio_reasoning_content_streams_as_thinking_not_answer(self):
        adapter = LocalAdapter(base_url='http://127.0.0.1:1234/v1', model='glm')

        async def create(**kwargs):
            return Stream([chunk(reasoning='Got it, '), chunk(reasoning='17*23.'),
                           chunk(content='\n<|begin_of_box|>391'), chunk(content='<|end_of_box|>')])

        with patch.object(adapter._client.chat.completions, 'create', side_effect=create):
            events = asyncio.run(collect(adapter.send_stream('17*23?')))
        self.assertEqual([e['thinking'] for e in events if isinstance(e, dict)], ['Got it, ', '17*23.'])
        self.assertEqual(''.join(e for e in events if isinstance(e, str)), '\n391')
        self.assertEqual(adapter._messages[-1], {'role': 'assistant', 'content': '\n391'})

    def test_agent_turn_returns_reasoning_separately(self):
        adapter = LocalAdapter(base_url='http://127.0.0.1:1234/v1', model='glm')

        async def create(**kwargs):
            message = NS(content='<|begin_of_box|>391<|end_of_box|>', reasoning_content='multiply',
                         tool_calls=None)
            return NS(choices=[NS(message=message, finish_reason='stop')])

        with patch.object(adapter._client.chat.completions, 'create', side_effect=create):
            turn = asyncio.run(adapter.run_turn([], []))
        self.assertEqual((turn.text, turn.reasoning), ('391', 'multiply'))


class BrainAndAgentThinkingTests(unittest.TestCase):
    def test_brain_passes_thinking_through_but_stores_only_the_answer(self):
        from brain.brain import Brain

        class Writer:
            name = 'local'

            async def send_stream(self, prompt, images=None):
                yield {'thinking': 'hmm'}
                yield 'Answer'

        brain = Brain.__new__(Brain)
        brain.adapter = Writer()
        stored = []
        brain.prepare_agent_turn = lambda prompt: ('', {'hits': []})

        async def finish(prompt, text, recall, meta=None):
            stored.append(text)
        brain.finish_agent_turn = finish
        events = asyncio.run(collect(brain.send_stream('q')))
        self.assertEqual(events[:2], [{'thinking': 'hmm'}, 'Answer'])
        self.assertEqual(stored, ['Answer'])

    def test_agent_reply_reasoning_is_emitted_as_a_valid_event(self):
        from agents.runner import run_selected
        from tools.contracts import AgentTurnRequest

        class Writer:
            async def run_turn(self, messages, tools):
                return AdapterTurn('A plan.', reasoning='first I consider the goal')

        events = []
        asyncio.run(run_selected(AgentTurnRequest(prompt='plan my week', mode='plan'), Writer(),
                                 'fake', None, events.append, asyncio.Event()))
        reasoning = [e for e in events if e['type'] == 'reasoning.delta']
        self.assertEqual(''.join(e['text'] for e in reasoning), 'first I consider the goal')
        for event in reasoning:
            AgentEventAdapter.validate_python(event)
        order = [e['type'] for e in events]
        self.assertLess(order.index('reasoning.delta'), order.index('assistant.delta'))


if __name__ == '__main__':
    unittest.main()
