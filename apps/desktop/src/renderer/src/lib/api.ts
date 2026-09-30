// Thin client for the Atlas FastAPI backend (server/api.py).
import { decodeAgentEvent, type AgentEvent } from './agent-events.mjs'
import type { ExecutionMode } from './modes'

const DEVELOPMENT_API_BASE = import.meta.env.DEV
  ? import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8000'
  : undefined

export interface ProviderInfo {
  provider: string
  anonymous: boolean
  models: string[]
  capabilities?: { tool_calls: boolean; streamed_arguments: boolean; tool_models: string[] }
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

export type ReasoningLevel = 'off' | 'low' | 'medium' | 'high' | 'max'

export interface RouteDecision {
  state: 'ready' | 'degraded' | 'no_eligible_model'
  mode: 'research' | 'coding' | 'documentation'
  provider: string | null
  model: string | null
  reason: string
  /** Auto tool call the server chose for this turn (current web info), if any. */
  tool?: 'searchWeb' | 'safeTools' | null
  /** Level to send: exact for a picked model, policy-capped for Auto. */
  reasoning?: ReasoningLevel | null
}

export interface RouteOptions {
  allowCloud?: boolean
  reasoning?: ReasoningLevel
  agentMode?: AgentTurnRequest['mode']
}

export function routeTurn(
  prompt: string,
  mode: ExecutionMode,
  preference?: { provider: string; model: string },
  signal?: AbortSignal,
  options: RouteOptions = {}
): Promise<RouteDecision> {
  return request('/routing/turn', {
    method: 'POST',
    body: JSON.stringify({
      prompt, mode, preference,
      allow_cloud: options.allowCloud, reasoning: options.reasoning, agent_mode: options.agentMode
    }),
    signal
  })
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

async function getApiConnection(): Promise<{ url: string; token: string }> {
  let connection: { url: string; token: string } | null
  try {
    connection = await window.api.getBackendConnection()
  } catch {
    throw new ApiError(503, 'Local API authentication is unavailable; check ATLAS_API_TOKEN in development.')
  }
  if (!connection?.url || !connection.token) {
    throw new ApiError(503, 'Local API authentication is unavailable; check ATLAS_API_TOKEN in development.')
  }
  const url = DEVELOPMENT_API_BASE || connection.url
  let backend: URL
  try {
    backend = new URL(url)
  } catch {
    throw new ApiError(403, 'Local API credentials cannot be sent to a non-local backend.')
  }
  const isLoopback =
    backend.protocol === 'http:' &&
    !backend.username &&
    !backend.password &&
    backend.pathname === '/' &&
    !backend.search &&
    !backend.hash &&
    (import.meta.env.DEV
      ? backend.port === '8000' && ['127.0.0.1', 'localhost'].includes(backend.hostname)
      : backend.port !== '' && backend.hostname === '127.0.0.1')
  if (!isLoopback) {
    throw new ApiError(403, 'Local API credentials cannot be sent to a non-local backend.')
  }
  return { url: backend.href.replace(/\/$/, ''), token: connection.token }
}

/** Thrown instead of ApiError when the request was deliberately aborted
 * (e.g. the user clicked Stop) -- callers should treat this as a silent,
 * expected outcome rather than a real failure. */
export class ApiAborted extends Error {}

/** Turns a request failure into a short, user-safe message. The server
 * already unwraps SDK exceptions down to their clean human-readable text
 * (see _err_detail in api.py) -- e.g. "You exceeded your current quota" or
 * "API key not valid" -- which is worth showing as-is. Only an empty or
 * implausibly long message (a raw dump some exception slipped through
 * unclean) falls back to `fallback` instead. */
export function friendlyErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    return err.message && err.message.length <= 300 ? err.message : fallback
  }
  return fallback
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const { url, token } = await getApiConnection()
  let res: Response | undefined
  let lastError: unknown
  // The packaged Electron app may render shortly before its embedded FastAPI
  // process opens the localhost port. Retry transient connection failures so
  // saved provider settings load automatically on first launch.
  for (let attempt = 0; attempt < 10; attempt += 1) {
    if (options.signal?.aborted) throw new ApiAborted('request aborted')
    try {
      res = await fetch(`${url}${path}`, {
        ...options,
        headers: { 'Content-Type': 'application/json', ...options.headers,
          Authorization: `Bearer ${token}` }
      })
      break
    } catch (err) {
      if (options.signal?.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
        throw new ApiAborted('request aborted')
      }
      lastError = err
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
  }
  if (options.signal?.aborted) throw new ApiAborted('request aborted')
  if (!res) {
    throw new ApiError(
      0,
      lastError
        ? 'Could not reach the Atlas server. Is it running?'
        : 'Could not reach the Atlas server.'
    )
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
  signal?: AbortSignal,
  mode: ExecutionMode = 'auto'
): Promise<Reply> {
  return request(`/sessions/${sessionId}/messages`, {
    method: 'POST',
    body: JSON.stringify({ prompt, images: images?.length ? images : undefined, mode }),
    signal
  })
}

export interface MemoryRecall {
  summary: boolean
  hits: { text: string; thread_id: string; distance: number }[]
  facts: string[]
}

export async function sendMessageStream(
  sessionId: string,
  prompt: string,
  images: { data: string; mime: string }[] | undefined,
  onToken: (token: string) => void,
  onMemory?: (memory: MemoryRecall) => void,
  signal?: AbortSignal,
  mode: ExecutionMode = 'auto',
  reasoning?: ReasoningLevel
): Promise<void> {
  const { url, token } = await getApiConnection()
  const res = await fetch(`${url}/sessions/${sessionId}/messages/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ prompt, images: images?.length ? images : undefined, mode, reasoning }),
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
        let parsed: { text?: string; error?: string; memory?: MemoryRecall }
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
        if (parsed.memory) {
          onMemory?.(parsed.memory)
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

export type DraftKind = 'research_brief' | 'comparison' | 'decision_memo' | 'readme'

export interface DraftArtifact {
  id: string
  filename: string
  kind: DraftKind
}

export interface AgentTurnRequest {
  prompt: string
  mode: 'chat' | 'search_web' | 'research' | 'plan' | 'write' | 'draft' | 'tools'
  draft_kind?: DraftKind
  instructions?: string
  images?: ImagePayload[]
  recent?: { role: 'user' | 'assistant'; content: string }[]
  attachments?: { id: string; name: string; mime: string; content: string }[]
  reasoning?: ReasoningLevel
}

export async function sendAgentStream(
  sessionId: string,
  body: AgentTurnRequest,
  onEvent: (event: AgentEvent) => void,
  signal: AbortSignal
): Promise<void> {
  const { url, token } = await getApiConnection()
  if (signal.aborted) throw new ApiAborted('request aborted')
  const res = await fetch(`${url}/sessions/${sessionId}/agent/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal
  })
  if (!res.ok) {
    let detail = res.statusText
    try {
      const parsed = await res.json()
      detail = typeof parsed.detail === 'string' ? parsed.detail : detail
    } catch {
      // Non-JSON error response.
    }
    throw new ApiError(res.status, detail)
  }
  const reader = res.body?.getReader()
  if (!reader) throw new ApiError(502, 'No agent response body')
  const decoder = new TextDecoder()
  let buffer = ''
  let completed = false
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''
      for (const line of lines) {
        const event = decodeAgentEvent(line.trim())
        if (!event) continue
        if (event.type === 'run.failed') throw new ApiError(502, event.reason || 'Agent run failed')
        if (event.type === 'run.cancelled') throw new ApiAborted('request aborted')
        onEvent(event)
        if (event.type === 'run.completed') completed = true
      }
    }
  } finally {
    reader.releaseLock()
  }
  if (signal.aborted) throw new ApiAborted('request aborted')
  if (!completed) throw new ApiError(502, 'Agent run ended without a result')
}

export function resetSession(sessionId: string): Promise<{ ok: boolean }> {
  return request(`/sessions/${sessionId}/new_chat`, { method: 'POST' })
}

export function closeSession(sessionId: string): Promise<{ ok: boolean }> {
  return request(`/sessions/${sessionId}`, { method: 'DELETE' })
}

export interface IndexedDocument {
  source_id: string
  name: string
  byte_size: number
}

export interface DocumentHit {
  source_id: string
  name: string
  chunk_id: number
  text: string
  score: number
}

export function listDocuments(): Promise<IndexedDocument[]> {
  return request('/documents')
}

export function ingestDocument(name: string, text: string): Promise<{ source_id: string }> {
  return request('/documents', { method: 'POST', body: JSON.stringify({ name, text }) })
}

export function searchDocuments(query: string): Promise<DocumentHit[]> {
  return request(`/documents/search?q=${encodeURIComponent(query)}`)
}

export function deleteDocument(sourceId: string): Promise<void> {
  return request(`/documents/${encodeURIComponent(sourceId)}`, { method: 'DELETE' })
}

// ---- provider settings (API keys + local LLM connection) ------------------
export interface ProviderSettings {
  configured: boolean
  base_url?: string | null
  model?: string | null
  runtime?: 'ollama' | 'lmstudio' | 'vllm' | 'local'
  api_key_configured?: boolean
}
export type ProviderSettingsMap = Record<string, ProviderSettings>

export interface LocalModelsResponse {
  base_url: string
  runtime: 'ollama' | 'lmstudio' | 'vllm' | 'local'
  models: string[]
}

export function getProviderSettings(): Promise<ProviderSettingsMap> {
  return request('/settings/providers')
}

export function getLocalModels(): Promise<LocalModelsResponse> {
  return request('/settings/providers/local/models')
}

export function setProviderSettings(
  provider: string,
  body: {
    api_key?: string
    base_url?: string
    model?: string
    runtime?: 'ollama' | 'lmstudio' | 'vllm' | 'local'
  }
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
