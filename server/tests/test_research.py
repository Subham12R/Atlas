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
        self.assertIn('# Research:', result.answer)
        self.assertIn('## Findings', result.answer)
        self.assertIn('## Method', result.answer)
        self.assertIn('## Sources', result.answer)
        self.assertIn('[S1]', result.answer)
        self.assertEqual([message.role for message in writer.messages], ['system', 'evidence', 'user'])
        self.assertNotIn('PRIVATE-DO-NOT-SEARCH', planner.prompts[0])
        self.assertNotIn('PRIVATE-DO-NOT-SEARCH', ' '.join(calls))
        self.assertTrue(any(e['type'] == 'source.found' for e in events))

    async def test_sparse_research_checks_evidence_and_runs_one_bounded_followup(self):
        class Planner(FakeAdapter):
            def __init__(self):
                super().__init__('')
                self.answers = [
                    {'objective': 'Study habitat', 'queries': ['habitat baseline']},
                    {'query': 'habitat conservation data', 'reason': 'baseline lacks conservation evidence'}
                ]
            async def send(self, prompt, images=None):
                self.prompts.append(prompt)
                return Reply(text=json.dumps(self.answers.pop(0)), provider='fake')
        planner = Planner()
        writer = FakeAdapter('Evidence from baseline [S1] and conservation [S2].')
        calls = []
        events = []
        async def search(key, query, limit):
            calls.append(query)
            return [{'title': query, 'url': f'https://fixture.example/{len(calls)}',
                     'content': f'public evidence {len(calls)}'}]
        async def fetch(context, params):
            context.sources[params.source_id]['text'] = 'public page'
            context.sources[params.source_id]['fetched'] = True
            return type('Result', (), {'data': {'text': 'public page'}})()
        request = AgentTurnRequest(prompt='Research habitat and conservation', mode='research',
            recent=[{'role': 'user', 'content': 'Private background: DO-NOT-SEARCH'}])
        with patch('agents.research.build_adapter', return_value=planner), patch(
            'agents.research.credentials_store.get_value', return_value='fake'), patch(
            'agents.research.websearch.search', side_effect=search), patch(
            'agents.research.fetch_page', side_effect=fetch):
            result = await research_run(request, writer, 'fake', None, events.append)
        self.assertEqual(calls, ['habitat baseline', 'habitat conservation data'])
        self.assertEqual(result.queries, calls)
        self.assertEqual(len(result.sources), 2)
        self.assertEqual(result.status, 'completed')
        self.assertNotIn('DO-NOT-SEARCH', planner.prompts[-1])
        self.assertNotIn('DO-NOT-SEARCH', ' '.join(calls))
        self.assertEqual([e['type'] for e in events].count('plan.ready'), 2)
        self.assertIn('writing answer', [e['phase'] for e in events if e['type'] == 'tool.progress'])

    async def test_gap_round_never_fetches_more_than_three_pages_even_after_failures(self):
        planner = FakeAdapter(json.dumps({'objective': 'check', 'queries': ['baseline']}))
        responses = iter([json.dumps({'objective': 'check', 'queries': ['baseline']}),
                          json.dumps({'query': 'follow-up', 'reason': 'thin evidence'})])
        async def send(prompt, images=None):
            planner.prompts.append(prompt)
            return Reply(text=next(responses), provider='fake')
        planner.send = send
        fetches = []
        async def search(key, query, limit):
            return [{'title': f'{query} {i}', 'url': f'https://fixture.example/{query}/{i}',
                     'content': 'public excerpt'} for i in range(1 if query == 'baseline' else 5)]
        async def fetch(context, params):
            fetches.append(params.source_id)
            raise RuntimeError('fixture page unavailable')
        with patch('agents.research.build_adapter', return_value=planner), patch(
            'agents.research.credentials_store.get_value', return_value='fake'), patch(
            'agents.research.websearch.search', side_effect=search), patch(
            'agents.research.fetch_page', side_effect=fetch):
            result = await research_run(AgentTurnRequest(prompt='check topic', mode='research'),
                FakeAdapter('Insufficient evidence [S1].'), 'fake', None, lambda e: None)
        self.assertLessEqual(len(fetches), 3)
        self.assertEqual(result.status, 'partial')

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

    async def test_invalid_local_plan_cannot_report_completed_research(self):
        planner = FakeAdapter('not JSON')
        writer = FakeAdapter('A finding [S1].')
        async def search(*args):
            return [{'title': 'Fixture', 'url': 'https://fixture.example/', 'content': 'A finding.'}]
        async def fetch(context, params):
            context.sources[params.source_id].update({'text': 'A finding.', 'fetched': True})
        events = []
        with patch('agents.research.build_adapter', return_value=planner), patch(
            'agents.research.credentials_store.get_value', return_value='fake'), patch(
            'agents.research.websearch.search', side_effect=search), patch(
            'agents.research.fetch_page', side_effect=fetch):
            result = await research_run(AgentTurnRequest(prompt='Find a finding', mode='research'),
                                        writer, 'local', None, events.append)
        self.assertEqual(result.status, 'partial')
        self.assertIn('planner', result.reason)
        self.assertIn('Partial evidence', result.answer)
        self.assertTrue(any(e['type'] == 'plan.degraded' for e in events))

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
        self.assertIn('The source says five years.', result.answer)
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

    async def test_explicit_free_search_research_needs_no_tavily_key(self):
        planner = FakeAdapter(json.dumps({'objective': 'find', 'queries': ['public guide']}))
        writer = FakeAdapter('Guide [S1].')
        async def search(*args):
            return [{'title': 'Guide', 'url': 'https://example.org/', 'content': 'Guide excerpt'},
                    {'title': 'Manual', 'url': 'https://example.org/manual', 'content': 'Manual excerpt'}]
        async def fetch(context, params):
            context.sources[params.source_id].update({'text': 'Guide excerpt', 'fetched': True})
        with patch.dict('os.environ', {'ATLAS_WEB_SEARCH_PROVIDER': 'free-search-mcp'}), patch(
            'agents.research.build_adapter', return_value=planner
        ), patch('agents.research.credentials_store.get_value', return_value=None), patch(
            'websearch.shutil.which', return_value='/fixture/search-mcp'), patch(
            'agents.research.websearch.search', side_effect=search
        ) as upstream, patch('agents.research.fetch_page', side_effect=fetch):
            result = await research_run(AgentTurnRequest(prompt='Find a public guide', mode='research'),
                                        writer, 'fake', None, lambda event: None)
        self.assertEqual(result.status, 'completed')
        self.assertIn('[S1]', result.answer)
        upstream.assert_awaited_once_with(None, 'public guide', 8)

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
        self.assertEqual(validate_citations('Claim [S1, S3, S9].', {'S1', 'S3'}),
                         ('Claim [S1] [S3] .', ['S9']))


if __name__ == '__main__':
    unittest.main()
