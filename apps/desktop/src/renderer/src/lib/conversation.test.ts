import { expect, it } from 'vitest'
import { MAX_HISTORY_CHARS, MAX_HISTORY_TURNS, conversationHistory } from './conversation'

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
