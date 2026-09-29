import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import ChatArea, { type Chat } from './ChatArea'

afterEach(() => {
  vi.unstubAllGlobals()
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView')
})

it('shows a degraded state when local API authentication is unavailable', async () => {
  vi.stubGlobal('api', {
    getBackendToken: async () => {
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
  expect(await screen.findByRole('alert')).toHaveProperty(
    'textContent',
    expect.stringContaining('authentication unavailable')
  )
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
  vi.stubGlobal('api', { getBackendToken: async () => 'fixture-token' })
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

  await waitFor(() => expect(screen.getByText('Local model')).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'Execution mode: Auto' }))
  fireEvent.click(screen.getByRole('button', { name: 'Research' }))
  fireEvent.change(screen.getByPlaceholderText('Message Atlas...'), {
    target: { value: 'Find the facts' }
  })
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

  expect(onSendMessage).toHaveBeenCalledWith('Find the facts', null, 'local', null, [], 'research')
})

it('filters connected models from the composer and sends the selected local model without logos', async () => {
  vi.stubGlobal('api', { getBackendToken: async () => 'fixture-token' })
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

  const model = await screen.findByRole('button', { name: 'Model: gemma4:12b' })
  expect(screen.getByPlaceholderText('Message Atlas...').parentElement?.contains(model)).toBe(true)
  expect(model.closest('header')).toBeNull()
  fireEvent.click(model)
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
  expect(onSendMessage).toHaveBeenCalledWith('Hello', null, 'local', 'qwen2.5:7b', [], 'auto')
})

it('uses a neutral assistant glyph instead of a model brand in replies', async () => {
  Element.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal('api', { getBackendToken: async () => 'fixture-token' })
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
  vi.stubGlobal('api', { getBackendToken: async () => 'fixture-token' })
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
