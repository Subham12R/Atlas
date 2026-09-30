import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import ChatArea, { type Chat } from './ChatArea'

afterEach(() => {
  vi.unstubAllGlobals()
  localStorage.clear()
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
})

it('shows a degraded state when the local API is unavailable', async () => {
  vi.stubGlobal('api', {
    getBackendConnection: async () => {
      throw new Error('unconfigured')
    }
  })
  render(
    <ChatArea
      isSidebarCollapsed={false}
      setIsSidebarCollapsed={vi.fn()}
      activeChat={null}
      onSendMessage={vi.fn()}
      onNewChat={vi.fn()}
      onTogglePin={vi.fn()}
      onMessageRevealed={vi.fn()}
      onStopSending={vi.fn()}
    />
  )
  expect((await screen.findByRole('alert')).textContent).toContain('authentication is unavailable')
})

it('passes the selected mode and existing prompt fields to its parent', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof globalThis.fetch>(
      async (input) =>
        new Response(
          JSON.stringify(
            String(input).endsWith('/settings/providers/local/models')
              ? { runtime: 'ollama', models: [] }
              : { local: { configured: true, runtime: 'ollama' } }
          ),
          { headers: { 'Content-Type': 'application/json' } }
        )
    )
  )
  vi.stubGlobal('api', { getBackendConnection: async () => ({ url: 'http://127.0.0.1:8000', token: 'fixture-token' }) })
  const onSendMessage = vi.fn()
  render(
    <ChatArea
      isSidebarCollapsed={false}
      setIsSidebarCollapsed={vi.fn()}
      activeChat={null}
      onSendMessage={onSendMessage}
      onNewChat={vi.fn()}
      onTogglePin={vi.fn()}
      onMessageRevealed={vi.fn()}
      onStopSending={vi.fn()}
    />
  )

  await screen.findByRole('button', { name: 'Model: Auto' })
  fireEvent.click(screen.getByRole('button', { name: 'Intent: Auto' }))
  fireEvent.click(screen.getByRole('button', { name: 'Research' }))
  fireEvent.change(screen.getByPlaceholderText('Message Atlas...'), {
    target: { value: 'Find the facts' }
  })
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

  expect(onSendMessage).toHaveBeenCalledWith(
    'Find the facts', 'deepResearch', 'auto', null, [], 'auto', 'research_brief',
    { reasoning: 'medium', allowCloud: false, imageProvider: undefined }
  )
  fireEvent.click(screen.getByRole('button', { name: 'Intent: Research' }))
  fireEvent.click(screen.getByRole('button', { name: 'Web search' }))
  fireEvent.change(screen.getByPlaceholderText('Message Atlas...'), {
    target: { value: 'Quick lookup' }
  })
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
  expect(onSendMessage).toHaveBeenLastCalledWith(
    'Quick lookup', 'searchWeb', 'auto', null, [], 'auto', 'research_brief',
    { reasoning: 'medium', allowCloud: false, imageProvider: undefined }
  )
})

it('filters connected models from the composer and sends the selected local model without logos', async () => {
  vi.stubGlobal('api', { getBackendConnection: async () => ({ url: 'http://127.0.0.1:8000', token: 'fixture-token' }) })
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof globalThis.fetch>(
      async (input) =>
        new Response(
          JSON.stringify(
            String(input).endsWith('/settings/providers/local/models')
              ? { runtime: 'ollama', models: ['gemma4:12b', 'qwen2.5:7b'] }
              : { local: { configured: true, runtime: 'ollama' } }
          ),
          { headers: { 'Content-Type': 'application/json' } }
        )
    )
  )
  const onSendMessage = vi.fn()
  const { container } = render(
    <ChatArea
      isSidebarCollapsed={false}
      setIsSidebarCollapsed={vi.fn()}
      activeChat={null}
      onSendMessage={onSendMessage}
      onNewChat={vi.fn()}
      onTogglePin={vi.fn()}
      onMessageRevealed={vi.fn()}
      onStopSending={vi.fn()}
    />
  )

  const model = await screen.findByRole('button', { name: 'Model: Auto' })
  expect(screen.getByPlaceholderText('Message Atlas...').parentElement?.contains(model)).toBe(true)
  expect(model.closest('header')).toBeNull()
  fireEvent.click(model)
  fireEvent.click(screen.getByRole('switch', { name: 'Allow cloud models in Auto' }))
  fireEvent.change(screen.getByRole('slider', { name: /Reasoning/ }), { target: { value: '4' } })
  expect(localStorage.getItem('atlas.reasoning')).toBe('max')
  fireEvent.change(screen.getByRole('searchbox', { name: 'Filter models' }), {
    target: { value: 'qwen' }
  })
  expect(screen.queryByRole('button', { name: 'gemma4:12b' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'qwen2.5:7b' }))
  expect(screen.getByRole('button', { name: 'Model: qwen2.5:7b' })).toBeTruthy()
  expect(screen.queryByRole('searchbox', { name: 'Filter models' })).toBeNull()
  expect(container.querySelector('img[src*="logos/"]')).toBeNull()

  fireEvent.change(screen.getByPlaceholderText('Message Atlas...'), { target: { value: 'Hello' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
  expect(onSendMessage).toHaveBeenCalledWith(
    'Hello', null, 'local', 'qwen2.5:7b', [], 'auto', 'research_brief',
    { reasoning: 'max', allowCloud: true, imageProvider: undefined }
  )
})

it('uses a neutral assistant glyph instead of a model brand in replies', async () => {
  Element.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal('api', { getBackendConnection: async () => ({ url: 'http://127.0.0.1:8000', token: 'fixture-token' }) })
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof globalThis.fetch>(
      async (input) =>
        new Response(
          JSON.stringify(
            String(input).endsWith('/settings/providers/local/models')
              ? { runtime: 'ollama', models: ['gemma4:12b'] }
              : { local: { configured: true, runtime: 'ollama' } }
          ),
          { headers: { 'Content-Type': 'application/json' } }
        )
    )
  )
  const chat: Chat = {
    id: 'thread-1',
    title: 'Test',
    isPinned: false,
    timestamp: '',
    provider: 'local',
    model: 'gemma4:12b',
    sessionId: null,
    threadId: null,
    messages: [
      {
        id: 'reply-1',
        sender: 'assistant',
        content: 'Ready',
        timestamp: '',
        provider: 'local',
        model: 'gemma4:12b'
      }
    ]
  }
  const { container } = render(
    <ChatArea
      isSidebarCollapsed={false}
      setIsSidebarCollapsed={vi.fn()}
      activeChat={chat}
      onSendMessage={vi.fn()}
      onNewChat={vi.fn()}
      onTogglePin={vi.fn()}
      onMessageRevealed={vi.fn()}
      onStopSending={vi.fn()}
    />
  )
  expect(await screen.findByRole('button', { name: 'Model: gemma4:12b' })).toBeTruthy()
  expect(screen.getByText('Ready')).toBeTruthy()
  expect(container.querySelector('img[src*="logos/"]')).toBeNull()
})

it('keeps an unconfigured prompt until a model is connected', async () => {
  vi.stubGlobal('api', { getBackendConnection: async () => ({ url: 'http://127.0.0.1:8000', token: 'fixture-token' }) })
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof globalThis.fetch>(
      async (input) =>
        new Response(
          JSON.stringify(
            String(input).endsWith('/settings/providers/local/models')
              ? { runtime: 'ollama', models: [] }
              : {}
          ),
          { headers: { 'Content-Type': 'application/json' } }
        )
    )
  )
  const onSendMessage = vi.fn()
  render(
    <ChatArea
      isSidebarCollapsed={false}
      setIsSidebarCollapsed={vi.fn()}
      activeChat={null}
      onSendMessage={onSendMessage}
      onNewChat={vi.fn()}
      onTogglePin={vi.fn()}
      onMessageRevealed={vi.fn()}
      onStopSending={vi.fn()}
    />
  )
  fireEvent.change(screen.getByPlaceholderText('Message Atlas...'), {
    target: { value: 'Save this prompt' }
  })
  fireEvent.click(screen.getByRole('button', { name: 'Model: Choose model' }))
  expect(await screen.findByText(/No providers connected/)).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Send message' }).hasAttribute('disabled')).toBe(true)
  fireEvent.keyDown(screen.getByPlaceholderText('Message Atlas...'), { key: 'Enter' })
  expect(onSendMessage).not.toHaveBeenCalled()
  expect(screen.getByPlaceholderText('Message Atlas...')).toHaveProperty(
    'value',
    'Save this prompt'
  )
})

it('shows the loading state only while a reply is pending', async () => {
  Element.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal('api', { getBackendConnection: async () => ({ url: 'http://127.0.0.1:8000', token: 'fixture-token' }) })
  vi.stubGlobal(
    'fetch',
    vi.fn<typeof globalThis.fetch>(
      async (input) =>
        new Response(
          JSON.stringify(
            String(input).endsWith('/settings/providers/local/models')
              ? { runtime: 'ollama', models: [] }
              : { local: { configured: true, runtime: 'ollama' } }
          ),
          { headers: { 'Content-Type': 'application/json' } }
        )
    )
  )
  const chat: Chat = {
    id: 'thread-1',
    title: 'Test',
    isPinned: false,
    timestamp: '',
    provider: 'local',
    sessionId: null,
    threadId: null,
    isSending: true,
    messages: [{ id: 'question', sender: 'user', content: 'Hello', timestamp: '' }]
  }
  const props = {
    isSidebarCollapsed: false,
    setIsSidebarCollapsed: vi.fn(),
    onSendMessage: vi.fn(),
    onNewChat: vi.fn(),
    onTogglePin: vi.fn(),
    onMessageRevealed: vi.fn(),
    onStopSending: vi.fn()
  }
  const { rerender } = render(<ChatArea {...props} activeChat={chat} />)
  expect(await screen.findByRole('status', { name: 'Thinking' })).toBeTruthy()
  rerender(<ChatArea {...props} activeChat={{ ...chat, isSending: false }} />)
  expect(screen.queryByRole('status', { name: 'Thinking' })).toBeNull()
})

it('renders level-three and level-four headings without interpreting fenced code', async () => {
  Element.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal('api', { getBackendConnection: async () => ({ url: 'http://127.0.0.1:8000', token: 'fixture-token' }) })
  vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>(async (input) =>
    new Response(JSON.stringify(String(input).endsWith('/settings/providers/local/models')
      ? { runtime: 'ollama', models: [] }
      : { local: { configured: true, runtime: 'ollama' } }),
      { headers: { 'Content-Type': 'application/json' } })))
  const chat: Chat = {
    id: 'markdown', title: 'Test', isPinned: false, timestamp: '', provider: 'local',
    sessionId: null, threadId: null,
    messages: [{ id: 'answer', sender: 'assistant', timestamp: '',
      content: '### Context\n#### 3.3 Dynamic tool calling\n```md\n#### literal code\n```' }]
  }
  render(<ChatArea isSidebarCollapsed={false} setIsSidebarCollapsed={vi.fn()}
    activeChat={chat} onSendMessage={vi.fn()} onNewChat={vi.fn()}
    onTogglePin={vi.fn()} onMessageRevealed={vi.fn()} onStopSending={vi.fn()} />)
  expect(screen.getByRole('heading', { level: 3, name: 'Context' })).toBeTruthy()
  expect(screen.getByRole('heading', { level: 4, name: '3.3 Dynamic tool calling' })).toBeTruthy()
  expect(screen.queryByRole('heading', { name: 'literal code' })).toBeNull()
})

it('links each issued source in a grouped citation and shows its source card', () => {
  Element.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal('api', { getBackendConnection: async () => ({ url: 'http://127.0.0.1:8000', token: 'fixture-token' }) })
  vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>(async () =>
    new Response(JSON.stringify({ local: { configured: true } }), { headers: { 'Content-Type': 'application/json' } })))
  const chat: Chat = {
    id: 'sources', title: 'Sources', isPinned: false, timestamp: '', provider: 'local',
    sessionId: null, threadId: null,
    messages: [{ id: 'answer', sender: 'assistant', timestamp: '', content: 'A fact [S1, S3] and unknown [S9] [S2].',
      sources: [
        { source_id: 'S1', title: 'First source', url: 'https://example.org/1' },
        { source_id: 'S3', title: 'Third source', url: 'https://example.org/3' },
        { source_id: 'S2', title: 'Unsafe link', url: 'javascript:alert(1)' }
      ] }]
  }
  render(<ChatArea isSidebarCollapsed={false} setIsSidebarCollapsed={vi.fn()}
    activeChat={chat} onSendMessage={vi.fn()} onNewChat={vi.fn()}
    onTogglePin={vi.fn()} onMessageRevealed={vi.fn()} onStopSending={vi.fn()} />)
  expect(screen.getByRole('link', { name: '[S1]' }).getAttribute('href')).toBe('https://example.org/1')
  expect(screen.getByRole('link', { name: '[S3]' }).getAttribute('href')).toBe('https://example.org/3')
  expect(screen.queryByRole('link', { name: '[S9]' })).toBeNull()
  expect(screen.queryByRole('link', { name: /Unsafe link/ })).toBeNull()
  expect(screen.getByText(/Used 2 sources/)).toBeTruthy()
})

it('approves only checked plan steps, retries in place, and shows saved trace chips', async () => {
  Element.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal('api', { getBackendConnection: async () => ({ url: 'http://127.0.0.1:8000', token: 'fixture-token' }) })
  vi.stubGlobal('fetch', vi.fn<typeof globalThis.fetch>(async (input) =>
    new Response(JSON.stringify(String(input).endsWith('/settings/providers/local/models')
      ? { runtime: 'ollama', models: [] } : { local: { configured: true } }),
    { headers: { 'Content-Type': 'application/json' } })))
  const onSendMessage = vi.fn()
  const onComposerChange = vi.fn()
  const onRetryMessage = vi.fn()
  const onPlanStatus = vi.fn()
  const chat: Chat = {
    id: 'plan', title: 'Plan', isPinned: false, timestamp: '', provider: 'local',
    sessionId: null, threadId: null,
    messages: [
      { id: 'q', sender: 'user', timestamp: '', content: 'Plan the migration' },
      { id: 'p', sender: 'assistant', timestamp: '', content: '1. Back up\n2. Migrate\n3. Verify', tool: 'thinkLonger',
        trace: [{ label: 'web search: migration', tool: 'web_search', status: 'done' }],
        memory: { summary: false, hits: [{ text: 'Earlier note', thread_id: 'old', distance: 0.2 }], facts: [] } }
    ]
  }
  const open = vi.fn()
  render(<ChatArea isSidebarCollapsed={false} setIsSidebarCollapsed={vi.fn()}
    activeChat={chat} onSendMessage={onSendMessage} onNewChat={vi.fn()} onComposerChange={onComposerChange}
    onRetryMessage={onRetryMessage} onPlanStatus={onPlanStatus} openThread={(id) => (id === 'old' ? open : undefined)}
    onTogglePin={vi.fn()} onMessageRevealed={vi.fn()} onStopSending={vi.fn()} />)
  expect(screen.getByRole('list', { name: 'Run steps' }).textContent).toContain('web search: migration')
  fireEvent.click(screen.getByRole('button', { name: /Past conversation/ }))
  expect(open).toHaveBeenCalled()

  await waitFor(() => expect(screen.getByRole('button', { name: /Local model/ })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'Retry response' }))
  expect(onRetryMessage).toHaveBeenCalledWith('p')

  fireEvent.click(screen.getByRole('checkbox', { name: '2. Migrate' }))
  fireEvent.click(screen.getByRole('button', { name: 'Approve & run' }))
  expect(onPlanStatus).toHaveBeenCalledWith('p', 'approved')
  expect(onComposerChange).toHaveBeenCalledWith({ intent: 'auto' })
  const [text, tool, , , attachments] = onSendMessage.mock.lastCall!
  expect([text, tool]).toEqual(['Approved steps 1, 3. Carry out only these, step by step.', null])
  expect(attachments).toEqual([expect.objectContaining({ name: 'approved-plan.md', content: '1. Back up\n3. Verify' })])
})
