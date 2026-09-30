import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import Home from './Home'

afterEach(() => {
  vi.unstubAllGlobals()
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
})

it('keeps one intent across first-turn remount and later sends, but starts a new chat at Auto', async () => {
  Element.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal('api', {
    getBackendConnection: async () => ({ url: 'http://127.0.0.1:8000', token: 'fixture-token' }),
    getChats: async () => [],
    getProfile: async () => ({ name: '', avatarDataUrl: null }),
    setChats: async () => {}
  })
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
    const path = new URL(String(input)).pathname
    if (path.endsWith('/messages/stream')) return new Response('data: {"text":"Done"}\n\n')
    return new Response(JSON.stringify(path === '/settings/providers'
      ? { local: { configured: true, runtime: 'ollama' } }
      : path === '/settings/providers/local/models'
        ? { runtime: 'ollama', models: ['installed:7b'] }
        : path === '/sessions'
          ? { session_id: 'session-1', provider: 'local', thread_id: null }
          : null), { headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetch)
  render(<Home />)
  await screen.findByRole('button', { name: 'Model: installed:7b' })
  fireEvent.click(screen.getByRole('button', { name: 'Intent: Auto' }))
  fireEvent.click(screen.getByRole('button', { name: 'Coding' }))
  fireEvent.change(screen.getByPlaceholderText('Message Atlas...'), { target: { value: 'First' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
  await screen.findByRole('button', { name: 'Intent: Coding' })
  await waitFor(() => expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/messages/stream'))).toHaveLength(1))
  fireEvent.change(screen.getByPlaceholderText('Message Atlas...'), { target: { value: 'Second' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
  await waitFor(() => expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/messages/stream'))).toHaveLength(2))
  const streams = fetch.mock.calls.filter(([url]) => String(url).endsWith('/messages/stream'))
  expect(streams.map(([, init]) => JSON.parse(String(init?.body)).mode)).toEqual(['coding', 'coding'])
  fireEvent.click(screen.getAllByRole('button', { name: 'New Chat' })[0])
  expect(screen.getByRole('button', { name: 'Intent: Auto' })).toBeTruthy()
})

it('routes Auto locally before creating a session and records the decision', async () => {
  Element.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal('api', {
    getBackendConnection: async () => ({ url: 'http://127.0.0.1:8000', token: 'fixture-token' }),
    getChats: async () => [],
    getProfile: async () => ({ name: '', avatarDataUrl: null }),
    setChats: async () => {}
  })
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
    const path = new URL(String(input)).pathname
    const data = path === '/routing/turn'
      ? { state: 'ready', mode: 'coding', provider: 'local', model: 'installed:7b', reason: 'deterministic text classification' }
      : path === '/settings/providers'
        ? { local: { configured: true, runtime: 'ollama' } }
        : path === '/settings/providers/local/models'
          ? { runtime: 'ollama', models: ['installed:7b'] }
          : path === '/sessions'
            ? { session_id: 'session-1', provider: 'local', thread_id: null }
            : null
    if (path.endsWith('/messages/stream')) return new Response('data: {"text":"Done"}\n\n')
    return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetch)
  render(<Home />)
  await screen.findByRole('button', { name: 'Model: installed:7b' })
  fireEvent.change(screen.getByPlaceholderText('Message Atlas...'), { target: { value: 'Fix this function' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
  await waitFor(() => expect(fetch.mock.calls.some(([url]) => String(url).endsWith('/messages/stream'))).toBe(true))
  const session = fetch.mock.calls.find(([url]) => String(url).endsWith('/sessions'))
  expect(JSON.parse(String(session?.[1]?.body))).toMatchObject({ provider: 'local', model: 'installed:7b' })
  const routeIndex = fetch.mock.calls.findIndex(([url]) => String(url).endsWith('/routing/turn'))
  const sessionIndex = fetch.mock.calls.findIndex(([url]) => String(url).endsWith('/sessions'))
  expect(routeIndex).toBeLessThan(sessionIndex)
  expect(await screen.findByText(/deterministic text classification/)).toBeTruthy()
})

it('uses an explicitly selected cloud model in Auto without falling back to local', async () => {
  Element.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal('api', {
    getBackendConnection: async () => ({ url: 'http://127.0.0.1:8000', token: 'fixture-token' }),
    getChats: async () => [],
    getProfile: async () => ({ name: '', avatarDataUrl: null }),
    setChats: async () => {}
  })
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const path = new URL(String(input)).pathname
    if (path === '/routing/turn') {
      const preference = JSON.parse(String(init?.body)).preference
      return new Response(JSON.stringify(preference?.provider === 'openai'
        ? { state: 'ready', mode: 'coding', provider: 'openai', model: 'gpt-4o', reason: 'explicit cloud model' }
        : { state: 'no_eligible_model', mode: 'coding', provider: null, model: null, reason: 'No permitted text model' }))
    }
    if (path.endsWith('/messages/stream')) return new Response('data: {"text":"Done"}\n\n')
    return new Response(JSON.stringify(path === '/settings/providers'
      ? { openai: { configured: true }, local: { configured: true } }
      : path === '/settings/providers/local/models'
        ? { models: [] }
        : path === '/sessions'
          ? { session_id: 'cloud-session', provider: 'openai', thread_id: null }
          : null), { headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetch)
  render(<Home />)
  await screen.findByRole('button', { name: 'Model: OpenAI' })
  fireEvent.click(screen.getByRole('button', { name: 'Model: OpenAI' }))
  fireEvent.click(screen.getByRole('button', { name: 'OpenAI' }))
  fireEvent.change(screen.getByPlaceholderText('Message Atlas...'), { target: { value: 'Fix this function' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
  await waitFor(() => expect(fetch.mock.calls.some(([url]) => String(url).endsWith('/routing/turn'))).toBe(true))
  const route = fetch.mock.calls.find(([url]) => String(url).endsWith('/routing/turn'))
  expect(JSON.parse(String(route?.[1]?.body))).toMatchObject({ preference: { provider: 'openai', model: '' } })
  await waitFor(() => expect(fetch.mock.calls.some(([url]) => String(url).endsWith('/messages/stream'))).toBe(true))
  const session = fetch.mock.calls.find(([url]) => String(url).endsWith('/sessions'))
  const stream = fetch.mock.calls.find(([url]) => String(url).endsWith('/messages/stream'))
  expect(JSON.parse(String(session?.[1]?.body))).toMatchObject({ provider: 'openai', model: 'gpt-4o' })
  expect(JSON.parse(String(stream?.[1]?.body))).toMatchObject({ mode: 'coding' })
  await screen.findByText('Done')
  fireEvent.change(screen.getByPlaceholderText('Message Atlas...'), { target: { value: 'Fix this other function' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
  await waitFor(() => expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/messages/stream'))).toHaveLength(2))
  const routes = fetch.mock.calls.filter(([url]) => String(url).endsWith('/routing/turn'))
  expect(routes).toHaveLength(2)
  expect(JSON.parse(String(routes[1]?.[1]?.body))).toMatchObject({ preference: { provider: 'openai', model: '' } })
})

it('does not open a session when Auto has no permitted model', async () => {
  Element.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal('api', {
    getBackendConnection: async () => ({ url: 'http://127.0.0.1:8000', token: 'fixture-token' }),
    getChats: async () => [],
    getProfile: async () => ({ name: '', avatarDataUrl: null }),
    setChats: async () => {}
  })
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
    const path = new URL(String(input)).pathname
    const data = path === '/routing/turn'
      ? { state: 'no_eligible_model', mode: 'coding', provider: null, model: null, reason: 'No permitted text model' }
      : path === '/settings/providers'
        ? { local: { configured: true, runtime: 'ollama' } }
        : path === '/settings/providers/local/models'
          ? { runtime: 'ollama', models: ['installed:7b'] }
          : null
    return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetch)
  render(<Home />)
  await screen.findByRole('button', { name: 'Model: installed:7b' })
  fireEvent.change(screen.getByPlaceholderText('Message Atlas...'), { target: { value: 'Fix this function' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
  await screen.findByText(/No permitted text model/)
  expect(fetch.mock.calls.some(([url]) => String(url).endsWith('/sessions'))).toBe(false)
})

it('sends the chosen mode on the actual streamed turn request', async () => {
  Element.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal('api', {
    getBackendConnection: async () => ({ url: 'http://127.0.0.1:8000', token: 'fixture-token' }),
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
  fireEvent.click(screen.getByRole('button', { name: 'Intent: Auto' }))
  fireEvent.click(screen.getByRole('button', { name: 'Coding' }))
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
