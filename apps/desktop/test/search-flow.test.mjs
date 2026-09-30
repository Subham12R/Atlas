import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runSearchBeforeChat } from '../src/renderer/src/lib/search-flow.mjs'

test('search receives the same signal and returns results', async () => {
  const controller = new AbortController()
  const results = [{ title: 'A', url: 'https://example.org', content: 'text' }]
  const value = await runSearchBeforeChat({
    query: 'hello', maxResults: 5, signal: controller.signal,
    search: async (query, limit, signal) => {
      assert.equal(query, 'hello')
      assert.equal(limit, 5)
      assert.equal(signal, controller.signal)
      return { results }
    }
  })
  assert.deepEqual(value, results)
})

test('cancellation after search resolves prevents the next step', async () => {
  const controller = new AbortController()
  let nextStep = false
  await assert.rejects(async () => {
    await runSearchBeforeChat({
      query: 'hello', maxResults: 5, signal: controller.signal,
      search: async () => { controller.abort(); return { results: [] } }
    })
    nextStep = true
  }, { name: 'AbortError' })
  assert.equal(nextStep, false)
})
