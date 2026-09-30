import asyncio
import time
import unittest

from pydantic import BaseModel, ValidationError

from tools.contracts import AgentEventAdapter, AgentTurnRequest, ToolContext, ToolResult, ToolRunBudget
from tools.registry import ToolDenied, ToolNotFound, ToolRegistry, ToolSpec


class Inputs(BaseModel):
    query: str


async def echo(context, params):
    return ToolResult(summary=params.query, data={'query': params.query})


class RegistryTests(unittest.IsolatedAsyncioTestCase):
    def context(self, *, allowed=('web_search',), timeout=10, cancel=False):
        event = asyncio.Event()
        if cancel:
            event.set()
        return ToolContext(run_id='r1', allowed_tools=frozenset(allowed),
                           deadline=time.monotonic() + timeout, cancelled=event)

    async def test_request_rejects_unknown_policy_and_oversized_context(self):
        with self.assertRaises(ValidationError):
            AgentTurnRequest(prompt='hello', mode='chat', tool_names=['run_shell'])
        with self.assertRaises(ValidationError):
            AgentTurnRequest(prompt='hello', mode='draft', draft_kind='unknown')
        self.assertEqual(AgentTurnRequest(prompt='hello', mode='draft',
                                          draft_kind='decision_memo').draft_kind,
                         'decision_memo')
        with self.assertRaises(ValidationError):
            AgentTurnRequest(prompt='hello', mode='chat', recent=[
                {'role': 'user', 'content': 'x' * 8001}
            ])
        with self.assertRaises(ValidationError):
            AgentTurnRequest(prompt='x' * 1001, mode='search_web')
        with self.assertRaises(ValidationError):
            AgentTurnRequest(prompt='hello', mode='tools', images=[{'data': 'abc', 'mime': 'image/png'}])
        with self.assertRaises(ValidationError):
            AgentTurnRequest(prompt='hello', mode='chat', attachments=[
                {'id': 'a', 'name': 'note.md', 'mime': 'text/plain', 'content': 'x' * (5 * 1024 * 1024 + 1)}
            ])

    async def test_agent_events_are_typed_and_reject_unknown_fields(self):
        event = AgentEventAdapter.validate_python({
            'type': 'run.completed', 'status': 'partial', 'sources': []
        })
        self.assertEqual(event.type, 'run.completed')
        with self.assertRaises(ValidationError):
            AgentEventAdapter.validate_python({'type': 'run.completed', 'status': 'success'})
        with self.assertRaises(ValidationError):
            AgentEventAdapter.validate_python({'type': 'run.completed', 'status': 'completed',
                                               'shell': True})

    async def test_registry_rejects_duplicate_names(self):
        spec = ToolSpec(name='web_search', input_model=Inputs, handler=echo)
        with self.assertRaises(ValueError):
            ToolRegistry([spec, spec])

    async def test_only_registered_tools_with_validated_input(self):
        registry = ToolRegistry([ToolSpec(name='web_search', input_model=Inputs, handler=echo)])
        self.assertEqual((await registry.run('web_search', {'query': 'ok'}, self.context())).summary, 'ok')
        with self.assertRaises(ToolNotFound):
            await registry.run('other', {}, self.context())
        with self.assertRaises(ValidationError):
            await registry.run('web_search', {'query': 'ok', 'extra': True}, self.context())
        with self.assertRaises(ToolDenied):
            await registry.run('web_search', {'query': 'ok'}, self.context(allowed=()))

    async def test_calculator_is_decimal_and_rejects_code_or_unbounded_work(self):
        from tools.registry import default_registry
        registry = default_registry()
        context = self.context(allowed=('calculator',))
        result = await registry.run('calculator', {'expression': '0.1 + 0.2'}, context)
        self.assertEqual(result.data['result'], '0.3')
        for expression in ('__import__("os")', '1 / 0', '2 ** 1000', '1+' * 70 + '1'):
            with self.subTest(expression=expression), self.assertRaises((ValueError, ValidationError)):
                await registry.run('calculator', {'expression': expression}, context)
        with self.assertRaises(ToolDenied):
            await registry.run('calculator', {'expression': '2+2'}, self.context())

    async def test_compare_sources_reads_only_issued_ids_without_inventing_agreement(self):
        from tools.registry import default_registry
        registry = default_registry()
        context = self.context(allowed=('compare_sources',))
        context.sources['S1'] = {'source_id': 'S1', 'title': 'First', 'snippet': 'Policy starts in 2025.'}
        context.sources['S2'] = {'source_id': 'S2', 'title': 'Second', 'snippet': 'Policy starts in 2026.'}
        result = await registry.run('compare_sources',
            {'source_ids': ['S1', 'S2'], 'question': 'When does it start?'}, context)
        self.assertEqual([item['source_id'] for item in result.data['sources']], ['S1', 'S2'])
        self.assertIn('2025', result.data['sources'][0]['excerpt'])
        self.assertNotIn('agree', result.summary.lower())
        with self.assertRaises(ValueError):
            await registry.run('compare_sources',
                {'source_ids': ['S1', 'S3'], 'question': 'When?'}, context)
        with self.assertRaises(ValidationError):
            await registry.run('compare_sources',
                {'source_ids': ['S1', 'S1'], 'question': 'When?'}, context)

    async def test_limits_cancel_deadline_and_write_approval(self):
        registry = ToolRegistry([
            ToolSpec(name='web_search', input_model=Inputs, handler=echo, max_output_bytes=8),
            ToolSpec(name='save', input_model=Inputs, handler=echo, effect='write', approval='explicit_user_confirmation')
        ])
        with self.assertRaises(ToolDenied):
            await registry.run('web_search', {'query': 'long answer'}, self.context())
        with self.assertRaises(ToolDenied):
            await registry.run('web_search', {'query': 'ok'}, self.context(cancel=True))
        with self.assertRaises(ToolDenied):
            await registry.run('web_search', {'query': 'ok'}, self.context(timeout=-1))
        with self.assertRaises(ToolDenied):
            await registry.run('save', {'query': 'ok'}, self.context(allowed=('save',)))
        budget = ToolRunBudget(max_calls=1)
        registry = ToolRegistry([ToolSpec(name='web_search', input_model=Inputs, handler=echo)])
        await registry.run('web_search', {'query': 'ok'}, self.context(), budget)
        with self.assertRaises(ToolDenied):
            await registry.run('web_search', {'query': 'ok'}, self.context(), budget)


if __name__ == '__main__':
    unittest.main()
