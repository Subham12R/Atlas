export type LocalRuntimeId = 'ollama'
export type RuntimeState = 'starting' | 'ready' | 'unavailable' | 'failed'

export interface LocalRuntimeStatus {
  runtimeId: LocalRuntimeId
  state: RuntimeState
  managed: boolean
  supported: boolean
  message: string
}
