// Thin client for the Atlas FastAPI backend (server/api.py).
const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'

export interface ProviderInfo {
  provider: string
  anonymous: boolean
  models: string[]
}

export interface Reply {
  text: string
  provider: string
  meta: unknown
}

export interface SessionInfo {
  session_id: string
  provider: string
  thread_id: string | null
}

export interface ImagePayload {
  data: string // base64, no "data:" prefix
  mime: string
}

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** Thrown instead of ApiError when the request was deliberately aborted
 * (e.g. the user clicked Stop) -- callers should treat this as a silent,
 * expected outcome rather than a real failure. */
export class ApiAborted extends Error {}

/** Turns a request failure into a short, user-safe message. 5xx ApiErrors
 * wrap a raw upstream/provider exception string, which isn't fit to show
 * as-is -- those fall back to `fallback` instead. Everything else (4xx
 * ApiErrors are already written in plain English server-side) passes
 * through unchanged. */
export function friendlyErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    return err.status >= 500 ? fallback : err.message
  }
  return fallback
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers: { 'Content-Type': 'application/json', ...options.headers }
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new ApiAborted('request aborted')
    }
    throw new ApiError(0, 'Could not reach the Atlas server. Is it running?')
  }

  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = await res.json()
      if (body?.detail) {
        detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
      }
    } catch {
      // response had no JSON body
    }
    throw new ApiError(res.status, detail)
  }

  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export function getProviders(): Promise<ProviderInfo[]> {
  return request('/providers')
}

export function createSession(
  provider: string,
  anonymous = false,
  model: string | null = null
): Promise<SessionInfo> {
  return request('/sessions', {
    method: 'POST',
    body: JSON.stringify({ provider, anonymous, model })
  })
}

export function sendMessage(
  sessionId: string,
  prompt: string,
  images?: ImagePayload[],
  signal?: AbortSignal
): Promise<Reply> {
  return request(`/sessions/${sessionId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ prompt, images: images?.length ? images : undefined }),
    signal
  })
}

export async function sendMessageStream(
  sessionId: string,
  prompt: string,
  images: { data: string; mime: string }[] | undefined,
  onToken: (token: string) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(`${API_BASE}/sessions/${sessionId}/messages/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, images: images?.length ? images : undefined }),
    signal
  })

  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = await res.json()
      if (body?.detail) {
        detail = typeof body.detail === 'string' ? body.detail : JSON.stringify(body.detail)
      }
    } catch {
      // ignore
    }
    throw new ApiError(res.status, detail)
  }

  const reader = res.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data: ')) continue

        const dataStr = trimmed.slice(6)
        let parsed: { text?: string; error?: string }
        try {
          parsed = JSON.parse(dataStr)
        } catch (e) {
          console.error('Failed to parse stream event', e)
          continue
        }

        // A real server-side failure -- must propagate, not be swallowed
        // alongside JSON-parse errors, or the caller silently gets an empty
        // reply with no indication anything went wrong.
        if (parsed.error) {
          throw new ApiError(502, parsed.error)
        }
        if (parsed.text) {
          onToken(parsed.text)
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

export function resetSession(sessionId: string): Promise<{ ok: boolean }> {
  return request(`/sessions/${sessionId}/new_chat`, { method: 'POST' })
}

export function closeSession(sessionId: string): Promise<{ ok: boolean }> {
  return request(`/sessions/${sessionId}`, { method: 'DELETE' })
}

// ---- provider settings (API keys + local LLM connection) ------------------
export interface ProviderSettings {
  configured: boolean
  base_url?: string | null
  model?: string | null
}
export type ProviderSettingsMap = Record<string, ProviderSettings>

export function getProviderSettings(): Promise<ProviderSettingsMap> {
  return request('/settings/providers')
}

export function setProviderSettings(
  provider: string,
  body: { api_key?: string; base_url?: string; model?: string }
): Promise<{ ok: boolean }> {
  return request(`/settings/providers/${provider}`, {
    method: 'PUT',
    body: JSON.stringify(body)
  })
}

export function testProviderConnection(provider: string): Promise<{ ok: boolean; reply: string }> {
  return request(`/settings/providers/${provider}/test`, { method: 'POST' })
}

export function deleteProviderSettings(provider: string): Promise<{ ok: boolean }> {
  return request(`/settings/providers/${provider}`, { method: 'DELETE' })
}

// ---- account -----------------------------------------------------------
export function resetAccount(): Promise<{ ok: boolean }> {
  return request('/account/reset', { method: 'POST' })
}

// ---- image generation ---------------------------------------------------
export interface GeneratedImage {
  data?: string // base64, when the provider returns one inline
  mime?: string
  url?: string // when the provider returns a hosted URL instead
}

export function generateImage(
  provider: string,
  prompt: string,
  model?: string
): Promise<{ images: GeneratedImage[] }> {
  return request('/images/generate', {
    method: 'POST',
    body: JSON.stringify({ provider, prompt, model })
  })
}

// ---- web search (Tavily) -------------------------------------------------
export interface SearchResult {
  title: string
  url: string
  content: string
}

export function getSearchSettings(): Promise<{ configured: boolean }> {
  return request('/settings/search')
}

export function setSearchSettings(apiKey: string): Promise<{ ok: boolean }> {
  return request('/settings/search', {
    method: 'PUT',
    body: JSON.stringify({ api_key: apiKey })
  })
}

export function deleteSearchSettings(): Promise<{ ok: boolean }> {
  return request('/settings/search', { method: 'DELETE' })
}

export function webSearch(query: string, maxResults = 5): Promise<{ results: SearchResult[] }> {
  return request('/websearch', {
    method: 'POST',
    body: JSON.stringify({ query, max_results: maxResults })
  })
}

// ---- voice typing (Groq Whisper) ------------------------------------------
export function getVoiceSettings(): Promise<{ configured: boolean }> {
  return request('/settings/voice')
}

export function setVoiceSettings(apiKey: string): Promise<{ ok: boolean }> {
  return request('/settings/voice', {
    method: 'PUT',
    body: JSON.stringify({ api_key: apiKey })
  })
}

export function deleteVoiceSettings(): Promise<{ ok: boolean }> {
  return request('/settings/voice', { method: 'DELETE' })
}

export function transcribeAudio(data: string, mime: string): Promise<{ text: string }> {
  return request('/audio/transcribe', {
    method: 'POST',
    body: JSON.stringify({ data, mime })
  })
}
