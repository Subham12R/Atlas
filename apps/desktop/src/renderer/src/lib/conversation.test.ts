import { expect, it } from 'vitest'
import { MAX_HISTORY_CHARS, MAX_HISTORY_TURNS, conversationHistory, isContinuation, resolveSearchPrompt } from './conversation'

it('keeps the newest turns in order and skips errors and empty placeholders', () => {
  expect(conversationHistory([
    { sender: 'user', content: 'Our label is silverpine.' },
    { sender: 'assistant', content: 'Noted.' },
    { sender: 'user', content: 'Check again' },
    { sender: 'assistant', content: '**Error:** timed out' },
    { sender: 'assistant', content: '' }
  ])).toEqual([
    { role: 'user', content: 'Our label is silverpine.' },
    { role: 'assistant', content: 'Noted.' },
    { role: 'user', content: 'Check again' }
  ])
})

it('stays within the server bounds, dropping the oldest turns first', () => {
  const long = Array.from({ length: 40 }, (_, i) => ({
    sender: (i % 2 ? 'assistant' : 'user') as 'user' | 'assistant',
    content: `${i} ${'x'.repeat(5000)}`
  }))
  const turns = conversationHistory(long)
  expect(turns.length).toBeLessThanOrEqual(MAX_HISTORY_TURNS)
  expect(turns.reduce((n, t) => n + t.content.length, 0)).toBeLessThanOrEqual(MAX_HISTORY_CHARS)
  expect(turns.at(-1)?.content.startsWith('39 ')).toBe(true)
  expect(turns[0].content.endsWith('[truncated]')).toBe(true)
})

it('recognizes bare continuations but not real requests', () => {
  for (const text of ['continue', 'Continue.', 'try again', 'go on!', 'do', 'search again', 'yes']) {
    expect(isContinuation(text)).toBe(true)
  }
  for (const text of ['continue the essay about cats', 'who is subham karmakar', 'do my taxes']) {
    expect(isContinuation(text)).toBe(false)
  }
})

it('reuses the previous search question for a search-mode continuation, never private chat text', () => {
  const searched = [
    { sender: 'user' as const, content: 'who is subham12r', request: { tool: 'searchWeb' } },
    { sender: 'assistant' as const, content: '**Error:** Web search needs a key', tool: 'searchWeb' }
  ]
  expect(resolveSearchPrompt('continue', searched)).toBe('who is subham12r')
  expect(resolveSearchPrompt('who else?', searched)).toBe('who else?')
  const privateChat = [
    { sender: 'user' as const, content: 'my salary is 90k', request: { tool: null } },
    { sender: 'assistant' as const, content: 'Noted.' }
  ]
  expect(resolveSearchPrompt('search it', privateChat)).toBe('search it')
})
