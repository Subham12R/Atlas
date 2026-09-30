import { afterEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { FreeSearchControl, LocalRuntimeControl } from './Profile'

const status = (
  state: 'ready' | 'unavailable' | 'starting',
  managed: boolean,
  message: string
): {
  runtimeId: 'ollama'
  state: 'ready' | 'unavailable' | 'starting'
  managed: boolean
  supported: boolean
  message: string
} => ({
  runtimeId: 'ollama' as const,
  state,
  managed,
  supported: true,
  message
})

afterEach(() => vi.unstubAllGlobals())

it('starts and stops only the Ollama process Atlas manages', async () => {
  const getLocalRuntimeStatus = vi
    .fn()
    .mockResolvedValue(status('unavailable', false, 'Ollama is not running.'))
  const startLocalRuntime = vi.fn().mockResolvedValue(status('ready', true, 'Ollama is running.'))
  const stopLocalRuntime = vi
    .fn()
    .mockResolvedValue(status('unavailable', false, 'Atlas stopped Ollama.'))
  vi.stubGlobal('api', { getLocalRuntimeStatus, startLocalRuntime, stopLocalRuntime })

  render(<LocalRuntimeControl />)
  fireEvent.click(await screen.findByRole('button', { name: 'Start Ollama' }))
  expect(await screen.findByText('Ollama is running.')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Stop Ollama' }))
  expect(await screen.findByText('Atlas stopped Ollama.')).toBeTruthy()
  expect(startLocalRuntime).toHaveBeenCalledWith('ollama')
  expect(stopLocalRuntime).toHaveBeenCalledWith('ollama')
})

it('allows stopping an Atlas-owned server that is still starting', async () => {
  const stopLocalRuntime = vi
    .fn()
    .mockResolvedValue(status('unavailable', false, 'Atlas stopped Ollama.'))
  vi.stubGlobal('api', {
    getLocalRuntimeStatus: vi
      .fn()
      .mockResolvedValue(status('starting', true, 'Ollama is starting.')),
    startLocalRuntime: vi.fn(),
    stopLocalRuntime
  })

  render(<LocalRuntimeControl />)
  fireEvent.click(await screen.findByRole('button', { name: 'Stop Ollama' }))
  expect(await screen.findByText('Atlas stopped Ollama.')).toBeTruthy()
  expect(stopLocalRuntime).toHaveBeenCalledWith('ollama')
})

it('does not offer to stop an Ollama server Atlas does not own', async () => {
  vi.stubGlobal('api', {
    getLocalRuntimeStatus: vi
      .fn()
      .mockResolvedValue(status('ready', false, 'Ollama is already running outside Atlas.')),
    startLocalRuntime: vi.fn(),
    stopLocalRuntime: vi.fn()
  })

  render(<LocalRuntimeControl />)
  expect(await screen.findByText('Ollama is already running outside Atlas.')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Stop Ollama' })).toBeNull()
  expect(
    screen.getByRole('button', { name: 'Ollama is already running' }).hasAttribute('disabled')
  ).toBe(true)
})


function searchApi(responses: Record<string, (init?: RequestInit) => Response>): ReturnType<typeof vi.fn> {
  vi.stubGlobal('api', { getBackendConnection: async () => ({ url: 'http://127.0.0.1:8000', token: 't' }) })
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method || 'GET'} ${new URL(String(input)).pathname}`
    return responses[key]?.(init) ?? new Response('{}', { status: 404 })
  })
  vi.stubGlobal('fetch', fetch)
  return fetch
}
const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

it('sets up free web search with one click and shows it connected', async () => {
  let installed = false
  const fetch = searchApi({
    'GET /settings/search': () => json({ configured: false, provider: installed ? 'free-search-mcp' : 'tavily',
      available: installed, free_search: { installed } }),
    'POST /settings/search/free-search/install': () => {
      installed = true
      return json({ installed: true, provider: 'free-search-mcp' })
    }
  })
  render(<FreeSearchControl tavilyConfigured={false} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Set up free search' }))
  expect(await screen.findByText('Connected')).toBeTruthy()
  expect(fetch.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
})

it('reports a failed setup instead of pretending it connected', async () => {
  searchApi({
    'GET /settings/search': () => json({ configured: false, provider: 'tavily', free_search: { installed: false } }),
    'POST /settings/search/free-search/install': () =>
      json({ detail: 'Free web search setup failed: uv failed: network unreachable' }, 502)
  })
  render(<FreeSearchControl tavilyConfigured={false} />)
  fireEvent.click(await screen.findByRole('button', { name: 'Set up free search' }))
  expect((await screen.findByRole('alert')).textContent).toContain('network unreachable')
  expect(screen.queryByText('Connected')).toBeNull()
})

it('switches back to a saved Tavily key', async () => {
  let provider = 'free-search-mcp'
  searchApi({
    'GET /settings/search': () => json({ configured: true, provider, free_search: { installed: true } }),
    'PUT /settings/search/provider': (init) => {
      provider = JSON.parse(String(init?.body)).provider
      return json({ provider })
    }
  })
  render(<FreeSearchControl tavilyConfigured />)
  fireEvent.click(await screen.findByRole('button', { name: 'Use Tavily' }))
  expect(await screen.findByRole('button', { name: 'Use free search' })).toBeTruthy()
})
