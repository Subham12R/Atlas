import asyncio
import re
import unittest

from adapters.base import AdapterTurn
from agents.runner import run_selected
from tools.contracts import AgentTurnRequest


class FakeAdapter:
    name = 'fake'
    model = 'test'

    async def run_turn(self, messages, tools):
        self.messages = messages
        self.tools = tools
        return AdapterTurn(text='# Decision\n\nEvidence supports this choice.')


class DocumentDraftTests(unittest.IsolatedAsyncioTestCase):
    async def test_drafting_returns_artifact_without_file_side_effects(self):
        adapter = FakeAdapter()
        events = []
        await run_selected(AgentTurnRequest(prompt='Write a migration decision', mode='draft',
                                            draft_kind='decision_memo'),
                           adapter, 'fake', 'test', events.append, asyncio.Event())

        completed = next(event for event in events if event['type'] == 'run.completed')
        self.assertEqual(completed['draft']['kind'], 'decision_memo')
        self.assertRegex(completed['draft']['id'], re.compile(r'^[a-f0-9]{32}$'))
        self.assertEqual(completed['draft']['filename'], 'write-a-migration-decision.md')
        self.assertIn('decision memo structure', adapter.messages[0].content)
        self.assertEqual(adapter.tools, [])
        self.assertTrue(any(event['type'] == 'assistant.delta' for event in events))


if __name__ == '__main__':
    unittest.main()
