export type AgentEvent =
  | { type: 'run.started'; run_id?: string; mode?: string }
  | { type: 'plan.ready'; queries: string[]; objective: string; freshness?: string; source_criteria?: string[] }
  | { type: 'plan.degraded'; reason: string }
  | { type: 'tool.started' | 'tool.completed' | 'tool.failed'; tool: string; source_id?: string; reason?: string; query?: string }
  | { type: 'tool.progress'; phase: string }
  | { type: 'source.found'; source: { source_id: string; title: string; url: string; host?: string; snippet?: string; fetched?: boolean; published_date?: string; score?: number } }
  | { type: 'attachment.found'; attachment: { source_id: string; filename: string; section: string } }
  | { type: 'assistant.delta'; text: string }
  | { type: 'run.completed'; status: 'completed' | 'partial'; reason?: string | null; sources?: { source_id: string; title: string; url: string; snippet?: string; host?: string; fetched?: boolean; published_date?: string; score?: number }[]; attachments?: { source_id: string; filename: string; section: string }[]; queries?: string[]; draft?: { id: string; filename: string; kind: 'research_brief' | 'comparison' | 'decision_memo' | 'readme' } | null }
  | { type: 'run.failed'; run_id?: string; code?: 'unsupported_model' | 'key_unavailable' | 'timeout' | 'budget' | 'invalid_call' | 'provider_unavailable' | 'internal'; phase?: string; reason: string }
  | { type: 'run.cancelled'; reason?: string }
  | { type: 'approval.required'; call_id: string }

export function modeForTool(tool: string | null): 'chat' | 'search_web' | 'research' | 'plan' | 'write' | 'draft' | 'tools'
export function decodeAgentEvent(line: string): AgentEvent | null
