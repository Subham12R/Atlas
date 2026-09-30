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

type SearchTurn = { sender: 'user' | 'assistant'; content: string; tool?: string; request?: { tool: string | null } }

/** Did this user turn (at index i) go to a search engine? True when the turn or its reply says so. */
function wasSearched(history: SearchTurn[], i: number): boolean {
  const reply = history[i + 1]
  return SEARCH_TOOLS.has(history[i].request?.tool ?? '') ||
    (reply?.sender === 'assistant' && SEARCH_TOOLS.has(reply.tool ?? ''))
}

/** Mirrors needs_rewrite in server/agents/query_rewrite.py: a short message, or one that opens
 * with a preposition/conjunction/pointer, leans on the previous turn for its subject. */
const FRAGMENT =
  /^\s*(?:from|at|in|of|on|for|with|and|or|also|but|what about|how about|the|that|this|those|these|he|she|they|it|same|more|another|other|which)\b/i

export function isFragmentFollowUp(text: string): boolean {
  return text.trim().split(/\s+/).length <= 8 || FRAGMENT.test(text)
}

/** A short follow-up to a turn that searched the web ("from adamas university"): Auto keeps
 * searching instead of falling back to a plain answer with no sources. */
export function followsSearch(prompt: string, history: SearchTurn[]): boolean {
  if (!isFragmentFollowUp(prompt)) return false
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].sender !== 'user') continue
    return wasSearched(history, i)
  }
  return false
}

/** The query a search-mode continuation stands for: the user's previous question, but only
 * if that turn was itself a search (it already went to a search engine). Otherwise the
 * prompt is returned unchanged and the server asks what to search for. Other short follow-ups
 * are sent as-is: the server rewrites them into a standalone query from the visible chat. */
export function resolveSearchPrompt(prompt: string, history: SearchTurn[]): string {
  if (!isContinuation(prompt)) return prompt
  for (let i = history.length - 1; i >= 0; i--) {
    const message = history[i]
    if (message.sender !== 'user' || isContinuation(message.content)) continue
    return wasSearched(history, i) ? message.content : prompt
  }
  return prompt
}
