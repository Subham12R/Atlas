import type { ExecutionMode } from '@/lib/modes'
import type { DraftKind } from '@/lib/api'

export type ComposerPreference = { intent: ChatIntent; draftKind: DraftKind }

export type ChatIntent =
  | 'auto' | 'coding' | 'documentation' | 'searchWeb' | 'deepResearch'
  | 'plan' | 'draftDocument' | 'safeTools' | 'generateImage'

export const INTENT_OPTIONS: { id: ChatIntent; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'coding', label: 'Coding' },
  { id: 'documentation', label: 'Documentation' },
  { id: 'searchWeb', label: 'Web search' },
  { id: 'deepResearch', label: 'Research web' },
  { id: 'plan', label: 'Plan' },
  { id: 'draftDocument', label: 'Draft document' },
  { id: 'safeTools', label: 'Safe tools' },
  { id: 'generateImage', label: 'Generate image' }
]

export function requestForIntent(intent: ChatIntent): { tool: string | null; mode: ExecutionMode } {
  if (intent === 'coding' || intent === 'documentation') return { tool: null, mode: intent }
  if (intent === 'auto') return { tool: null, mode: 'auto' }
  return { tool: intent === 'plan' ? 'thinkLonger' : intent, mode: 'auto' }
}
