import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import Home from './Home'

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
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
        : path === '/routing/turn'
          ? { state: 'ready', mode: 'coding', provider: 'local', model: 'installed:7b', reason: 'explicit mode' }
          : path === '/sessions'
            ? { session_id: 'session-1', provider: 'local', thread_id: null }
            : null), { headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetch)
  render(<Home />)
  await screen.findByRole('button', { name: 'Model: Auto' })
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

it('does not dispatch automatic image requests to a text-only provider', async () => {
  Element.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal('api', {
    getBackendConnection: async () => ({ url: 'http://127.0.0.1:8000', token: 'fixture-token' }),
    getChats: async () => [], getProfile: async () => ({ name: '', avatarDataUrl: null }), setChats: async () => {}
  })
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) => new Response(JSON.stringify(
    new URL(String(input)).pathname === '/settings/providers/local/models'
      ? { runtime: 'ollama', models: ['installed:7b'] }
      : { local: { configured: true, runtime: 'ollama' } }
  ), { headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', fetch)
  render(<Home />)
  await screen.findByRole('button', { name: 'Model: Auto' })
  fireEvent.change(screen.getByPlaceholderText('Message Atlas...'), { target: { value: 'Generate an image of a moon' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
  expect(await screen.findByText(/Image generation requires OpenAI or Gemini/)).toBeTruthy()
  expect(fetch.mock.calls.some(([url]) => String(url).endsWith('/images/generate'))).toBe(false)
})

it('restores the conversation and memory thread when a stored session has expired', async () => {
  Element.prototype.scrollIntoView = vi.fn()
  const thread = 'ab'.repeat(16)
  const stored = { id: 'old-chat', title: 'Previous session', isPinned: false, timestamp: '',
    provider: 'local', model: 'installed:7b', sessionId: 'stale', threadId: thread, messages: [
      { id: 'u1', sender: 'user', content: 'Our project label is silverpine.', timestamp: '' },
      { id: 'a1', sender: 'assistant', content: 'silverpine is the label.', timestamp: '' },
      { id: 'u2', sender: 'user', content: 'Check again', timestamp: '' },
      { id: 'e2', sender: 'assistant', content: '**Error:** The agent run timed out. Try again.', timestamp: '' }
    ] }
  vi.stubGlobal('api', {
    getBackendConnection: async () => ({ url: 'http://127.0.0.1:8000', token: 'fixture-token' }),
    getChats: async () => [stored], getProfile: async () => ({ name: '', avatarDataUrl: null }),
    setChats: async () => {}
  })
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
    const path = new URL(String(input)).pathname
    if (path === '/sessions/stale/messages/stream') return new Response(JSON.stringify({ detail: 'no such session' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
    if (path === '/sessions/new-session/messages/stream') return new Response('data: {"text":"silverpine"}\n\n')
    return new Response(JSON.stringify(path === '/settings/providers'
      ? { local: { configured: true, runtime: 'ollama' } }
      : path === '/settings/providers/local/models'
        ? { runtime: 'ollama', models: ['installed:7b'] }
        : path === '/routing/turn'
          ? { state: 'ready', mode: 'documentation', provider: 'local', model: 'installed:7b', reason: 'fixture' }
          : { session_id: 'new-session', provider: 'local', thread_id: thread }),
    { headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetch)
  render(<Home />)
  fireEvent.click(await screen.findByText('Previous session'))
  fireEvent.change(screen.getByPlaceholderText('Message Atlas...'), { target: { value: 'What label did we choose?' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
  await screen.findByText('silverpine')
  const session = fetch.mock.calls.find(([url]) => String(url).endsWith('/sessions'))
  expect(JSON.parse(String(session?.[1]?.body))).toMatchObject({ thread_id: thread })
  const replay = fetch.mock.calls.find(([url]) => String(url).endsWith('/sessions/new-session/messages/stream'))
  expect(JSON.parse(String(replay?.[1]?.body)).history).toEqual([
    { role: 'user', content: 'Our project label is silverpine.' },
    { role: 'assistant', content: 'silverpine is the label.' },
    { role: 'user', content: 'Check again' }
  ])
  await screen.findByRole('button', { name: 'Retry response' })
})

it('sends every earlier turn of the chat, including agent-mode replies, on each new turn', async () => {
  Element.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal('api', {
    getBackendConnection: async () => ({ url: 'http://127.0.0.1:8000', token: 'fixture-token' }),
    getChats: async () => [], getProfile: async () => ({ name: '', avatarDataUrl: null }),
    setChats: async () => {}
  })
  let turn = 0
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const path = new URL(String(input)).pathname
    if (path.endsWith('/agent/stream')) {
      return new Response('data: {"type":"assistant.delta","text":"The merger closed today."}\n\ndata: {"type":"run.completed","status":"completed"}\n\n')
    }
    if (path.endsWith('/messages/stream')) return new Response(`data: {"text":"reply ${++turn}"}\n\n`)
    const route = path === '/routing/turn' && JSON.parse(String(init?.body)).prompt.includes('latest')
    return new Response(JSON.stringify(path === '/settings/providers'
      ? { local: { configured: true, runtime: 'ollama' } }
      : path === '/settings/providers/local/models'
        ? { runtime: 'ollama', models: ['installed:7b'] }
        : path === '/routing/turn'
          ? { state: 'ready', mode: 'documentation', provider: 'local', model: 'installed:7b', reason: 'fixture',
              tool: route ? 'searchWeb' : null }
          : { session_id: 'session-1', provider: 'local', thread_id: 'cd'.repeat(16) }),
    { headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetch)
  render(<Home />)
  await screen.findByRole('button', { name: 'Model: Auto' })
  const send = async (text: string, reply: string): Promise<void> => {
    fireEvent.change(screen.getByPlaceholderText('Message Atlas...'), { target: { value: text } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
    await screen.findByText(reply)
    await screen.findByRole('button', { name: 'Retry response' })
  }
  await send('My client is Acme.', 'reply 1')
  await send('What is the latest on the merger?', 'The merger closed today.')
  await send('Summarize what we know about my client.', 'reply 2')
  const streams = fetch.mock.calls.filter(([url]) => String(url).endsWith('/messages/stream'))
  expect(JSON.parse(String(streams[0]?.[1]?.body)).history).toEqual([])
  expect(JSON.parse(String(streams[1]?.[1]?.body)).history).toEqual([
    { role: 'user', content: 'My client is Acme.' },
    { role: 'assistant', content: 'reply 1' },
    { role: 'user', content: 'What is the latest on the merger?' },
    { role: 'assistant', content: 'The merger closed today.' }
  ])
  const agent = fetch.mock.calls.find(([url]) => String(url).endsWith('/agent/stream'))
  expect(JSON.parse(String(agent?.[1]?.body)).recent).toEqual([
    { role: 'user', content: 'My client is Acme.' },
    { role: 'assistant', content: 'reply 1' }
  ])
  expect(fetch.mock.calls.filter(([url]) => String(url).endsWith('/sessions'))).toHaveLength(1)
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
  await screen.findByRole('button', { name: 'Model: Auto' })
  fireEvent.change(screen.getByPlaceholderText('Message Atlas...'), { target: { value: 'Fix this function' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
  await waitFor(() => expect(fetch.mock.calls.some(([url]) => String(url).endsWith('/messages/stream'))).toBe(true))
  const session = fetch.mock.calls.find(([url]) => String(url).endsWith('/sessions'))
  expect(JSON.parse(String(session?.[1]?.body))).toMatchObject({ provider: 'local', model: 'installed:7b' })
  const routeIndex = fetch.mock.calls.findIndex(([url]) => String(url).endsWith('/routing/turn'))
  const sessionIndex = fetch.mock.calls.findIndex(([url]) => String(url).endsWith('/sessions'))
  expect(routeIndex).toBeLessThan(sessionIndex)
  expect(JSON.parse(String(fetch.mock.calls[routeIndex]?.[1]?.body))).toMatchObject({
    allow_cloud: false, reasoning: 'medium', agent_mode: 'chat'
  })
  expect(JSON.parse(String(fetch.mock.calls[routeIndex]?.[1]?.body)).preference).toBeUndefined()
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
  fireEvent.click(await screen.findByRole('button', { name: 'Model: Auto' }))
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
  await screen.findByRole('button', { name: 'Model: Auto' })
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
          : path === '/routing/turn'
            ? { state: 'ready', mode: 'coding', provider: 'local', model: 'llama3.2', reason: 'explicit mode' }
            : path === '/sessions'
              ? { session_id: 'session-1', provider: 'local', thread_id: null }
              : null
    if (path.endsWith('/messages/stream')) return new Response('data: {"text":"Done"}\n\n')
    return new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetch)
  render(<Home />)

  await screen.findByRole('button', { name: 'Model: Auto' })
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

it('restores the original reply when an in-place retry fails', async () => {
  Element.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal('api', {
    getBackendConnection: async () => ({ url: 'http://127.0.0.1:8000', token: 'fixture-token' }),
    getChats: async () => [{
      id: 'c1', title: 'Retry chat', isPinned: false, timestamp: '', provider: 'local', model: 'installed:7b',
      sessionId: 'session-1', threadId: null,
      messages: [
        { id: 'u1', sender: 'user', timestamp: '', content: 'Question',
          request: { tool: null, mode: 'coding', draftKind: 'research_brief', provider: 'local', model: 'installed:7b', reasoning: 'high', allowCloud: false } },
        { id: 'a1', sender: 'assistant', timestamp: '', content: 'Original answer' }
      ]
    }],
    getProfile: async () => ({ name: '', avatarDataUrl: null }),
    setChats: async () => {}
  })
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
    const path = new URL(String(input)).pathname
    if (path.endsWith('/messages/stream')) return new Response('boom', { status: 500 })
    return new Response(JSON.stringify(path === '/settings/providers'
      ? { local: { configured: true, runtime: 'ollama' } }
      : path === '/settings/providers/local/models'
        ? { runtime: 'ollama', models: ['installed:7b'] }
        : null), { headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetch)
  render(<Home />)
  fireEvent.click(await screen.findByText('Retry chat'))
  await screen.findByRole('button', { name: 'Model: installed:7b' })
  fireEvent.click(await screen.findByRole('button', { name: 'Retry response' }))
  await screen.findByText(/Retry failed, showing the original reply/)
  expect(screen.getByText('Original answer')).toBeTruthy()
  const stream = fetch.mock.calls.find(([url]) => String(url).endsWith('/messages/stream'))
  expect(JSON.parse(String(stream?.[1]?.body))).toMatchObject({ mode: 'coding', reasoning: 'high' })
  expect(screen.getAllByText('Question')).toHaveLength(1)
})

it('follows an Auto tool call and sends the routed reasoning level', async () => {
  Element.prototype.scrollIntoView = vi.fn()
  localStorage.setItem('atlas.reasoning', 'max')
  vi.stubGlobal('api', {
    getBackendConnection: async () => ({ url: 'http://127.0.0.1:8000', token: 'fixture-token' }),
    getChats: async () => [],
    getProfile: async () => ({ name: '', avatarDataUrl: null }),
    setChats: async () => {}
  })
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
    const path = new URL(String(input)).pathname
    if (path.endsWith('/agent/stream')) {
      return new Response('data: {"type":"assistant.delta","text":"Fresh"}\n\ndata: {"type":"run.completed","status":"completed"}\n\n')
    }
    return new Response(JSON.stringify(path === '/settings/providers'
      ? { local: { configured: true, runtime: 'ollama' } }
      : path === '/settings/providers/local/models'
        ? { runtime: 'ollama', models: ['installed:7b'] }
        : path === '/routing/turn'
          ? { state: 'ready', mode: 'documentation', provider: 'local', model: 'installed:7b',
              reason: 'needs current web info', tool: 'searchWeb', reasoning: 'low' }
          : path === '/sessions'
            ? { session_id: 'session-1', provider: 'local', thread_id: null }
            : null), { headers: { 'Content-Type': 'application/json' } })
  })
  vi.stubGlobal('fetch', fetch)
  render(<Home />)
  await screen.findByRole('button', { name: 'Model: Auto' })
  fireEvent.change(screen.getByPlaceholderText('Message Atlas...'), { target: { value: 'Latest news on the merger' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
  await screen.findByText('Fresh')
  expect(screen.getByText(/Auto route: documentation · installed:7b · low reasoning · web search · needs current web info/)).toBeTruthy()
  const route = fetch.mock.calls.find(([url]) => String(url).endsWith('/routing/turn'))
  expect(JSON.parse(String(route?.[1]?.body))).toMatchObject({ reasoning: 'max' })
  const agent = fetch.mock.calls.find(([url]) => String(url).endsWith('/agent/stream'))
  expect(JSON.parse(String(agent?.[1]?.body))).toMatchObject({ mode: 'search_web', reasoning: 'low' })
  expect(fetch.mock.calls.some(([url]) => String(url).endsWith('/messages/stream'))).toBe(false)
  // Settled (Retry only shows once sending ends), so no effect fires after teardown.
  await screen.findByRole('button', { name: 'Retry response' })
})
