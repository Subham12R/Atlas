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
