import asyncio
import json
import time
import unittest
from unittest.mock import patch

from adapters.base import AdapterCapabilities, AdapterTurn, ToolCall
from agents.runner import run_selected, run_tool_loop
from tools.contracts import ToolContext, ToolResult
from tools.registry import ToolDenied, ToolRegistry, ToolSpec
from pydantic import BaseModel


class Input(BaseModel):
    query: str


class FakeAdapter:
    capabilities = AdapterCapabilities(tool_calls=True)
    def __init__(self, turns):
        self.turns = iter(turns)
        self.messages = []
    async def run_turn(self, messages, tools):
        self.messages.append(messages[:])
        return next(self.turns)


async def echo(ctx, params):
    return ToolResult(summary='ok', data={'result': params.query})


class LoopTests(unittest.IsolatedAsyncioTestCase):
    def test_agent_timeout_is_bounded_and_local_is_calibratable(self):
        from agents.research import agent_timeout_seconds
        from unittest.mock import patch
        self.assertEqual(agent_timeout_seconds('openai'), 90)
        self.assertEqual(agent_timeout_seconds('local'), 180)
        with patch.dict('os.environ', {'ATLAS_LOCAL_AGENT_TIMEOUT_SECONDS': '240'}):
            self.assertEqual(agent_timeout_seconds('local'), 240)
        with patch.dict('os.environ', {'ATLAS_LOCAL_AGENT_TIMEOUT_SECONDS': '99999'}):
            self.assertEqual(agent_timeout_seconds('local'), 300)
        with patch.dict('os.environ', {'ATLAS_LOCAL_AGENT_TIMEOUT_SECONDS': 'bad'}):
            self.assertEqual(agent_timeout_seconds('local'), 180)

    def context(self, cancelled=False):
        event = asyncio.Event()
        if cancelled: event.set()
        return ToolContext(run_id='r', allowed_tools=frozenset({'web_search'}),
                           deadline=time.monotonic() + 10, cancelled=event)

    async def test_final_without_calls(self):
        adapter = FakeAdapter([AdapterTurn('answer')])
        self.assertEqual(await run_tool_loop(adapter, 'question', self.context(), lambda e: None), 'answer')

    async def test_one_call_and_native_result(self):
        adapter = FakeAdapter([AdapterTurn('', (ToolCall('c1', 'web_search', '{"query":"q"}'),)),
                               AdapterTurn('Source [S1]')])
        registry = ToolRegistry([ToolSpec(name='web_search', input_model=Input, handler=echo)])
        context = self.context()
        with patch('agents.runner.default_registry', return_value=registry):
            result = await run_tool_loop(adapter, 'question', context, lambda e: None)
        self.assertEqual(result, 'Source ')
        self.assertEqual(context.degraded_reason, 'invalid or missing citations')
        self.assertEqual(adapter.messages[1][-1].tool_call_id, 'c1')
        payload = json.loads(adapter.messages[1][-1].content)
        self.assertEqual(payload, {'summary': 'ok', 'data': {'result': 'q'}, 'untrusted': False})

    async def test_native_model_can_choose_bounded_calculator(self):
        adapter = FakeAdapter([AdapterTurn('', (ToolCall('calc1', 'calculator',
                                 '{"expression":"0.1+0.2"}'),)), AdapterTurn('0.3')])
        context = self.context()
        context.allowed_tools = frozenset({'calculator'})
        events = []
        answer = await run_tool_loop(adapter, 'What is 0.1 + 0.2?', context, events.append)
        self.assertEqual(answer, '0.3')
        result = json.loads(adapter.messages[1][-1].content)
        self.assertEqual(result['data']['result'], '0.3')
        self.assertIn('calculator', [e['tool'] for e in events if e['type'] == 'tool.completed'])

    async def test_unknown_and_repeated_call_ids_are_rejected(self):
        for calls in ((ToolCall('c1', 'unknown', '{}'),),
                      (ToolCall('c1', 'web_search', '{}'), ToolCall('c1', 'web_search', '{}'))):
            adapter = FakeAdapter([AdapterTurn('', calls)])
            with self.assertRaises((ValueError, RuntimeError)):
                await run_tool_loop(adapter, 'question', self.context(), lambda e: None)

    async def test_fetched_page_trace_excludes_raw_page_text(self):
        from tools.contracts import AgentEventAdapter
        from tools.web import FetchInput
        async def fetch(ctx, params):
            ctx.sources[params.source_id].update({'text': 'private raw body',
                                                   'final_url': 'https://example.org/'})
            return ToolResult(summary='fetched', data={'text': 'private raw body'},
                              source_ids=[params.source_id], untrusted=True)
        registry = ToolRegistry([ToolSpec(name='fetch_page', input_model=FetchInput, handler=fetch)])
        adapter = FakeAdapter([AdapterTurn('', (ToolCall('c1', 'fetch_page', '{"source_id":"S1"}'),)),
                               AdapterTurn('Evidence [S1]')])
        context = self.context()
        context.allowed_tools = frozenset({'fetch_page'})
        context.sources['S1'] = {'source_id': 'S1', 'title': 'Source',
                                 'url': 'https://example.org/', 'host': 'example.org',
                                 'snippet': 'snippet', 'fetched': False}
        events = []
        def validate(event):
            AgentEventAdapter.validate_python(event)
            events.append(event)
        with patch('agents.runner.default_registry', return_value=registry):
            await run_tool_loop(adapter, 'question', context, validate)
        source_event = next(event for event in events if event['type'] == 'source.found')
        self.assertNotIn('text', source_event['source'])

    async def test_malformed_arguments_and_tool_errors_fail_closed(self):
        registry = ToolRegistry([ToolSpec(name='web_search', input_model=Input, handler=echo)])
        adapter = FakeAdapter([AdapterTurn('', (ToolCall('bad', 'web_search', '{'),))])
        with patch('agents.runner.default_registry', return_value=registry), self.assertRaises(ValueError):
            await run_tool_loop(adapter, 'question', self.context(), lambda event: None)

        async def fail(ctx, params): raise RuntimeError('private failure detail')
        registry = ToolRegistry([ToolSpec(name='web_search', input_model=Input, handler=fail)])
        adapter = FakeAdapter([AdapterTurn('', (ToolCall('c1', 'web_search', '{"query":"q"}'),))])
        events = []
        with patch('agents.runner.default_registry', return_value=registry), self.assertRaises(RuntimeError):
            await run_tool_loop(adapter, 'question', self.context(), events.append)
        failure = next(event for event in events if event['type'] == 'tool.failed')
        self.assertNotIn('private failure detail', str(failure))

    async def test_parallel_read_calls_are_bounded_at_three(self):
        running = 0
        peak = 0
        async def slow(ctx, params):
            nonlocal running, peak
            running += 1
            peak = max(peak, running)
            await asyncio.sleep(.02)
            running -= 1
            return ToolResult(summary='ok', data={'query': params.query})
        registry = ToolRegistry([ToolSpec(name='web_search', input_model=Input, handler=slow)])
        calls = tuple(ToolCall(f'c{i}', 'web_search', f'{{"query":"q{i}"}}') for i in range(4))
        adapter = FakeAdapter([AdapterTurn('', calls), AdapterTurn('finished')])
        with patch('agents.runner.default_registry', return_value=registry):
            self.assertEqual(await run_tool_loop(adapter, 'question', self.context(), lambda event: None), 'finished')
        self.assertEqual(peak, 3)

    async def test_cancellation_during_tool_call_stops_later_rounds(self):
        started = asyncio.Event()
        async def wait_for_cancel(ctx, params):
            started.set()
            await ctx.cancelled.wait()
            return ToolResult(summary='cancelled')
        registry = ToolRegistry([ToolSpec(name='web_search', input_model=Input,
                                          handler=wait_for_cancel)])
        adapter = FakeAdapter([AdapterTurn('', (ToolCall('c1', 'web_search', '{"query":"q"}'),)),
                               AdapterTurn('must not run')])
        context = self.context()
        with patch('agents.runner.default_registry', return_value=registry):
            task = asyncio.create_task(run_tool_loop(adapter, 'question', context, lambda event: None))
            await started.wait()
            context.cancelled.set()
            with self.assertRaises(ToolDenied):
                await task
        self.assertEqual(len(adapter.messages), 1)

    async def test_round_and_call_budgets_stop_the_loop(self):
        calls = [ToolCall(f'c{i}', 'web_search', '{"query":"q"}') for i in range(4)]
        adapter = FakeAdapter([AdapterTurn('', (call,)) for call in calls])
        registry = ToolRegistry([ToolSpec(name='web_search', input_model=Input, handler=echo)])
        with patch('agents.runner.default_registry', return_value=registry), self.assertRaisesRegex(ValueError, 'round'):
            await run_tool_loop(adapter, 'question', self.context(), lambda event: None)
        adapter = FakeAdapter([AdapterTurn('', tuple(calls + [ToolCall('c5', 'web_search', '{}'),
                                                               ToolCall('c6', 'web_search', '{}'),
                                                               ToolCall('c7', 'web_search', '{}')]))])
        with patch('agents.runner.default_registry', return_value=registry), self.assertRaisesRegex(ValueError, 'budget'):
            await run_tool_loop(adapter, 'question', self.context(), lambda event: None)

    async def test_search_mode_asks_for_subject_instead_of_searching_a_pronoun(self):
        from tools.contracts import AgentTurnRequest
        class Writer:
            async def run_turn(self, *args): raise AssertionError('No evidence was found')
        events = []
        with patch('agents.runner.default_registry') as registry:
            await run_selected(AgentTurnRequest(prompt='get me his portfolio and details',
                                                mode='search_web'), Writer(), 'fake', None,
                               events.append, asyncio.Event())
            registry.assert_not_called()
        self.assertIn('name', next(e['text'] for e in events if e['type'] == 'assistant.delta'))
        self.assertEqual(next(e['status'] for e in events if e['type'] == 'run.completed'), 'partial')
        events.clear()
        with patch('agents.runner.default_registry') as registry:
            await run_selected(AgentTurnRequest(prompt='get me that portfolio', mode='search_web',
                                                recent=[{'role': 'user', 'content': 'PRIVATE-DO-NOT-SEARCH'}]),
                               Writer(), 'fake', None, events.append, asyncio.Event())
            registry.assert_not_called()
        self.assertNotIn('PRIVATE-DO-NOT-SEARCH', str(events))

    async def test_bare_continuations_never_search_the_literal_word(self):
        from tools.contracts import AgentTurnRequest
        for prompt in ('continue', 'Try again.', 'go on'):
            registry = type('R', (), {'calls': [], 'run': None})()
            async def run(*args, **kwargs):
                registry.calls.append(args)
            registry.run = run
            events = []
            with patch('agents.runner.default_registry', return_value=registry):
                await run_selected(AgentTurnRequest(prompt=prompt, mode='search_web'), object(),
                                   'fake', None, events.append, asyncio.Event())
            self.assertEqual(registry.calls, [], prompt)
            self.assertIn('subject', next(e['text'] for e in events if e['type'] == 'assistant.delta'))

    async def test_short_do_followup_does_not_search_the_literal_word(self):
        from tools.contracts import AgentTurnRequest
        class Writer:
            async def run_turn(self, *args): return AdapterTurn('Wrong search [S1]')
        class Registry:
            def __init__(self): self.calls = []
            async def run(self, *args, **kwargs):
                self.calls.append(args)
                source = {'source_id': 'S1', 'title': 'Wrong DO result',
                          'url': 'https://example.org/', 'host': 'example.org', 'snippet': 'unrelated'}
                return ToolResult(summary='found', data={'results': [source]}, source_ids=['S1'])
        registry = Registry()
        events = []
        with patch('agents.runner.default_registry', return_value=registry):
            await run_selected(AgentTurnRequest(prompt='do', mode='search_web', recent=[
                {'role': 'user', 'content': 'PRIVATE-DO-NOT-SEARCH'}
            ]), Writer(), 'fake', None, events.append, asyncio.Event())
        self.assertEqual(registry.calls, [])
        reply = next(e['text'] for e in events if e['type'] == 'assistant.delta')
        self.assertIn('subject', reply.lower())
        self.assertNotIn('PRIVATE-DO-NOT-SEARCH', str(events))
        self.assertEqual(next(e['status'] for e in events if e['type'] == 'run.completed'), 'partial')

    async def test_search_mode_keeps_issued_citations_and_metadata(self):
        from adapters.base import AdapterTurn
        from tools.contracts import AgentTurnRequest
        source = {'source_id': 'S1', 'title': 'Source', 'url': 'https://example.org/',
                  'host': 'example.org', 'snippet': 'evidence'}
        class Registry:
            async def run(self, *args, **kwargs):
                return ToolResult(summary='found', data={'results': [source]}, source_ids=['S1'])
        class Writer:
            async def run_turn(self, messages, tools): return AdapterTurn('Answer [S1]')
        class Brain:
            adapter = Writer()
            thread_id = 'thread'
            def prepare_agent_turn(self, prompt): return '', object()
            async def finish_agent_turn(self, prompt, answer, recall, metadata):
                self.metadata = metadata
        brain = Brain()
        events = []
        with patch('agents.runner.default_registry', return_value=Registry()):
            await run_selected(AgentTurnRequest(prompt='question', mode='search_web'), brain,
                               'fake', 'model', events.append, asyncio.Event())
        completed = next(event for event in events if event['type'] == 'run.completed')
        answer = next(event for event in events if event['type'] == 'assistant.delta')
        self.assertEqual(completed['status'], 'completed')
        self.assertEqual(brain.metadata['source_ids'], ['S1'])
        self.assertIn('[S1]', answer['text'])

    async def test_private_context_does_not_offer_public_web_tools(self):
        from tools.contracts import AgentTurnRequest
        class Writer:
            model = 'gpt-4o'
            capabilities = AdapterCapabilities(tool_calls=True)
            async def run_turn(self, messages, tools):
                self.offered = {tool['name'] for tool in tools}
                return AdapterTurn('done')
        class Brain:
            def __init__(self): self.adapter = Writer(); self.thread_id = 'thread'
            def prepare_agent_turn(self, prompt): return 'private recall', None
            async def finish_agent_turn(self, *args): pass
        cases = [
            (AgentTurnRequest(prompt='question', mode='tools'), Brain()),
            (AgentTurnRequest(prompt='question', mode='tools', attachments=[{
                'id': 'selected', 'name': 'private.md', 'mime': 'text/plain', 'content': 'secret'
            }]), Writer()),
        ]
        for body, session in cases:
            with self.subTest(private='brain' if isinstance(session, Brain) else 'file'):
                events = []
                await run_selected(body, session, 'openai', 'gpt-4o', events.append,
                                   asyncio.Event())
                self.assertTrue(any(event['type'] == 'tool.progress' and
                                    'web tools unavailable' in event['phase'] for event in events))
                offered = (session.adapter if isinstance(session, Brain) else session).offered
                self.assertNotIn('web_search', offered)
                self.assertNotIn('fetch_page', offered)
        public = Writer()
        await run_selected(AgentTurnRequest(prompt='question', mode='tools'), public,
                           'openai', 'gpt-4o', lambda event: None, asyncio.Event())
        self.assertIn('web_search', public.offered)

    async def test_private_file_cannot_force_unoffered_web_search(self):
        from tools.contracts import AgentTurnRequest
        class Writer:
            model = 'gpt-4o'
            capabilities = AdapterCapabilities(tool_calls=True)
            async def run_turn(self, messages, tools):
                return AdapterTurn('', (ToolCall('leak', 'web_search', '{"query":"secret"}'),))
        request = AgentTurnRequest(prompt='question', mode='tools', attachments=[{
            'id': 'selected', 'name': 'private.md', 'mime': 'text/plain', 'content': 'secret'
        }])
        with patch('tools.web.websearch.search') as search:
            with self.assertRaises(ToolDenied):
                await run_selected(request, Writer(), 'openai', 'gpt-4o',
                                   lambda event: None, asyncio.Event())
            search.assert_not_called()

    async def test_cancellation_and_unsupported_provider(self):
        adapter = FakeAdapter([AdapterTurn('ok')])
        with self.assertRaises(RuntimeError):
            await run_tool_loop(adapter, 'q', self.context(cancelled=True), lambda e: None)
        adapter.capabilities = AdapterCapabilities()
        with self.assertRaisesRegex(ValueError, 'unsupported|does not support'):
            await run_tool_loop(adapter, 'q', self.context(), lambda e: None)


if __name__ == '__main__':
    unittest.main()
