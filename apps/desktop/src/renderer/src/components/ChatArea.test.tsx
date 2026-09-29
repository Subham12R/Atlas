import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import ChatArea from './ChatArea'

afterEach(() => vi.unstubAllGlobals())

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
  fireEvent.change(screen.getByRole('combobox', { name: 'Execution mode' }), {
    target: { value: 'research' }
  })
  fireEvent.change(screen.getByPlaceholderText('Message Atlas...'), {
    target: { value: 'Find the facts' }
  })
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

  expect(onSendMessage).toHaveBeenCalledWith('Find the facts', null, 'local', null, [], 'research')
})
