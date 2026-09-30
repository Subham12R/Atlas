/** The chat's saved transcript is the source of truth for context: every turn
 * (chat or agent, same or rebuilt session, any model) is sent the newest turns
 * that fit these bounds. Limits mirror server/tools/contracts.py. Older context
 * still reaches the model through the memory thread's summary and recall. */
export const MAX_HISTORY_TURNS = 20
export const MAX_HISTORY_CHARS = 24000
const MAX_TURN_CHARS = 4000

export interface HistoryTurn {
  role: 'user' | 'assistant'
  content: string
}

export function conversationHistory(
  messages: { sender: 'user' | 'assistant'; content: string }[]
): HistoryTurn[] {
  const turns: HistoryTurn[] = []
  let total = 0
  for (let i = messages.length - 1; i >= 0 && turns.length < MAX_HISTORY_TURNS; i--) {
    const { sender, content } = messages[i]
    if (!content.trim() || content.startsWith('**Error:**')) continue
    // Keep the start of a long turn: it usually states the question or the answer.
    const text = content.length > MAX_TURN_CHARS ? `${content.slice(0, MAX_TURN_CHARS)}\n[truncated]` : content
    if (total + text.length > MAX_HISTORY_CHARS) break
    total += text.length
    turns.unshift({ role: sender, content: text })
  }
  return turns
}

/** A bare "keep going" reply that carries no new request of its own. */
const CONTINUATION =
  /^\s*(?:continue|go on|keep going|carry on|proceed|resume|retry|try again|again|do it|do that|do|go ahead|search(?: it| that| again)?|yes|yes please|ok|okay)\s*[.!]*\s*$/i

export function isContinuation(text: string): boolean {
  return CONTINUATION.test(text)
}

const SEARCH_TOOLS = new Set(['searchWeb', 'deepResearch', 'safeTools'])

/** The query a search-mode continuation stands for: the user's previous question, but only
 * if that turn was itself a search (it already went to a search engine). Otherwise the
 * prompt is returned unchanged and the server asks what to search for. */
export function resolveSearchPrompt(
  prompt: string,
  history: { sender: 'user' | 'assistant'; content: string; tool?: string; request?: { tool: string | null } }[]
): string {
  if (!isContinuation(prompt)) return prompt
  for (let i = history.length - 1; i >= 0; i--) {
    const message = history[i]
    if (message.sender !== 'user' || isContinuation(message.content)) continue
    const reply = history[i + 1]
    const searched = SEARCH_TOOLS.has(message.request?.tool ?? '') ||
      (reply?.sender === 'assistant' && SEARCH_TOOLS.has(reply.tool ?? ''))
    return searched ? message.content : prompt
  }
  return prompt
}
