import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import Home from './Home'

afterEach(() => {
  vi.unstubAllGlobals()
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
})

it('sends the chosen mode on the actual streamed turn request', async () => {
  Element.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal('api', {
    getChats: async () => [],
    getProfile: async () => ({ name: '', avatarDataUrl: null }),
    setChats: async () => {}
  })
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
    const path = new URL(String(input)).pathname
    const data =
      path === '/settings/providers'
        ? { local: { configured: true, runtime: 'ollama' } }
        : path === '/settings/providers/local/models'
          ? { runtime: 'ollama', models: [] }
          : path === '/sessions'
            ? { session_id: 'session-1', provider: 'local', thread_id: null }
            : null
    if (path.endsWith('/messages/stream')) return new Response('data: {"text":"Done"}\n\n')
    return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetch)
  render(<Home />)

  await waitFor(() => expect(screen.getByText('Local model')).toBeTruthy())
  fireEvent.change(screen.getByRole('combobox', { name: 'Execution mode' }), {
    target: { value: 'coding' }
  })
  fireEvent.change(screen.getByPlaceholderText('Message Atlas...'), {
    target: { value: 'Write a parser' }
  })
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

  await waitFor(() => {
    const stream = fetch.mock.calls.find(([url]) => String(url).endsWith('/messages/stream'))
    expect(stream).toBeDefined()
    expect(JSON.parse(String(stream?.[1]?.body))).toMatchObject({ mode: 'coding' })
  })
})
