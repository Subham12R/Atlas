import asyncio
import json
import time
import unittest
from unittest.mock import patch

from adapters.base import AdapterTurn, Reply
from tools.contracts import AgentTurnRequest, ToolContext
from agents.research import ResearchPlan, ResearchSource, research_run, validate_citations


class FakeAdapter:
    name = 'fake'
    def __init__(self, answer):
        self.answer = answer
        self.prompts = []
    async def init(self): pass
    async def close(self): pass
    async def send(self, prompt, images=None):
        self.prompts.append(prompt)
        return Reply(text=self.answer, provider='fake')
    async def run_turn(self, messages, tools):
        self.messages = messages
        return AdapterTurn(self.answer)


class ResearchTests(unittest.IsolatedAsyncioTestCase):
    async def test_two_queries_dedup_fetch_and_citations(self):
        planner = FakeAdapter(json.dumps({'objective': 'compare', 'queries': ['alpha', 'beta']}))
        writer = FakeAdapter('Compare [S1] and [S2].')
        calls = []
        async def search(key, query, limit):
            calls.append(query)
            return [{'title': query, 'url': f'https://{query}.example.org/', 'content': query},
                    {'title': 'duplicate', 'url': 'https://alpha.example.org/', 'content': 'dup'}]
        async def fake_fetch(context, params):
            return type('Result', (), {'data': {'text': 'page content'}})()
        request = AgentTurnRequest(prompt='Compare alpha and beta', mode='research',
                                   attachments=[{'id':'a','name':'private.md','mime':'text/plain',
                                                 'content':'PRIVATE-DO-NOT-SEARCH'}])
        events = []
        with patch('agents.research.build_adapter', return_value=planner), patch(
            'agents.research.credentials_store.get_value', return_value='fake'), patch(
            'agents.research.websearch.search', side_effect=search), patch(
            'agents.research.fetch_page', side_effect=fake_fetch
        ):
            result = await research_run(request, writer, 'fake', None, events.append)
        self.assertEqual(calls, ['alpha', 'beta'])
        self.assertEqual(len(result.sources), 2)
        self.assertEqual(result.status, 'completed')
        self.assertEqual([message.role for message in writer.messages], ['system', 'evidence', 'user'])
        self.assertNotIn('PRIVATE-DO-NOT-SEARCH', planner.prompts[0])
        self.assertNotIn('PRIVATE-DO-NOT-SEARCH', ' '.join(calls))
        self.assertTrue(any(e['type'] == 'source.found' for e in events))

    async def test_bad_plan_falls_back_and_bad_citation_degrades(self):
        planner = FakeAdapter('invalid JSON')
        writer = FakeAdapter('Unsupported [S9]')
        async def search(key, query, limit):
            return [{'title':'A','url':'https://example.org/','content':'snippet'}]
        with patch('agents.research.build_adapter', return_value=planner), patch(
            'agents.research.credentials_store.get_value', return_value='fake'), patch(
            'agents.research.websearch.search', side_effect=search), patch(
            'agents.research.fetch_page', side_effect=Exception('fetch failed')):
            result = await research_run(AgentTurnRequest(prompt='question', mode='research'),
                                        writer, 'fake', None, lambda e: None)
        self.assertEqual(result.status, 'partial')
        self.assertNotIn('[S9]', result.answer)

    async def test_invalid_plan_falls_back_to_trimmed_question(self):
        planner = FakeAdapter('not JSON')
        calls = []
        async def search(key, query, limit):
            calls.append(query)
            return []
        prompt = ' ' * 201 + 'current question'
        with patch('agents.research.build_adapter', return_value=planner), patch(
            'agents.research.credentials_store.get_value', return_value='fake'), patch(
            'agents.research.websearch.search', side_effect=search
        ):
            result = await research_run(AgentTurnRequest(prompt=prompt, mode='research'),
                                        FakeAdapter('unused'), 'fake', None, lambda event: None)
        self.assertEqual(calls, ['current question'])
        self.assertEqual(result.status, 'partial')

    async def test_missing_citations_retries_once_then_marks_partial(self):
        planner = FakeAdapter(json.dumps({'objective': 'find', 'queries': ['current policy']}))
        writer = FakeAdapter('The source says five years.')
        async def search(*args):
            return [{'title': 'Policy', 'url': 'https://policy.example.org/', 'content': 'Five years.'}]
        async def fetch(context, params):
            context.sources[params.source_id].update({'text': 'Five years.', 'fetched': True})
            return type('Result', (), {'data': {'text': 'Five years.'}})()
        with patch('agents.research.build_adapter', return_value=planner), patch(
            'agents.research.credentials_store.get_value', return_value='fake'), patch(
            'agents.research.websearch.search', side_effect=search), patch(
            'agents.research.fetch_page', side_effect=fetch
        ):
            result = await research_run(AgentTurnRequest(prompt='How long?', mode='research'),
                                        writer, 'fake', None, lambda event: None)
        self.assertEqual(result.status, 'partial')
        self.assertEqual(result.answer, 'The source says five years.')
        self.assertEqual(len(writer.messages), 5)

    async def test_attachment_only_research_cites_local_file(self):
        planner = FakeAdapter(json.dumps({'objective': 'find', 'queries': ['public query']}))
        writer = FakeAdapter('The answer is in the file [A1].')
        async def no_results(*args): return []
        request = AgentTurnRequest(prompt='Find project details', mode='research', attachments=[
            {'id':'a','name':'project.md','mime':'text/plain','content':'Project details and status.'}
        ])
        events = []
        with patch('agents.research.build_adapter', return_value=planner), patch(
            'agents.research.credentials_store.get_value', return_value='fake'), patch(
            'agents.research.websearch.search', side_effect=no_results
        ):
            result = await research_run(request, writer, 'fake', None, events.append)
        self.assertEqual(result.status, 'completed')
        self.assertEqual(result.attachment_sources[0]['source_id'], 'A1')
        self.assertIn('[A1]', result.answer)
        self.assertTrue(any(event['type'] == 'attachment.found' for event in events))

    async def test_cancel_stops_before_search(self):
        event = asyncio.Event()
        event.set()
        planner = FakeAdapter('hi')
        with self.assertRaises(asyncio.CancelledError):
            await research_run(AgentTurnRequest(prompt='question', mode='research'), planner,
                               'fake', None, lambda e: None, cancelled=event)
        self.assertEqual(planner.prompts, [])

    async def test_schema_rejects_duplicates_extra_fields_and_invalid_citations(self):
        with self.assertRaises(ValueError):
            ResearchPlan(objective='x', queries=['same', 'same'])
        with self.assertRaises(ValueError):
            ResearchSource(source_id='S1', title='x', url='https://example.org/',
                          host='example.org', snippet='x', query_id=1, fetched=True, text='raw')
        self.assertEqual(validate_citations('Claim [S9].', {'S1'}), ('Claim .', ['S9']))


if __name__ == '__main__':
    unittest.main()
