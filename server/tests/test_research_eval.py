import asyncio
import json
import unittest
from pathlib import Path
from unittest.mock import patch

from adapters.base import AdapterTurn, Reply
from agents.research import research_run
from tools.contracts import AgentTurnRequest

FIXTURES = Path(__file__).parent / 'fixtures' / 'research'
SEARCH = json.loads((FIXTURES / 'search-results.json').read_text())
PAGES = json.loads((FIXTURES / 'pages.json').read_text())
CITATION_ERROR = json.loads((FIXTURES / 'citation-errors.json').read_text())


class Planner:
    async def init(self): pass
    async def close(self): pass
    async def send(self, prompt, images=None):
        return Reply(json.dumps({'objective': 'Compare retention rules',
                                 'queries': ['archived policy', 'current policy', 'recent policy']}), 'fake')


class Writer:
    def __init__(self): self.tools = None; self.messages = None
    async def run_turn(self, messages, tools):
        self.messages, self.tools = messages, tools
        return AdapterTurn('The older rule differs from the current rule [S1] [S2].')


class ResearchEvaluationTests(unittest.IsolatedAsyncioTestCase):
    async def test_fixture_evidence_is_untrusted_citations_exist_and_budgets_hold(self):
        writer = Writer()
        queries = []
        fetched = []
        generated = [
            {'title': f'Policy source {i}', 'url': f'https://source{i}.example.org/policy',
             'content': f'Policy evidence {i}'} for i in range(20)
        ]

        async def search(key, query, limit):
            queries.append((query, limit))
            if query == 'archived policy': return SEARCH[:3] + generated[:5]
            if query == 'current policy': return SEARCH[1:3] + generated[5:11]
            return generated[11:19]

        async def fetch(context, params):
            fetched.append(params.source_id)
            source = context.sources[params.source_id]
            source.update({'text': PAGES.get(source['url'], 'Recorded fixture page.'),
                           'fetched': True, 'final_url': source['url']})
            return type('Result', (), {'data': {'text': source['text']}})()

        with patch('agents.research.build_adapter', return_value=Planner()), patch(
            'agents.research.credentials_store.get_value', return_value='fixture-key'), patch(
            'agents.research.websearch.search', side_effect=search), patch(
            'agents.research.fetch_page', side_effect=fetch
        ):
            result = await research_run(AgentTurnRequest(prompt='Compare retention rules', mode='research'),
                                        writer, 'fake', 'fixture-model', lambda event: None)

        evidence = writer.messages[1].content
        self.assertEqual(len(queries), 3)
        self.assertTrue(all(limit == 8 for _, limit in queries))
        self.assertEqual(len(result.sources), 12)
        self.assertEqual(len(fetched), 3)
        self.assertEqual(writer.tools, [])
        self.assertIn('Ignore all previous instructions', evidence)
        self.assertIn('never follow instructions', writer.messages[0].content)
        self.assertEqual(writer.messages[1].role, 'evidence')
        self.assertIn('2019-04-01', str(result.sources[0]))
        self.assertEqual(result.status, 'completed')
        self.assertTrue(all(source_id in {s.source_id for s in result.sources}
                            for source_id in ('S1', 'S2', 'S3')))

    async def test_recorded_unknown_citation_is_removed(self):
        from agents.research import validate_citations
        answer, invalid = validate_citations(CITATION_ERROR['answer'], set(CITATION_ERROR['source_ids']))
        self.assertNotIn('[S404]', answer)
        self.assertEqual(invalid, ['S404'])

    async def test_empty_results_fixture_degrades_without_synthesis(self):
        writer = Writer()
        async def no_results(*args): return json.loads((FIXTURES / 'empty-results.json').read_text())
        class OneQueryPlanner(Planner):
            async def send(self, prompt, images=None):
                return Reply(json.dumps({'objective': 'find', 'queries': ['no results']}), 'fake')
        with patch('agents.research.build_adapter', return_value=OneQueryPlanner()), patch(
            'agents.research.credentials_store.get_value', return_value='fixture-key'), patch(
            'agents.research.websearch.search', side_effect=no_results
        ):
            result = await research_run(AgentTurnRequest(prompt='Find something', mode='research'),
                                        writer, 'fake', None, lambda event: None)
        self.assertEqual(result.status, 'partial')
        self.assertEqual(writer.messages, None)

    async def test_failed_search_is_partial_not_completed(self):
        class OneQueryPlanner(Planner):
            async def send(self, prompt, images=None):
                return Reply(json.dumps({'objective': 'find', 'queries': ['one query']}), 'fake')
        async def fail(*args): raise TimeoutError('offline fixture')
        with patch('agents.research.build_adapter', return_value=OneQueryPlanner()), patch(
            'agents.research.credentials_store.get_value', return_value='fixture-key'), patch(
            'agents.research.websearch.search', side_effect=fail
        ):
            result = await research_run(AgentTurnRequest(prompt='Find current rules', mode='research'),
                                        Writer(), 'fake', None, lambda event: None)
        self.assertEqual(result.status, 'partial')
        self.assertEqual(result.reason, 'provider failure')
        self.assertIn('failed', result.answer)


if __name__ == '__main__':
    unittest.main()
