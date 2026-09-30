import { test } from 'node:test'
import assert from 'node:assert/strict'
import { modeForTool, decodeAgentEvent } from '../src/renderer/src/lib/agent-events.mjs'

test('every existing tool ID maps to its intended mode', () => {
  assert.equal(modeForTool('searchWeb'), 'search_web')
  assert.equal(modeForTool('deepResearch'), 'research')
  assert.equal(modeForTool('thinkLonger'), 'plan')
  assert.equal(modeForTool('writeCode'), 'write')
  assert.equal(modeForTool('draftDocument'), 'draft')
  assert.equal(modeForTool('safeTools'), 'tools')
  assert.equal(modeForTool(null), 'chat')
})

test('malformed and unknown events cannot masquerade as success', () => {
  assert.deepEqual(decodeAgentEvent('data: {"type":"run.failed","reason":"no key"}'),
                   { type: 'run.failed', reason: 'no key' })
  assert.equal(decodeAgentEvent('data: {not json}'), null)
  assert.equal(decodeAgentEvent('data: {"type":"unknown"}'), null)
})
