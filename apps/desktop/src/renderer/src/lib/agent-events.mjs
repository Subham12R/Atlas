export const TOOL_MODES = Object.freeze({
  searchWeb: 'search_web', deepResearch: 'research', thinkLonger: 'plan', writeCode: 'write',
  draftDocument: 'draft', safeTools: 'tools'
})

export function modeForTool(tool) {
  return TOOL_MODES[tool] ?? 'chat'
}

const EVENT_TYPES = new Set([
  'run.started', 'plan.ready', 'plan.degraded', 'tool.started', 'tool.progress',
  'tool.completed', 'tool.failed', 'source.found', 'attachment.found', 'approval.required',
  'assistant.delta', 'run.completed', 'run.failed', 'run.cancelled'
])

export function decodeAgentEvent(line) {
  if (!line.startsWith('data: ')) return null
  try {
    const event = JSON.parse(line.slice(6))
    if (!event || typeof event !== 'object') return null
    if (!EVENT_TYPES.has(event.type)) {
      console.warn('Ignoring unknown agent event type',
        typeof event.type === 'string' ? event.type.slice(0, 80) : typeof event.type)
      return null
    }
    return event
  } catch {
    return null
  }
}
