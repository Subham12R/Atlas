import { afterEach, expect, it, vi } from 'vitest'
import { sendMessage, sendMessageStream } from './api'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

it('sends the app-held token on both plain and streamed requests', async () => {
  vi.stubGlobal('api', { getBackendToken: async () => 'fixture-token' })
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () => new Response('{"text":"ok","provider":"local","meta":null}')
  )
  vi.stubGlobal('fetch', fetch)

  await sendMessage('session-1', 'hello')
  await sendMessageStream('session-1', 'hello', undefined, vi.fn())

  for (const [, init] of fetch.mock.calls) {
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer fixture-token' })
  }
})

it('never sends the local bearer token to a non-loopback backend', async () => {
  vi.stubEnv('VITE_API_BASE_URL', 'https://untrusted.example')
  vi.resetModules()
  const { sendMessage: sendWithOverride } = await import('./api')
  vi.stubGlobal('api', { getBackendToken: async () => 'fixture-token' })
  const fetch = vi.fn()
  vi.stubGlobal('fetch', fetch)

  await expect(sendWithOverride('session-1', 'private')).rejects.toMatchObject({ status: 403 })
  expect(fetch).not.toHaveBeenCalled()
})

it('sends the selected mode with streamed prompt and images', async () => {
  vi.stubGlobal('api', { getBackendToken: async () => 'fixture-token' })
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () => new Response('data: {"text":"hello"}\n\n')
  )
  vi.stubGlobal('fetch', fetch)
  const onToken = vi.fn()

  await sendMessageStream(
    'session-1',
    'describe',
    [{ data: 'YWJj', mime: 'image/png' }],
    onToken,
    undefined,
    undefined,
    'research'
  )

  expect(onToken).toHaveBeenCalledWith('hello')
  expect(fetch).toHaveBeenCalledOnce()
  expect(fetch.mock.calls[0][0]).toBe('http://127.0.0.1:8000/sessions/session-1/messages/stream')
  expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({
    prompt: 'describe',
    images: [{ data: 'YWJj', mime: 'image/png' }],
    mode: 'research'
  })
})

it('defaults plain-message requests to Auto without adding images', async () => {
  vi.stubGlobal('api', { getBackendToken: async () => 'fixture-token' })
  const fetch = vi.fn<typeof globalThis.fetch>(
    async () =>
      new Response(JSON.stringify({ text: 'ok', provider: 'local', meta: null }), {
        headers: { 'Content-Type': 'application/json' }
      })
  )
  vi.stubGlobal('fetch', fetch)

  await sendMessage('session-1', 'hello')

  expect(JSON.parse(String(fetch.mock.calls[0][1]?.body))).toEqual({
    prompt: 'hello',
    mode: 'auto'
  })
})
