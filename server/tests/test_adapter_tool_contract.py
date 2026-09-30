import json
import unittest
from types import SimpleNamespace as NS
from unittest.mock import AsyncMock

from adapters.base import ToolCall, TurnMessage
from adapters.openai_adapter import OpenAIAdapter
from adapters.anthropic_adapter import AnthropicAdapter
from adapters.gemini_adapter import GeminiAdapter
from adapters.openrouter_adapter import OpenRouterAdapter
from adapters.local_adapter import LocalAdapter

TOOLS = [{'name': 'web_search', 'description': 'search',
          'parameters': {'type': 'object', 'properties': {'query': {'type': 'string'}}}}]


class AdapterTests(unittest.IsolatedAsyncioTestCase):
    async def test_tool_call_contract_bounds_raw_arguments(self):
        with self.assertRaises(ValueError):
            ToolCall(id='call', name='web_search', arguments='x' * 8193)
        with self.assertRaises(ValueError):
            ToolCall(id='', name='web_search', arguments='{}')

    async def test_openai_maps_call_and_tool_result_without_executing(self):
        adapter = OpenAIAdapter('fake')
        call = NS(id='call1', function=NS(name='web_search', arguments='{"query":"q"}'))
        choice = NS(message=NS(content=None, tool_calls=[call]), finish_reason='tool_calls')
        mock = AsyncMock(return_value=NS(choices=[choice]))
        adapter._client.chat.completions.create = mock
        turn = await adapter.run_turn([TurnMessage(role='user', content='question')], TOOLS)
        self.assertEqual(turn.calls, (ToolCall(id='call1', name='web_search', arguments='{"query":"q"}'),))
        self.assertEqual(mock.call_args.kwargs['tools'][0]['function']['name'], 'web_search')
        await adapter.run_turn([TurnMessage(role='assistant', calls=turn.calls),
                                TurnMessage(role='tool', tool_call_id='call1', content='result')], TOOLS)
        self.assertEqual(mock.call_args.kwargs['messages'][-1]['tool_call_id'], 'call1')
        self.assertEqual(adapter._messages, [])
        await adapter.close()

    async def test_openai_maps_plain_text_and_multiple_calls(self):
        adapter = OpenAIAdapter('fake')
        plain = NS(choices=[NS(message=NS(content='plain', tool_calls=None), finish_reason='stop')])
        adapter._client.chat.completions.create = AsyncMock(return_value=plain)
        self.assertEqual((await adapter.run_turn([TurnMessage(role='user', content='q')], [])).text,
                         'plain')
        call1 = NS(id='one', function=NS(name='web_search', arguments='{"query":"one"}'))
        call2 = NS(id='two', function=NS(name='web_search', arguments='{"query":"two"}'))
        adapter._client.chat.completions.create = AsyncMock(return_value=NS(choices=[NS(
            message=NS(content=None, tool_calls=[call1, call2]), finish_reason='tool_calls')]))
        turn = await adapter.run_turn([TurnMessage(role='user', content='q')], TOOLS)
        self.assertEqual([call.id for call in turn.calls], ['one', 'two'])
        await adapter.close()

    async def test_local_stream_timeout_does_not_poison_followup_history(self):
        adapter = LocalAdapter(base_url='http://127.0.0.1:11434/v1', model='fixture')
        calls = []
        async def create(**kwargs):
            calls.append(kwargs['messages'])
            async def chunks():
                yield NS(choices=[NS(delta=NS(content='partial' if len(calls) == 2 else 'done'))])
                if len(calls) == 2:
                    raise TimeoutError('local model stalled')
            return chunks()
        adapter._client.chat.completions.create = create
        try:
            self.assertEqual([part async for part in adapter.send_stream('first')], ['done'])
            with self.assertRaises(TimeoutError):
                [part async for part in adapter.send_stream('failed follow-up')]
            self.assertEqual([part async for part in adapter.send_stream('next')], ['done'])
            self.assertEqual([(part['role'], part['content']) for part in calls[-1]],
                             [('user', 'first'), ('assistant', 'done'), ('user', 'next')])
        finally:
            await adapter.close()

    async def test_agent_turn_does_not_replace_local_chat_history(self):
        adapter = LocalAdapter(base_url='http://127.0.0.1:11434/v1', model='fixture')
        calls = []
        async def create(**kwargs):
            calls.append(kwargs['messages'])
            if kwargs.get('stream'):
                async def chunks():
                    yield NS(choices=[NS(delta=NS(content='done', tool_calls=None), finish_reason='stop')])
                return chunks()
            return NS(choices=[NS(message=NS(content='plan', tool_calls=None), finish_reason='stop')])
        adapter._client.chat.completions.create = create
        try:
            [part async for part in adapter.send_stream('initial subject')]
            await adapter.run_turn([TurnMessage(role='system', content='Agent instruction'),
                                    TurnMessage(role='user', content='Plan it')], [])
            [part async for part in adapter.send_stream('follow-up')]
            self.assertEqual([(part['role'], part['content']) for part in calls[-1]],
                             [('user', 'initial subject'), ('assistant', 'done'),
                              ('user', 'follow-up')])
        finally:
            await adapter.close()

    async def test_openai_rejects_unsupported_response_shape(self):
        adapter = OpenAIAdapter('fake')
        adapter._client.chat.completions.create = AsyncMock(return_value=NS(choices=[]))
        with self.assertRaisesRegex(ValueError, 'usable response'):
            await adapter.run_turn([TurnMessage(role='user', content='q')], TOOLS)
        await adapter.close()

    async def test_openai_stream_assembles_fragmented_arguments(self):
        adapter = OpenAIAdapter('fake')
        def chunk(arg, finish=None):
            return NS(choices=[NS(delta=NS(content=None, tool_calls=[NS(
                index=0, id='c1' if arg == '{' else None,
                function=NS(name='web_search' if arg == '{' else None, arguments=arg))]),
                finish_reason=finish)])
        async def stream():
            yield chunk('{')
            yield chunk('"query":"q"}', 'tool_calls')
        adapter._client.chat.completions.create = AsyncMock(return_value=stream())
        events = [e async for e in adapter.stream_turn([TurnMessage(role='user', content='q')], TOOLS)]
        self.assertEqual(json.loads(events[0].call.arguments), {'query': 'q'})
        self.assertEqual(events[-1].stop_reason, 'tool_calls')
        self.assertEqual(adapter._messages, [])
        await adapter.close()

    async def test_anthropic_maps_native_tool_use(self):
        adapter = AnthropicAdapter('fake')
        adapter._client.messages.create = AsyncMock(return_value=NS(content=[
            NS(type='tool_use', id='c1', name='web_search', input={'query':'q'})],
            stop_reason='tool_use'))
        turn = await adapter.run_turn([TurnMessage(role='user', content='q')], TOOLS)
        self.assertEqual(json.loads(turn.calls[0].arguments), {'query': 'q'})
        await adapter.run_turn([TurnMessage(role='assistant', calls=turn.calls),
                                TurnMessage(role='tool', tool_call_id='c1', content='done')], TOOLS)
        self.assertEqual(adapter._messages[-2]['content'][0]['type'], 'tool_result')
        await adapter.close()

    async def test_gemini_declares_functions_but_disables_sdk_auto_execution(self):
        adapter = GeminiAdapter('fake')
        response = NS(candidates=[NS(
            content=NS(parts=[NS(text=None, function_call=NS(id='c1', name='web_search',
                                                             args={'query':'q'}))]),
            finish_reason='STOP')])
        chat = NS(send_message=AsyncMock(return_value=response))
        created = {}
        def create(**kwargs):
            created.update(kwargs)
            return chat
        adapter._client = NS(aio=NS(chats=NS(create=create)))
        turn = await adapter.run_turn([TurnMessage(role='user', content='q')], TOOLS)
        self.assertEqual(turn.calls[0].name, 'web_search')
        self.assertTrue(chat.send_message.await_args.args)
        self.assertTrue(created['config'].automatic_function_calling.disable)

    async def test_unknown_routed_and_local_models_are_not_advertised(self):
        self.assertFalse(OpenRouterAdapter('fake').capabilities.tool_calls)
        self.assertFalse(LocalAdapter().capabilities.tool_calls)


if __name__ == '__main__':
    unittest.main()
