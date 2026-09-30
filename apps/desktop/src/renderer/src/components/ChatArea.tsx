import React, { useState, useRef, useEffect } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Check, ChevronDown, Cloud, Cpu, Loader2, RotateCcw, Search, Sparkles, X } from 'lucide-react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  SidebarRightIcon,
  ArrowDown,
  Share01Icon,
  Message01Icon,
  PinIcon,
  UserIcon,
  Copy01Icon
} from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'
import { highlightCode } from '@/lib/highlight'
import { planSteps, planWithSteps } from '@/lib/plan-steps'
import { chatToHtml } from '@/lib/exportHtml'
import { DocumentDraftReview } from '@/components/DocumentDraftReview'
import { PromptBox, fileIcon, type Attachment } from '@/components/ui/chatgpt-prompt-input'
import { LoadingState } from '@/components/LoadingState'
import { Reasoning, ReasoningTrigger, ReasoningContent } from '@/components/ai/reasoning'
import { Task, TaskTrigger, TaskContent, TaskItem } from '@/components/ai/task'
import { Plan, PlanHeader, PlanTitle, PlanTrigger, PlanContent, PlanFooter } from '@/components/ai/plan'
import { Sources, SourcesTrigger, SourcesContent } from '@/components/ai/sources'
import { ContextCard } from '@/components/ai/context-card'
import { GradientWaveText } from '@/components/gradient-wave-text'
import {
  friendlyErrorMessage,
  getLocalModels,
  getProviderSettings,
  getProviders,
  type DraftArtifact,
  type DraftKind,
  type MemoryRecall,
  type ProviderSettingsMap,
  type ReasoningLevel
} from '@/lib/api'
import type { ExecutionMode } from '@/lib/modes'
import { supportsImageGeneration, type ChatIntent, type ComposerPreference } from '@/lib/chat-intent'
import ThemeSwitch from '@/components/ui/theme-switch'
import { Switch } from '@/components/ui/switch'
import { RichButton } from './rich-button'

export interface MessageFileAttachment {
  kind: 'file'
  name: string
}

export interface MessageImageAttachment {
  kind: 'image'
  /** file:// path on disk, or a remote URL when the provider returns one. */
  path: string
}

export type MessageAttachment = MessageFileAttachment | MessageImageAttachment

/** One saved step of an agent run (planning or a tool call), kept on the
 * message so the trace survives after streaming ends and across restarts. */
export interface TraceStep {
  label: string
  tool?: string
  status: 'running' | 'done' | 'failed'
  detail?: string
}

/** Per-send model policy. provider 'auto' in onSendMessage means the router picks. */
export interface SendOptions {
  reasoning: ReasoningLevel
  /** Auto may use connected cloud providers (local models are always tried first). */
  allowCloud: boolean
  /** Provider for image generation when the model is Auto. */
  imageProvider?: string
}

export interface MessageRequest extends SendOptions {
  tool: string | null
  mode: ExecutionMode
  draftKind: DraftKind
  provider: string
  model: string | null
}

export type PlanStatus = 'approved' | 'revising' | 'dismissed'

/** File name the plan-approval flow attaches the approved plan under. */
export const APPROVED_PLAN_FILE = 'approved-plan.md'

export interface Message {
  id: string
  sender: 'user' | 'assistant'
  content: string
  timestamp: string
  provider?: string
  /** Concrete model selected within a provider (primarily local servers). */
  model?: string
  memory?: MemoryRecall
  latencyMs?: number
  /** Marks a just-arrived assistant reply so ChatArea typewriter-reveals it
   * once; historical messages (loaded, not freshly received) render instantly. */
  isNew?: boolean
  /** Reasoning/thinking trace, when a provider exposes one. Not populated by
   * any adapter yet -- the display is ready for when one is wired up. */
  thinking?: string
  /** Uploaded/generated attachments, rendered as blocks above the text. */
  attachments?: MessageAttachment[]
  /** Server-issued web sources, shown only when the final answer cites their IDs. */
  sources?: { title: string; url: string; source_id?: string; snippet?: string; host?: string; fetched?: boolean; published_date?: string; score?: number }[]
  queries?: string[]
  researchPlan?: { objective: string; freshness?: string; source_criteria?: string[] }
  runPhase?: string
  routeReason?: string
  runStatus?: 'completed' | 'partial'
  attachmentSources?: { source_id: string; filename: string; section: string }[]
  draft?: DraftArtifact
  trace?: TraceStep[]
  /** User messages: the exact request, so Retry replays it faithfully. */
  request?: MessageRequest
  /** Plan-mode replies: the user's decision on the plan. */
  planStatus?: PlanStatus
  /** A retry of this reply failed; the reply shown is the original. */
  retryError?: string
  /** The tool used to produce this reply (searchWeb/deepResearch/thinkLonger/
   * writeCode), if any -- picks the reply's visual treatment (Task trace,
   * Plan card, or the default plain bubble). */
  tool?: string
}

export interface Chat {
  id: string
  title: string
  isPinned: boolean
  timestamp: string
  messages: Message[]
  provider: string | null
  /** Concrete model bound to the current provider session. */
  model?: string | null
  /** The user chose Auto; `provider`/`model` are just the last routed pick. */
  autoModel?: boolean
  sessionId: string | null
  threadId: string | null
  isSending?: boolean
  /** Messages accepted while a response is in progress. */
  queuedCount?: number
  /** The in-flight request is generating an image -- shows a 4:3 skeleton
   * instead of the text "Thinking..." indicator while isSending is true. */
  isGeneratingImage?: boolean
}

interface ChatAreaProps {
  isSidebarCollapsed: boolean
  setIsSidebarCollapsed: (collapsed: boolean) => void
  activeChat: Chat | null
  composerPreference?: ComposerPreference
  onComposerChange?: (update: Partial<ComposerPreference>) => void
  onSendMessage: (
    content: string,
    tool: string | null,
    provider: string,
    model: string | null,
    attachments: Attachment[],
    mode: ExecutionMode,
    draftKind: DraftKind,
    options: SendOptions
  ) => void
  onNewChat: () => void
  onTogglePin: (id: string) => void
  onMessageRevealed: (messageId: string) => void
  onStopSending: (chatId: string) => void
  /** Regenerates this assistant reply in place. */
  onRetryMessage?: (messageId: string) => void
  onPlanStatus?: (messageId: string, status: PlanStatus) => void
  /** Returns an opener when a memory recall's thread maps to another chat. */
  openThread?: (threadId: string) => (() => void) | undefined
}

type ModelOption = {
  id: string
  provider: string
  model?: string
  name: string
  desc: string
}

const MODELS: ModelOption[] = [
  { id: 'openai', provider: 'openai', name: 'OpenAI', desc: 'GPT models via official API' },
  { id: 'anthropic', provider: 'anthropic', name: 'Anthropic', desc: 'Claude models via official API' },
  { id: 'gemini', provider: 'gemini', name: 'Gemini', desc: 'Google Gemini via official API' },
  { id: 'openrouter', provider: 'openrouter', name: 'OpenRouter', desc: 'Any model, routed through OpenRouter' },
  { id: 'local', provider: 'local', name: 'Local model', desc: 'Ollama, LM Studio, vLLM, or another local server' }
]

/** The router picks provider + model per turn (see server auto_route.py). */
const AUTO_MODEL: ModelOption = { id: 'auto', provider: 'auto', name: 'Auto', desc: 'Picks a model per message' }

const REASONING_LEVELS: ReasoningLevel[] = ['off', 'low', 'medium', 'high', 'max']
const REASONING_LABELS: Record<ReasoningLevel, string> = {
  off: 'Off', low: 'Low', medium: 'Med', high: 'High', max: 'Max'
}

function storedReasoning(): ReasoningLevel {
  const value = localStorage.getItem('atlas.reasoning')
  return REASONING_LEVELS.includes(value as ReasoningLevel) ? (value as ReasoningLevel) : 'medium'
}

function localModelOption(model: string, runtime: string = 'local'): ModelOption {
  const runtimeName =
    runtime === 'lmstudio'
      ? 'LM Studio'
      : runtime === 'vllm'
        ? 'vLLM'
        : runtime === 'ollama'
          ? 'Ollama'
          : 'Local'
  return {
    id: `local:${model}`,
    provider: 'local',
    model,
    name: model,
    desc: `${runtimeName} local model`
  }
}

/** Collapsible reasoning-trace panel, shown above the reply when a provider
 * supplies one. No adapter populates `thinking` yet -- this stays inert
 * (renders nothing) until reasoning-model streaming is wired up. */
function MemoryUsed({
  memory,
  openThread
}: {
  memory?: MemoryRecall
  openThread?: ChatAreaProps['openThread']
}): React.JSX.Element | null {
  if (!memory || (!memory.summary && memory.hits.length === 0 && memory.facts.length === 0)) return null
  return (
    <details className="mt-3 text-xs text-[#6E6D6A] dark:text-[#9E9D9A]">
      <summary className="cursor-pointer select-none font-medium">Memory used ({memory.hits.length} recall{memory.hits.length === 1 ? '' : 's'})</summary>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {memory.summary && (
          <ContextCard label="Conversation summary">This conversation&apos;s rolling summary.</ContextCard>
        )}
        {memory.hits.map((hit, index) => (
          <ContextCard key={`${hit.thread_id}-${index}`} label="Past conversation"
            meta={`${Math.round((1 - hit.distance) * 100)}% match`} onClick={openThread?.(hit.thread_id)}>
            {hit.text}
          </ContextCard>
        ))}
        {memory.facts.map((fact) => <ContextCard key={fact} label="Saved fact">{fact}</ContextCard>)}
      </div>
    </details>
  )
}

/** Saved per-message trace of planning/tool steps, rendered as chips. A step
 * still marked running after the stream ends was interrupted, so it only
 * spins while the message is actually streaming. */
function TraceChips({ trace, isStreaming }: { trace?: TraceStep[]; isStreaming: boolean }): React.JSX.Element | null {
  if (!trace?.length) return null
  return (
    <ul aria-label="Run steps" className="mb-2 flex flex-wrap gap-1.5">
      {trace.map((step, index) => (
        <li key={index} title={step.detail}
          className={cn(
            'flex max-w-64 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]',
            step.status === 'failed'
              ? 'border-amber-300 text-amber-700 dark:border-amber-800 dark:text-amber-300'
              : 'border-[#E5E3DF] text-[#6E6D6A] dark:border-[#2C2C2A] dark:text-[#9E9D9A]'
          )}>
          {step.status === 'failed' ? <X size={11} aria-hidden="true" />
            : step.status === 'running' && isStreaming ? <Loader2 size={11} className="animate-spin" aria-hidden="true" />
              : step.status === 'done' ? <Check size={11} aria-hidden="true" /> : null}
          <span className="truncate">{step.label}</span>
        </li>
      ))}
    </ul>
  )
}

function CodeBlockSkeleton({ language }: { language?: string }): React.JSX.Element {
  return (
    <div className="my-4 overflow-hidden rounded-xl border border-[#E5E3DF] bg-[#FDFDFB] dark:border-[#2C2C2A] dark:bg-[#1A1A18]">
      <div className="flex items-center justify-between px-4 pt-3 text-[10px] font-mono text-[#6E6D6A] dark:text-[#9E9D9A]">
        <span>{language || 'code'}</span>
        <span className="animate-pulse">Generating code...</span>
      </div>
      <div className="space-y-2 px-4 py-4">
        <div className="h-2 w-11/12 animate-pulse rounded bg-[#EAE8E3] dark:bg-[#2C2C2A]" />
        <div className="h-2 w-8/12 animate-pulse rounded bg-[#EAE8E3] dark:bg-[#2C2C2A]" />
        <div className="h-2 w-10/12 animate-pulse rounded bg-[#EAE8E3] dark:bg-[#2C2C2A]" />
        <div className="h-2 w-6/12 animate-pulse rounded bg-[#EAE8E3] dark:bg-[#2C2C2A]" />
      </div>
    </div>
  )
}

/** The model's thinking, streamed separately from the answer. A live reply shows it open
 * while the model thinks and collapses it once the answer starts; saved replies start
 * collapsed and expand on click. */
function ThinkingBlock({
  thinking,
  isThinking = false,
  isLive = false
}: {
  thinking?: string
  isThinking?: boolean
  isLive?: boolean
}): React.JSX.Element | null {
  if (!thinking) return null

  return (
    <Reasoning defaultOpen={isLive} isStreaming={isThinking}>
      <ReasoningTrigger />
      <ReasoningContent className="max-h-72 overflow-y-auto">{thinking}</ReasoningContent>
    </Reasoning>
  )
}

/** Row of compact blocks for a message's uploaded/generated attachments --
 * rendered above the text content, never inlined into it. Images render as
 * thumbnails; other files render as a small icon + name pill. */
function AttachmentBlocks({
  attachments
}: {
  attachments?: MessageAttachment[]
}): React.JSX.Element | null {
  if (!attachments || attachments.length === 0) return null

  return (
    <div className="flex flex-wrap gap-1.5 mb-2">
      {attachments.map((att, i) =>
        att.kind === 'image' ? (
          <img
            key={i}
            src={att.path}
            alt="attachment"
            className="h-28 w-28 rounded-xl object-cover border border-[#E5E3DF] dark:border-[#2C2C2A]"
          />
        ) : (
          <div
            key={i}
            className="flex items-center gap-1.5 rounded-lg bg-[#EAE8E3] dark:bg-[#2C2C2A] pl-2 pr-2.5 py-1 text-xs text-[#2E2E2D] dark:text-[#EAE8E3]"
          >
            <HugeiconsIcon icon={fileIcon(att.name)} size={14} />
            <span className="max-w-[160px] truncate">{att.name}</span>
          </div>
        )
      )}
    </div>
  )
}

/** Collapsible "what was searched" trace for a Search-web/Research-mode
 * reply -- one Task step per source found, shown above the synthesized
 * answer. Complements SourcePins (the citation footer) rather than
 * duplicating it: this is the process, the pins are the citations. */
function SearchTrace({
  tool,
  sources,
  queries,
  researchPlan
}: {
  tool?: string
  sources?: Message['sources']
  queries?: string[]
  researchPlan?: Message['researchPlan']
}): React.JSX.Element | null {
  if ((tool !== 'searchWeb' && tool !== 'deepResearch' && tool !== 'safeTools') ||
      ((!sources || sources.length === 0) && (!queries || queries.length === 0))) {
    return null
  }
  const sourceList = (sources || []).filter((source) => /^https?:\/\//i.test(source.url))

  return (
    <Task defaultOpen={false}>
      <TaskTrigger title={tool === 'deepResearch'
        ? `Research · ${queries?.length || 0} queries · ${sourceList.filter((s) => s.fetched).length} pages read`
        : tool === 'safeTools' ? `Safe tools · ${sourceList.length} sources` : `Web search · ${sourceList.length} sources`} />
      <TaskContent>
        {researchPlan && <p className="mb-2 text-xs font-medium">{researchPlan.objective}</p>}
        {researchPlan?.freshness && <p className="mb-2 text-[10px] text-muted-foreground">Freshness: {researchPlan.freshness}</p>}
        {queries?.length ? <ul className="mb-2 list-disc pl-4 text-xs">{queries.map((query) => <li key={query}>{query}</li>)}</ul> : null}
        {sourceList.map((s, i) => (
          <TaskItem key={i}>
            <a
              href={s.url}
              target="_blank"
              rel="noreferrer"
              className="hover:text-[#2E2E2D] dark:hover:text-[#EAE8E3] hover:underline"
            >
              {s.source_id ? `[${s.source_id}] ` : ''}{s.title || s.url}{s.published_date ? ` · ${s.published_date}` : ''}{s.fetched ? ' · read' : ''}
            </a>
          </TaskItem>
        ))}
      </TaskContent>
    </Task>
  )
}

/** Collapsible "Used N sources" list for a Search-web/Research-mode reply's
 * citations, shown below the response text. */
function SourcePins({ sources }: { sources?: Message['sources'] }): React.JSX.Element | null {
  if (!sources || sources.length === 0) return null

  return (
    <Sources>
      <SourcesTrigger count={sources.length} />
      <SourcesContent>
        <div className="space-y-2">
          {sources.map((source, index) => (
            <article key={source.source_id || index} className="rounded-lg border border-border p-3">
              <a href={source.url} target="_blank" rel="noreferrer"
                className="text-sm font-medium hover:underline">
                {source.source_id ? `[${source.source_id}] ` : ''}{source.title || source.url}
              </a>
              <p className="mt-1 text-[10px] text-muted-foreground">
                {source.host || source.url}
                {source.published_date ? ` · ${source.published_date}` : ''}
                {source.fetched ? ' · page read' : ''}
              </p>
              {source.snippet && <p className="mt-2 line-clamp-3 text-xs text-muted-foreground">{source.snippet}</p>}
            </article>
          ))}
        </div>
      </SourcesContent>
    </Sources>
  )
}

/** Reveals `text` a few characters at a time when `animate` is true (skipped
 * for historical messages), re-parsing the growing substring each tick so
 * markdown blocks assemble progressively instead of popping in whole. */
function TypewriterText({
  text,
  animate,
  isStreaming,
  onDone,
  render
}: {
  text: string
  animate: boolean
  /** Still receiving new tokens for this message -- catching up to `text`
   * doesn't mean "done" while this is true, since more text is still coming. */
  isStreaming: boolean
  onDone?: () => void
  render: (text: string) => React.ReactNode
}): React.JSX.Element {
  const [revealed, setRevealed] = useState(animate ? 0 : text.length)
  const doneRef = useRef(!animate)

  useEffect(() => {
    if (!animate || doneRef.current) return
    const CHARS_PER_TICK = 4
    const id = setInterval(() => {
      setRevealed((prev) => {
        const next = Math.min(prev + CHARS_PER_TICK, text.length)
        if (next >= text.length && !isStreaming) {
          clearInterval(id)
          if (!doneRef.current) {
            doneRef.current = true
            onDone?.()
          }
        }
        return next
      })
    }, 12)
    return () => clearInterval(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animate, text, isStreaming])

  return <>{render(text.slice(0, revealed))}</>
}

/* const STARTER_PROMPTS = [
  {
    title: 'Refactor Custom React Hook',
    prompt:
      'Can you show me how to refactor a custom React hook for handling local storage, including SSR safety and type safety?'
  },
  {
    title: 'Explain Vector Embeddings',
    prompt:
      'Explain what vector embeddings are, how they are used in similarity searches, and give a simple conceptual example.'
  },
  {
    title: 'Draft API Spec Document',
    prompt:
      'Create a clean, minimal API specification for a user authentication and registration service, including response codes.'
  },
  {
    title: 'Analyze Performance Issues',
    prompt:
      'What are the main performance bottlenecks in React applications, and how can I profile them using browser dev tools?'
  }
] */

export default function ChatArea({
  isSidebarCollapsed,
  setIsSidebarCollapsed,
  activeChat,
  composerPreference,
  onComposerChange,
  onSendMessage,
  onNewChat,
  onTogglePin,
  onMessageRevealed,
  onStopSending,
  onRetryMessage,
  onPlanStatus,
  openThread
}: ChatAreaProps): React.JSX.Element {
  const [selectedModel, setSelectedModel] = useState('auto')
  const [reasoning, setReasoning] = useState<ReasoningLevel>(storedReasoning)
  const [allowCloud, setAllowCloud] = useState(() => localStorage.getItem('atlas.autoAllowCloud') === 'true')
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false)
  const [modelFilter, setModelFilter] = useState('')
  const [isExportingPdf, setIsExportingPdf] = useState(false)
  const [showScrollButton, setShowScrollButton] = useState(false)
  const [providerSettings, setProviderSettings] = useState<ProviderSettingsMap>({})
  const [providerLoadError, setProviderLoadError] = useState('')
  const [toolModels, setToolModels] = useState<Record<string, string[]>>({})
  const [localModels, setLocalModels] = useState<string[]>([])
  const [selection, setSelection] = useState<{ text: string; top: number; left: number } | null>(null)
  const [excludedSteps, setExcludedSteps] = useState<Record<string, number[]>>({})
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const promptRef = useRef<HTMLTextAreaElement>(null)

  // Only providers the user has actually connected (an API key, or "local"
  // which never needs one) show up as pickable models -- everything else
  // stays in Profile's Advanced section until it's configured there.
  useEffect(() => {
    const refresh = (): void => {
      getProviderSettings()
        .then((settings) => {
          setProviderSettings(settings)
          setProviderLoadError('')
        })
        .catch((err) => setProviderLoadError(friendlyErrorMessage(err, 'Local API unavailable.')))
      getLocalModels()
        .then((result) => setLocalModels(result.models))
        .catch(() => setLocalModels([]))
      getProviders()
        .then((items) => setToolModels(Object.fromEntries(
          items.map((item) => [item.provider, item.capabilities?.tool_models || []])
        )))
        .catch(() => setToolModels({}))
    }
    refresh()
    window.addEventListener('providers:updated', refresh)
    return () => window.removeEventListener('providers:updated', refresh)
  }, [])

  const activeModels = MODELS.filter((m) => providerSettings[m.provider]?.configured).flatMap((option) => {
    if (option.provider !== 'local') return option
    const runtime = providerSettings.local?.runtime || 'local'
    const chatModels = localModels.filter(
      (model) => !/(embedding|embed-|unlimited-ocr|\bocr\b)/i.test(model)
    )
    return chatModels.length > 0
      ? chatModels.map((model) => localModelOption(model, runtime))
      : [option]
  })

  const handleScroll = (): void => {
    const el = scrollContainerRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    setShowScrollButton(distanceFromBottom > 150)
    setSelection(null)
  }

  // Selection actions for text selected inside an assistant reply -- by mouse
  // or keyboard (selectionchange covers both). Escape dismisses the bar.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const update = (): void => {
      const sel = window.getSelection()
      const text = sel?.toString().trim() ?? ''
      const node = sel?.anchorNode
      const anchor = node instanceof Element ? node : node?.parentElement
      if (!sel || !text || sel.rangeCount === 0 || !anchor?.closest('[data-reply]')) {
        setSelection(null)
        return
      }
      const rect = sel.getRangeAt(0).getBoundingClientRect()
      setSelection({ text: text.slice(0, 2000), top: Math.max(8, rect.top - 40), left: rect.left + rect.width / 2 })
    }
    const onSelectionChange = (): void => {
      clearTimeout(timer)
      timer = setTimeout(update, 150)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setSelection(null)
    }
    document.addEventListener('selectionchange', onSelectionChange)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('selectionchange', onSelectionChange)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [])

  const handleExportPdf = async (chat: Chat): Promise<void> => {
    setIsExportingPdf(true)
    try {
      const html = chatToHtml(chat.title, chat.messages)
      await window.api.exportPdf(html)
    } finally {
      setIsExportingPdf(false)
    }
  }

  // Model can be switched mid-chat; when jumping to a different chat, reflect
  // that chat's current provider instead of whatever was last picked here.
  // (Adjusting state during render on a prop change, per React's own
  // guidance, instead of a useEffect -- avoids an extra cascading render.)
  const [syncedChatId, setSyncedChatId] = useState<string | null>(null)
  const currentChatId = activeChat?.id ?? null
  if (currentChatId !== syncedChatId) {
    setSyncedChatId(currentChatId)
    if (!activeChat || activeChat.autoModel) {
      setSelectedModel('auto')
    } else if (activeChat.provider) {
      setSelectedModel(
        activeChat.provider === 'local' && activeChat.model ? `local:${activeChat.model}` : activeChat.provider
      )
    }
  }

  // A selection that is no longer connected falls back to Auto in selectedModelObj.
  const effectiveModel = selectedModel

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [activeChat?.messages, activeChat?.isSending])

  const handlePromptSubmit = (
    text: string,
    selectedTool: string | null,
    attachments: Attachment[],
    mode: ExecutionMode,
    draftKind: DraftKind
  ): void => {
    onSendMessage(
      text,
      selectedTool,
      selectedModelObj.provider,
      selectedModelObj.model || null,
      attachments,
      mode,
      draftKind,
      {
        reasoning,
        allowCloud,
        imageProvider: activeModels.find((m) => supportsImageGeneration(m.provider))?.provider
      }
    )
  }

  const sendFollowUp = (text: string, tool: string | null = null, attachments: Attachment[] = []): void =>
    handlePromptSubmit(text, tool, attachments, 'auto', composerPreference?.draftKind ?? 'research_brief')

  const [prefill, setPrefill] = useState<{ text: string; id: number } | undefined>()

  /** instruction === null quotes the selection into the composer ("Ask"). */
  const sendSelectionAction = (instruction: string | null): void => {
    if (!selection) return
    const quote = selection.text.split('\n').map((line) => `> ${line}`).join('\n')
    setSelection(null)
    window.getSelection()?.removeAllRanges()
    if (instruction === null) setPrefill({ text: `${quote}\n\n`, id: (prefill?.id ?? 0) + 1 })
    else sendFollowUp(`${instruction}\n\n${quote}`)
  }

  const approvePlan = (message: Message, excluded: number[]): void => {
    onPlanStatus?.(message.id, 'approved')
    onComposerChange?.({ intent: 'auto' })
    const kept = planSteps(message.content)
      .filter((step) => !excluded.includes(step.number))
      .map((step) => step.number)
    const content = planWithSteps(message.content, excluded)
    sendFollowUp(
      excluded.length
        ? `Approved steps ${kept.join(', ')}. Carry out only these, step by step.`
        : 'Approved. Carry out this plan now, step by step.',
      // Tool-capable models execute with tools; others fall back to plain chat.
      toolCallsAvailable ? 'safeTools' : null,
      [{ kind: 'file', id: `plan-${message.id}`, name: APPROVED_PLAN_FILE, content, size: content.length }]
    )
  }

  // Custom typography parser for markdown-like formatting
  const parseMarkdownContent = (
    text: string,
    isStreaming = false,
    sources?: Message['sources'],
    attachmentSources?: Message['attachmentSources']
  ): React.ReactNode[] => {
    const lines = text.split('\n')
    let inCodeBlock = false
    let codeBlockLang = ''
    let codeBlockLines: string[] = []
    let listItems: string[] = []
    let listType: 'bullet' | 'number' | null = null
    let tableHeader: string[] | null = null
    let tableRows: string[][] = []
    let skipSeparatorAt = -1

    const renderedNodes: React.ReactNode[] = []

    const renderList = (key: string): React.JSX.Element | null => {
      if (listItems.length === 0) return null
      const list = (
        <ol
          key={key}
          className={cn(
            'my-3 pl-6 space-y-1 text-sm text-[#3E3E3D] dark:text-[#EAE8E3] leading-relaxed',
            listType === 'bullet' ? 'list-disc' : 'list-decimal'
          )}
        >
          {listItems.map((item, idx) => (
            <li key={idx} className="pl-1">
              {parseInlineStyles(item)}
            </li>
          ))}
        </ol>
      )
      listItems = []
      listType = null
      return list
    }

    const renderTable = (key: string): React.JSX.Element | null => {
      if (!tableHeader) return null
      const header = tableHeader
      const rows = tableRows
      const table = (
        <div
          key={key}
          className="my-4 overflow-x-auto rounded-xl border border-[#E5E3DF] dark:border-[#2C2C2A]"
        >
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-[#F1EFEA]/60 dark:bg-[#2C2C2A]/60">
                {header.map((cell, i) => (
                  <th
                    key={i}
                    className="px-3 py-2 text-left font-semibold text-[#2E2E2D] dark:text-[#EAE8E3] border-b border-[#E5E3DF] dark:border-[#2C2C2A]"
                  >
                    {parseInlineStyles(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri} className={ri % 2 === 1 ? 'bg-[#F1EFEA]/20 dark:bg-[#2C2C2A]/20' : ''}>
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      className="px-3 py-2 text-[#3E3E3D] dark:text-[#EAE8E3] border-b border-[#E5E3DF]/50 dark:border-[#2C2C2A]/50"
                    >
                      {parseInlineStyles(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
      tableHeader = null
      tableRows = []
      return table
    }

    const parseInlineStyles = (content: string): React.ReactNode[] => {
      // Basic bold (**text**) and code (`code`) parser
      const parts: React.ReactNode[] = []
      let lastIndex = 0

      // Match bold, code, or a server-issued source citation.
      const regex = /(\*\*([^*]+)\*\*|`([^`]+)`|\[([SA]\d+(?:,\s*[SA]\d+)*)\])/g
      let match

      let index = 0
      while ((match = regex.exec(content)) !== null) {
        // Add text before match
        if (match.index > lastIndex) {
          parts.push(content.substring(lastIndex, match.index))
        }

        const fullMatch = match[0]
        if (fullMatch.startsWith('**')) {
          // Bold
          parts.push(
            <strong key={index++} className="font-semibold text-[#1A1A19] dark:text-[#EAE8E3]">
              {match[2]}
            </strong>
          )
        } else if (fullMatch.startsWith('`')) {
          parts.push(
            <code
              key={index++}
              className="px-1.5 py-0.5 bg-[#F1EFEA] dark:bg-[#2A2A28] text-[#1A1A19] dark:text-[#EAE8E3] font-mono text-[11px] rounded-md border border-[#E5E3DF]/50 dark:border-[#2C2C2A]/50"
            >
              {match[3]}
            </code>
          )
        } else {
          for (const [position, id] of match[4].split(/,\s*/).entries()) {
            if (position) parts.push(', ')
            const source = sources?.find((s) => s.source_id === id)
            const attachment = attachmentSources?.find((s) => s.source_id === id)
            parts.push(source && /^https?:\/\//i.test(source.url) ? (
              <a key={index++} href={source.url} target="_blank" rel="noreferrer" className="text-blue-600 underline" title={source.title}>[{id}]</a>
            ) : attachment ? <span key={index++} title={`${attachment.filename}, ${attachment.section}`}>[{id}]</span> : `[${id}]`)
          }
        }
        lastIndex = regex.lastIndex
      }

      if (lastIndex < content.length) {
        parts.push(content.substring(lastIndex))
      }

      return parts.length > 0 ? parts : [content]
    }

    const isTableRow = (l: string): boolean => /^\s*\|.*\|\s*$/.test(l)
    const isTableSeparator = (l: string): boolean =>
      /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l)
    const splitTableRow = (l: string): string[] =>
      l
        .trim()
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((cell) => cell.trim())

    lines.forEach((line, index) => {
      // Code Block trigger
      if (line.trim().startsWith('```')) {
        if (inCodeBlock) {
          // End of code block
          inCodeBlock = false
          const raw = codeBlockLines.join('\n')
          const { html, language, source } = highlightCode(raw, codeBlockLang)
          renderedNodes.push(
            <div
              key={`code-${index}`}
              className="my-4 rounded-xl border border-[#E5E3DF] dark:border-[#2C2C2A] overflow-hidden bg-[#FDFDFB] dark:bg-[#1A1A18]"
            >
              <div className="flex items-center justify-between px-4 pt-3 text-[10px] font-mono text-[#6E6D6A] dark:text-[#9E9D9A]">
                <span className=" tracking-tighter">{language}</span>
                <RichButton
                  type="button"
                  aria-label="Copy code"
                  title="Copy code"
                  onClick={() => navigator.clipboard.writeText(source)}
                  className="hover:text-[#2E2E2D] dark:hover:text-[#EAE8E3] transition-colors cursor-pointer"
                >
                  Copy code
                </RichButton>
              </div>
              <pre className="px-4 pt-2 pb-4 overflow-x-auto text-[11px] font-mono leading-relaxed">
                <code
                  className={cn('hljs', `language-${language}`)}
                  dangerouslySetInnerHTML={{ __html: html }}
                />
              </pre>
            </div>
          )
          codeBlockLines = []
          codeBlockLang = ''
        } else {
          // Start of code block -- capture the language off the fence, e.g. ```python
          inCodeBlock = true
          codeBlockLang = line.trim().slice(3).trim()
        }
        return
      }

      if (inCodeBlock) {
        codeBlockLines.push(line)
        return
      }

      // Table trigger: a "| a | b |" row immediately followed by a
      // "|---|---|" separator starts a table; keep consuming row lines
      // until one doesn't match, then flush.
      if (
        !tableHeader &&
        isTableRow(line) &&
        lines[index + 1] &&
        isTableSeparator(lines[index + 1])
      ) {
        const listNode = renderList(`list-${index}`)
        if (listNode) renderedNodes.push(listNode)
        tableHeader = splitTableRow(line)
        tableRows = []
        skipSeparatorAt = index + 1
        return
      }

      if (tableHeader) {
        if (index === skipSeparatorAt) return
        if (isTableRow(line)) {
          tableRows.push(splitTableRow(line))
          return
        }
        const tableNode = renderTable(`table-${index}`)
        if (tableNode) renderedNodes.push(tableNode)
        // fall through -- this line still needs its own normal handling
      }

      // Markdown permits up to three spaces before an ATX heading.
      const headingLine = /^ {0,3}#/.test(line) ? line.trimStart() : line
      if (headingLine.startsWith('# ')) {
        const listNode = renderList(`list-${index}`)
        if (listNode) renderedNodes.push(listNode)
        renderedNodes.push(
          <h1
            key={`h1-${index}`}
            className="text-lg font-semibold tracking-tight text-[#1A1A19] dark:text-[#EAE8E3] mt-6 mb-2"
          >
            {parseInlineStyles(headingLine.substring(2))}
          </h1>
        )
        return
      }
      if (headingLine.startsWith('## ')) {
        const listNode = renderList(`list-${index}`)
        if (listNode) renderedNodes.push(listNode)
        renderedNodes.push(
          <h2
            key={`h2-${index}`}
            className="text-base font-semibold tracking-tight text-[#1A1A19] dark:text-[#EAE8E3] mt-5 mb-2"
          >
            {parseInlineStyles(headingLine.substring(3))}
          </h2>
        )
        return
      }
      if (headingLine.startsWith('### ')) {
        const listNode = renderList(`list-${index}`)
        if (listNode) renderedNodes.push(listNode)
        renderedNodes.push(
          <h3
            key={`h3-${index}`}
            className="text-[15px] font-semibold tracking-tight text-[#1A1A19] dark:text-[#EAE8E3] mt-4 mb-1.5"
          >
            {parseInlineStyles(headingLine.substring(4))}
          </h3>
        )
        return
      }
      const deeperHeading = /^(#{4,6}) (.+)$/.exec(headingLine)
      if (deeperHeading) {
        const Tag = `h${deeperHeading[1].length}` as 'h4' | 'h5' | 'h6'
        const listNode = renderList(`list-${index}`)
        if (listNode) renderedNodes.push(listNode)
        renderedNodes.push(
          <Tag key={`h${deeperHeading[1].length}-${index}`}
            className="mt-3 mb-1.5 text-sm font-semibold text-[#1A1A19] dark:text-[#EAE8E3]">
            {parseInlineStyles(deeperHeading[2])}
          </Tag>
        )
        return
      }

      // Lists: Bullets
      if (line.trim().startsWith('- ') || line.trim().startsWith('* ')) {
        if (listType !== 'bullet') {
          const listNode = renderList(`list-${index}`)
          if (listNode) renderedNodes.push(listNode)
          listType = 'bullet'
        }
        listItems.push(line.trim().substring(2))
        return
      }

      // Lists: Numbered
      if (/^\d+\.\s/.test(line.trim())) {
        if (listType !== 'number') {
          const listNode = renderList(`list-${index}`)
          if (listNode) renderedNodes.push(listNode)
          listType = 'number'
        }
        const contentStr = line.trim().replace(/^\d+\.\s/, '')
        listItems.push(contentStr)
        return
      }

      // Regular line
      if (line.trim() === '') {
        const listNode = renderList(`list-${index}`)
        if (listNode) renderedNodes.push(listNode)
        renderedNodes.push(<div key={`empty-${index}`} className="h-2" />)
      } else {
        const listNode = renderList(`list-${index}`)
        if (listNode) renderedNodes.push(listNode)
        renderedNodes.push(
          <p
            key={`p-${index}`}
            className="text-sm md:text-sm text-[#3E3E3D] dark:text-[#EAE8E3] leading-relaxed my-2"
          >
            {parseInlineStyles(line)}
          </p>
        )
      }
    })

    // Render any remaining list or table
    // An unfinished fenced block used to disappear until its closing fence
    // arrived, making code responses look stuck while streaming. Show a stable
    // placeholder instead, then render the highlighted block once complete.
    if (inCodeBlock && isStreaming) {
      renderedNodes.push(<CodeBlockSkeleton key="code-streaming" language={codeBlockLang} />)
    }

    const finalListNode = renderList(`list-final`)
    if (finalListNode) renderedNodes.push(finalListNode)
    const finalTableNode = renderTable(`table-final`)
    if (finalTableNode) renderedNodes.push(finalTableNode)

    return renderedNodes
  }

  /** The answer text + latency/copy footer, shared between the default
   * assistant bubble and the Plan-mode card (Plan mode only changes the
   * framing around this, not the content itself). */
  const renderReplyBody = (
    message: Message,
    isStreaming: boolean,
    retry?: { onClick?: () => void; blockedReason?: string }
  ): React.JSX.Element => {
    const citedSources = message.sources?.filter((source) =>
      /^https?:\/\//i.test(source.url) && (!source.source_id ||
        new RegExp(`\\[(?:[SA]\\d+,\\s*)*${source.source_id}(?:,|\\])`).test(message.content))
    )
    return (
    <>
      <div data-reply className="selectable-text prose prose-neutral dark:prose-invert max-w-none text-[#2E2E2D] dark:text-[#EAE8E3]">
        <TypewriterText
          text={message.content}
          animate={!!message.isNew}
          isStreaming={isStreaming}
          onDone={() => onMessageRevealed(message.id)}
          render={(text) => parseMarkdownContent(text, isStreaming, message.sources, message.attachmentSources)}
        />
      </div>
      {message.attachmentSources?.length ? (
        <div className="my-2 text-xs text-muted-foreground">
          Attached-file evidence: {message.attachmentSources.map((item) =>
            `${item.source_id} ${item.filename} (${item.section})`
          ).join(' · ')}
        </div>
      ) : null}
      {!isStreaming && citedSources?.length ? (
        <div className="my-2 flex flex-wrap gap-1.5">
          {citedSources.map((source, index) => (
            <a key={source.source_id || index} href={source.url} target="_blank" rel="noreferrer"
              title={source.title}
              className="max-w-48 truncate rounded-full border border-[#E5E3DF] px-2 py-0.5 text-[11px] text-[#6E6D6A] hover:bg-[#F1EFEA] hover:text-[#2E2E2D] dark:border-[#2C2C2A] dark:text-[#9E9D9A] dark:hover:bg-[#2C2C2A] dark:hover:text-[#EAE8E3]">
              {source.source_id ? `${source.source_id} \u00b7 ` : ''}{source.host || source.url.replace(/^https?:\/\//i, '').split('/')[0]}
            </a>
          ))}
        </div>
      ) : null}
      <SourcePins sources={citedSources} />
      {message.draft && <DocumentDraftReview draft={message.draft} content={message.content} />}
      {message.runStatus === 'partial' && (
        <p className="text-xs text-amber-700 dark:text-amber-300">Partial research: {message.runPhase || 'some evidence was unavailable'}</p>
      )}
      {message.retryError && (
        <p role="status" className="text-xs text-amber-700 dark:text-amber-300">
          Retry failed, showing the original reply: {message.retryError}
        </p>
      )}
      <MemoryUsed memory={message.memory} openThread={openThread} />
      <div className="mt-1.5 flex items-center justify-between">
        <span className="text-[10px] text-[#9E9D9A] dark:text-[#6E6D6A]">
          {typeof message.latencyMs === 'number' ? `${(message.latencyMs / 1000).toFixed(1)}s` : ''}
        </span>
        {!isStreaming && (
          <div className="flex items-center gap-0.5">
            {retry && (
              <button
                type="button"
                onClick={retry.onClick}
                // aria-disabled (not disabled) so the explanatory tooltip still shows.
                aria-disabled={!retry.onClick}
                className={cn(
                  'p-1 rounded-md text-[#9E9D9A] dark:text-[#6E6D6A] transition-colors',
                  retry.onClick
                    ? 'hover:text-[#2E2E2D] dark:hover:text-[#EAE8E3] hover:bg-[#F1EFEA] dark:hover:bg-[#2C2C2A] cursor-pointer'
                    : 'cursor-not-allowed opacity-40'
                )}
                title={retry.blockedReason || 'Retry'}
                aria-label="Retry response"
              >
                <RotateCcw size={13} aria-hidden="true" />
              </button>
            )}
            <button
              type="button"
              aria-label="Copy response"
              title="Copy response"
              onClick={() => navigator.clipboard.writeText(message.content)}
              className="p-1 rounded-md text-[#9E9D9A] dark:text-[#6E6D6A] hover:text-[#2E2E2D] dark:hover:text-[#EAE8E3] hover:bg-[#F1EFEA] dark:hover:bg-[#2C2C2A] transition-colors cursor-pointer"
            >
              <HugeiconsIcon icon={Copy01Icon} size={13} />
            </button>
          </div>
        )}
      </div>
    </>
    )
  }

  const selectedModelObj = effectiveModel === 'auto'
    ? AUTO_MODEL
    : activeModels.find((m) => m.id === effectiveModel) || AUTO_MODEL
  const isAuto = selectedModelObj.id === 'auto'
  const visibleModels = activeModels.filter((model) =>
    `${model.name} ${model.desc}`.toLowerCase().includes(modelFilter.trim().toLowerCase())
  )
  const modelPicker = (
    <Popover.Root
      open={isModelDropdownOpen}
      onOpenChange={(open) => {
        setIsModelDropdownOpen(open)
        if (!open) setModelFilter('')
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          onClick={() => setIsModelDropdownOpen(true)}
          aria-label={`Model: ${activeModels.length ? selectedModelObj.name : 'Choose model'}`}
          title="Switch model for the next message"
          className="flex h-8 max-w-44 shrink-0 items-center gap-1.5 rounded-full border border-[#E5E3DF] px-2.5 text-xs font-medium text-[#2E2E2D] hover:bg-[#F1EFEA] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring dark:border-[#4d4d4d] dark:text-[#EAE8E3] dark:hover:bg-[#2C2C2A]"
        >
          {activeModels.length > 0 && (isAuto ? <Sparkles size={14} aria-hidden="true" /> : selectedModelObj.provider === 'local' ? <Cpu size={14} aria-hidden="true" /> : <Cloud size={14} aria-hidden="true" />)}
          <span className="truncate">{activeModels.length ? selectedModelObj.name : 'Choose model'}</span>
          <ChevronDown size={12} aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="end"
          sideOffset={8}
          aria-label="Choose model"
          className="z-50 w-72 max-w-[calc(100vw-2rem)] rounded-xl border border-[#E5E3DF] bg-[#FAF9F6] p-2 text-[#2E2E2D] shadow-md outline-none dark:border-[#2C2C2A] dark:bg-[#252523] dark:text-[#EAE8E3] motion-safe:animate-in motion-safe:fade-in"
        >
          <p className="px-2 pb-2 text-xs font-medium text-[#6E6D6A] dark:text-[#9E9D9A]">Model</p>
          <button
            type="button"
            aria-label="Auto"
            aria-pressed={isAuto}
            disabled={activeModels.length === 0}
            onClick={() => setSelectedModel('auto')}
            className="mb-1 flex w-full items-center gap-2 rounded-lg p-2 text-left text-sm hover:bg-[#F1EFEA] focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50 dark:hover:bg-[#2C2C2A]"
          >
            <Sparkles size={16} aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className="block">Auto</span>
              <span className="block text-[11px] text-[#6E6D6A] dark:text-[#9E9D9A]">
                {allowCloud ? 'Local first, then connected cloud models' : 'Local models only'}
              </span>
            </span>
            {isAuto && <Check size={14} aria-hidden="true" />}
          </button>
          {isAuto && (
            <label className="mb-2 flex items-center justify-between gap-2 rounded-lg px-2 py-1 text-xs">
              <span>Allow cloud models in Auto</span>
              <Switch
                aria-label="Allow cloud models in Auto"
                checked={allowCloud}
                onCheckedChange={(checked) => {
                  setAllowCloud(checked)
                  localStorage.setItem('atlas.autoAllowCloud', String(checked))
                }}
              />
            </label>
          )}
          <div className="flex items-center gap-2 rounded-lg border border-[#E5E3DF] px-2 dark:border-[#4d4d4d]">
            <Search size={15} className="shrink-0 text-[#6E6D6A]" aria-hidden="true" />
            <input
              type="search"
              aria-label="Filter models"
              placeholder="Filter models"
              value={modelFilter}
              onChange={(event) => setModelFilter(event.target.value)}
              className="min-w-0 w-full bg-transparent py-2 text-sm outline-none"
            />
          </div>
          <div className="mt-1 max-h-64 overflow-y-auto">
            {visibleModels.length > 0 ? visibleModels.map((model) => (
              <button
                key={model.id}
                type="button"
                aria-label={model.name}
                aria-pressed={selectedModel === model.id}
                onClick={() => {
                  setSelectedModel(model.id)
                  setIsModelDropdownOpen(false)
                  setModelFilter('')
                }}
                className="flex w-full items-center gap-2 rounded-lg p-2 text-left text-sm hover:bg-[#F1EFEA] focus-visible:outline-2 focus-visible:outline-ring dark:hover:bg-[#2C2C2A]"
              >
                {model.provider === 'local' ? <Cpu size={16} aria-hidden="true" /> : <Cloud size={16} aria-hidden="true" />}
                <span className="min-w-0 flex-1 truncate">{model.name}</span>
                {selectedModel === model.id && <Check size={14} aria-hidden="true" />}
              </button>
            )) : (
              <p className="p-2 text-xs text-[#6E6D6A] dark:text-[#9E9D9A]">
                {activeModels.length === 0 ? 'No providers connected — add one in Profile > Advanced.' : 'No matching models.'}
              </p>
            )}
          </div>
          <div className="mt-2 border-t border-[#E5E3DF] px-2 pt-2 dark:border-[#4d4d4d]">
            <label htmlFor="reasoning-level" className="flex justify-between text-xs font-medium">
              <span>{isAuto ? 'Reasoning limit' : 'Reasoning'}</span>
              <span className="text-[#6E6D6A] dark:text-[#9E9D9A]">{REASONING_LABELS[reasoning]}</span>
            </label>
            <input
              id="reasoning-level"
              type="range"
              min={0}
              max={REASONING_LEVELS.length - 1}
              step={1}
              value={REASONING_LEVELS.indexOf(reasoning)}
              aria-valuetext={REASONING_LABELS[reasoning]}
              onChange={(event) => {
                const level = REASONING_LEVELS[Number(event.target.value)]
                setReasoning(level)
                localStorage.setItem('atlas.reasoning', level)
              }}
              className="mt-1 w-full accent-[#2E2E2D] dark:accent-[#EAE8E3]"
            />
            <div aria-hidden="true" className="flex justify-between text-[10px] text-[#6E6D6A] dark:text-[#9E9D9A]">
              {REASONING_LEVELS.map((level) => <span key={level}>{REASONING_LABELS[level]}</span>)}
            </div>
            {isAuto && (
              <p className="mt-1 text-[10px] text-[#6E6D6A] dark:text-[#9E9D9A]">
                Auto picks less for simple messages and never goes above this.
              </p>
            )}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
  const providerDefaults: Record<string, string> = {
    openai: 'gpt-4o', anthropic: 'claude-sonnet-4-5', gemini: 'gemini-2.5-flash'
  }
  const supportsTools = (option: ModelOption): boolean =>
    (toolModels[option.provider] || []).includes(option.model || providerDefaults[option.provider] || '')
  // Auto can only reach a tool-capable model when cloud is allowed (local has no verified tool contract).
  const toolCallsAvailable = isAuto
    ? allowCloud && activeModels.some(supportsTools)
    : supportsTools(selectedModelObj)
  const imageGenerationAvailable = isAuto
    ? activeModels.some((m) => supportsImageGeneration(m.provider))
    : supportsImageGeneration(selectedModelObj.provider)

  return (
    <main className="flex-1 h-full flex flex-col bg-[#FAF9F6] dark:bg-[#171717] relative overflow-hidden">
      {/* Header */}
      <header className="relative h-14 px-4  flex items-center justify-between shrink-0 bg-[#FAF9F6] dark:bg-[#171717] z-10">
        <div className="flex items-center gap-3">
          {isSidebarCollapsed && (
            <button
              onClick={() => setIsSidebarCollapsed(false)}
              className="p-1.5 rounded-md hover:bg-[#F1EFEA] dark:hover:bg-[#2C2C2A] text-[#6E6D6A] dark:text-[#9E9D9A] hover:text-[#2E2E2D] dark:hover:text-[#EAE8E3] transition-colors cursor-pointer"
              title="Expand Sidebar"
            >
              <HugeiconsIcon icon={SidebarRightIcon} size={16} />
            </button>
          )}

        </div>

        {/* Centered Conversation Title */}
        <div className="absolute left-1/2 -translate-x-1/2 pointer-events-none select-none">
          {activeChat ? (
            <span className="font-semibold text-sm tracking-tight text-[#2E2E2D] dark:text-[#EAE8E3] truncate max-w-[200px] md:max-w-[400px]">
              {activeChat.title}
            </span>
          ) : (
            <span className="font-semibold text-sm tracking-tight text-[#2E2E2D] dark:text-[#EAE8E3]">
              New Session
            </span>
          )}
        </div>

        {/* Topbar Actions on the Right Corner */}
        <div className="flex items-center gap-2">
          <ThemeSwitch />
          {activeChat && (
            <>
              <button
                onClick={() => handleExportPdf(activeChat)}
                disabled={isExportingPdf || activeChat.messages.length === 0}
                className="p-1.5 rounded-lg hover:bg-[#F1EFEA] dark:hover:bg-[#2C2C2A] text-[#6E6D6A] dark:text-[#9E9D9A] hover:text-[#2E2E2D] dark:hover:text-[#EAE8E3] transition-colors cursor-pointer flex items-center justify-center shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
                title="Export as PDF"
              >
                <HugeiconsIcon icon={Share01Icon} size={16} />
              </button>
              <button
                onClick={() => onTogglePin(activeChat.id)}
                className={cn(
                  'p-1.5 rounded-lg hover:bg-[#F1EFEA] dark:hover:bg-[#2C2C2A] transition-colors cursor-pointer flex items-center justify-center shrink-0',
                  activeChat.isPinned
                    ? 'text-[#2E2E2D] dark:text-[#EAE8E3] bg-[#EAE8E3] dark:bg-[#2C2C2A]'
                    : 'text-[#6E6D6A] dark:text-[#9E9D9A] hover:text-[#2E2E2D] dark:hover:text-[#EAE8E3]'
                )}
                title={activeChat.isPinned ? 'Unpin Chat' : 'Pin Chat'}
              >
                <HugeiconsIcon
                  icon={PinIcon}
                  size={16}
                  className={activeChat.isPinned ? 'fill-[#2E2E2D] dark:fill-[#EAE8E3]' : ''}
                />
              </button>
            </>
          )}
          <button
            onClick={onNewChat}
            className="p-1.5 rounded-lg hover:bg-[#F1EFEA] dark:hover:bg-[#2C2C2A] text-[#6E6D6A] dark:text-[#9E9D9A] hover:text-[#2E2E2D] dark:hover:text-[#EAE8E3] transition-colors cursor-pointer flex items-center justify-center shrink-0"
            title="New Chat"
          >
            <HugeiconsIcon icon={Message01Icon} size={16} />
          </button>
        </div>
      </header>
      {providerLoadError && (
        <p role="alert" className="px-4 py-2 text-xs text-red-600">
          {providerLoadError}
        </p>
      )}

      {/* Main Messaging Area */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto no-scrollbar py-6 md:py-4 px-4 md:px-8"
      >
        <div className="max-w-3xl mx-auto h-full flex flex-col">
          {!activeChat || activeChat.messages.length === 0 ? (
            /* Empty State: Premium Minimal Welcome Screen */
            <div className="flex-1 flex flex-col justify-center items-center text-center w-full space-y-4 select-none">
              <div className="max-w-xl space-y-4">
                {/* Clean large icon logo */}

                <GradientWaveText ariaLabel="intro text" className="text-2xl font-semibold tracking-tight text-[#5e5e5e] dark:text-[#EAE8E3] mb-2 min-h-[1em]">
                  Hey welcome back, what&apos;s in your mind today?
                </GradientWaveText>
              </div>

              {/* Render centered PromptBox when chat has no messages */}
              <div className="w-full max-w-3xl">
                <PromptBox
                  onSubmitPrompt={handlePromptSubmit}
                  modelPicker={modelPicker}
                  canSend={activeModels.length > 0}
                  toolCallsAvailable={toolCallsAvailable}
                  imageGenerationAvailable={imageGenerationAvailable}
                  intent={composerPreference?.intent}
                  draftKind={composerPreference?.draftKind}
                  onIntentChange={(intent: ChatIntent) => onComposerChange?.({ intent })}
                  onDraftKindChange={(draftKind) => onComposerChange?.({ draftKind })}
                />
              </div>

              {/* Grid of Starters
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full text-left pt-2">
                {STARTER_PROMPTS.map((starter, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      if (!activeChat) {
                        onNewChat()
                        // Small timeout to let new chat instantiate before sending
                        setTimeout(() => onSendMessage(starter.prompt, false), 50)
                      } else {
                        onSendMessage(starter.prompt, false)
                      }
                    }}
                    className="p-3.5 rounded-xl border border-[#E5E3DF] hover:border-[#D1CFCB] bg-[#FAF9F6] hover:bg-[#F1EFEA]/40 transition-all cursor-pointer flex flex-col text-left group"
                  >
                    <span className="text-sm font-semibold text-[#2E2E2D] group-hover:underline">
                      {starter.title}
                    </span>
                    <span className="text-[10px] text-[#6E6D6A] mt-1.5 line-clamp-2 leading-relaxed">
                      {starter.prompt}
                    </span>
                  </button>
                ))}
              </div> */}
            </div>
          ) : (
            /* Messages List */
            <div className="flex-1 space-y-6">
              {/* The streaming assistant message is pushed (with empty
                  content) before any tokens arrive, then grows in place --
                  once it has real content, the "still thinking" placeholder
                  below would just be a redundant second "response" sitting
                  under the one already streaming in, so hide it as soon as
                  real text starts showing. */}
              {(() => {
                const lastMessage = activeChat.messages[activeChat.messages.length - 1]
                const showPendingIndicator =
                  activeChat.isSending &&
                  (!lastMessage || lastMessage.sender !== 'assistant' || (lastMessage.content === '' && !lastMessage.thinking))

                return (
                  <>
                    {activeChat.messages.map((message, messageIndex) => {
                      const isStreamingMessage =
                        !!activeChat.isSending &&
                        message.sender === 'assistant' &&
                        message.id === lastMessage?.id
                      const isSettledLast = !activeChat.isSending && message.id === lastMessage?.id
                      const prompt = activeChat.messages[messageIndex - 1]
                      const retry = isSettledLast && message.sender === 'assistant' && prompt?.sender === 'user'
                        ? prompt.attachments?.length
                          // Attachment contents aren't stored with the chat, so this
                          // turn can't be replayed faithfully.
                          ? { blockedReason: "Can't retry: attachments aren't stored with the chat" }
                          : { onClick: onRetryMessage && (() => onRetryMessage(message.id)) }
                        : undefined
                      const runsApprovedPlan = prompt?.attachments?.some(
                        (att) => att.kind === 'file' && att.name === APPROVED_PLAN_FILE
                      )
                      const steps = message.tool === 'thinkLonger' ? planSteps(message.content) : []
                      const excluded = excludedSteps[message.id] || []

                      // The empty placeholder pushed before any tokens arrive would
                      // otherwise render as its own near-empty bubble alongside the
                      // "Thinking..." indicator below -- skip it until real content
                      // (or an error) lands, since the indicator already covers this state.
                      if (isStreamingMessage && message.content === '' && !message.thinking) return null

                      return (
                        <div
                          key={message.id}
                          className={cn(
                            'flex gap-3.5 md:gap-5 pb-4',
                            message.sender === 'user' ? 'justify-end' : 'justify-start'
                          )}
                        >
                          {message.sender === 'assistant' && (
                            <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 select-none">
                              <HugeiconsIcon icon={Message01Icon} size={16} className="text-[#6E6D6A] dark:text-[#9E9D9A]" />
                            </div>
                          )}

                          <div
                            className={cn(
                              'max-w-[85%] md:max-w-[75%]',
                              message.sender === 'user'
                                ? 'bg-[#F1EFEA] dark:bg-[#2C2C2A] border border-[#E5E3DF]/50 dark:border-[#2C2C2A] px-4 py-2 rounded-2xl text-[#2E2E2D] dark:text-[#EAE8E3]'
                                : 'flex-1'
                            )}
                          >
                            {message.sender === 'user' ? (
                              <>
                                <AttachmentBlocks attachments={message.attachments} />
                                {message.content && (
                                  <p className="selectable-text text-sm md:text-sm leading-relaxed whitespace-pre-wrap">
                                    {message.content}
                                  </p>
                                )}
                              </>
                            ) : message.tool === 'thinkLonger' ? (
                              <>
                                <AttachmentBlocks attachments={message.attachments} />
                                <TraceChips trace={message.trace} isStreaming={isStreamingMessage} />
                                <ThinkingBlock thinking={message.thinking} isLive={isStreamingMessage}
                                  isThinking={isStreamingMessage && !message.content} />
                                <Plan key={message.planStatus === 'dismissed' ? 'closed' : 'open'}
                                  defaultOpen={message.planStatus !== 'dismissed'} isStreaming={isStreamingMessage}>
                                  <PlanHeader>
                                    <PlanTitle>{message.planStatus ? `Plan \u00b7 ${message.planStatus}` : 'Plan mode'}</PlanTitle>
                                    <PlanTrigger />
                                  </PlanHeader>
                                  <PlanContent>
                                    {renderReplyBody(message, isStreamingMessage, retry)}
                                  </PlanContent>
                                  {isSettledLast && !message.planStatus && message.content &&
                                    !message.content.startsWith('**Error:**') && (
                                    <PlanFooter className="flex-col items-stretch gap-3">
                                      {steps.length > 1 && (
                                        <fieldset className="space-y-1">
                                          <legend className="mb-1 text-xs font-medium">Steps to run</legend>
                                          {steps.map((step) => (
                                            <label key={step.number} className="flex items-start gap-2 text-xs">
                                              <input type="checkbox" className="mt-0.5"
                                                checked={!excluded.includes(step.number)}
                                                onChange={(event) => setExcludedSteps((prev) => ({
                                                  ...prev,
                                                  [message.id]: event.target.checked
                                                    ? excluded.filter((n) => n !== step.number)
                                                    : [...excluded, step.number]
                                                }))} />
                                              <span className="line-clamp-2">{step.number}. {step.text}</span>
                                            </label>
                                          ))}
                                        </fieldset>
                                      )}
                                      <div className="flex flex-wrap gap-2">
                                        <button
                                          type="button"
                                          disabled={steps.length > 0 && excluded.length >= steps.length}
                                          onClick={() => approvePlan(message, excluded)}
                                          className="rounded-lg bg-[#2E2E2D] px-3 py-1.5 text-xs font-medium text-[#FAF9F6] hover:bg-[#1A1A19] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-40 dark:bg-[#EAE8E3] dark:text-[#171717] dark:hover:bg-white cursor-pointer"
                                        >
                                          Approve &amp; run
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            onPlanStatus?.(message.id, 'revising')
                                            onComposerChange?.({ intent: 'plan' })
                                            promptRef.current?.focus()
                                          }}
                                          className="rounded-lg border border-[#E5E3DF] px-3 py-1.5 text-xs font-medium hover:bg-[#F1EFEA] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring dark:border-[#2C2C2A] dark:hover:bg-[#2C2C2A] cursor-pointer"
                                        >
                                          Revise plan
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => {
                                            onPlanStatus?.(message.id, 'dismissed')
                                            onComposerChange?.({ intent: 'auto' })
                                          }}
                                          className="rounded-lg px-3 py-1.5 text-xs font-medium text-[#6E6D6A] hover:bg-[#F1EFEA] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring dark:text-[#9E9D9A] dark:hover:bg-[#2C2C2A] cursor-pointer"
                                        >
                                          Dismiss
                                        </button>
                                      </div>
                                    </PlanFooter>
                                  )}
                                </Plan>
                              </>
                            ) : (
                              <>
                                <AttachmentBlocks attachments={message.attachments} />
                                {message.routeReason && (
                                  <p className="mb-2 text-xs text-muted-foreground">Auto route: {message.routeReason}</p>
                                )}
                                {runsApprovedPlan && (
                                  <p className="mb-2 text-xs text-muted-foreground">
                                    {message.tool === 'safeTools'
                                      ? 'Running plan with tools'
                                      : "Running plan as chat (model can't use tools)"}
                                  </p>
                                )}
                                <SearchTrace tool={message.tool} sources={message.sources}
                                  queries={message.queries} researchPlan={message.researchPlan} />
                                <TraceChips trace={message.trace} isStreaming={isStreamingMessage} />
                                <ThinkingBlock thinking={message.thinking} isLive={isStreamingMessage}
                                  isThinking={isStreamingMessage && !message.content} />
                                {renderReplyBody(message, isStreamingMessage, retry)}
                              </>
                            )}
                          </div>

                          {message.sender === 'user' && (
                            <div className="w-8 h-8 rounded-full bg-[#EAE8E3] dark:bg-[#2C2C2A] border border-[#E5E3DF] dark:border-[#2C2C2A] flex items-center justify-center shrink-0 select-none">
                              <HugeiconsIcon
                                icon={UserIcon}
                                size={18}
                                className="text-[#6E6D6A] dark:text-[#9E9D9A]"
                              />
                            </div>
                          )}
                        </div>
                      )
                    })}

                    {showPendingIndicator && (
                      <div className="flex gap-3.5 md:gap-5 pb-4 justify-start">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 select-none">
                          <HugeiconsIcon icon={Message01Icon} size={16} className="text-[#6E6D6A] dark:text-[#9E9D9A]" />
                        </div>
                        <div className="flex-1 flex items-center py-2">
                          {activeChat.isGeneratingImage ? (
                            <div className="w-full max-w-56 aspect-[4/3] rounded-xl bg-[#EAE8E3] dark:bg-[#2C2C2A] overflow-hidden relative">
                              <div className="skeleton-shimmer absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/40 dark:via-white/10 to-transparent" />
                            </div>
                          ) : lastMessage?.runPhase ? (
                            <span className="text-sm text-muted-foreground">{lastMessage.runPhase}</span>
                          ) : (
                            <LoadingState key={activeChat.id} />
                          )}
                        </div>
                      </div>
                    )}
                  </>
                )
              })()}

              <div ref={messagesEndRef} />
            </div>
          )}
        </div>
      </div>

      {selection && (
        <div role="toolbar" aria-label="Selection actions"
          style={{ top: selection.top, left: selection.left }}
          className="fixed z-30 flex -translate-x-1/2 gap-0.5 rounded-lg border border-[#E5E3DF] bg-[#FAF9F6] p-0.5 shadow-md dark:border-[#2C2C2A] dark:bg-[#252523]">
          {([
            ['Explain', 'Explain this part of your reply in simpler terms:'],
            ['Shorten', 'Rewrite this part of your reply more concisely:'],
            ['Ask', null]
          ] as const).map(([label, instruction]) => (
            <button key={label} type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => sendSelectionAction(instruction)}
              className="rounded-md px-2.5 py-1 text-xs font-medium text-[#2E2E2D] hover:bg-[#F1EFEA] focus-visible:outline-2 focus-visible:outline-ring dark:text-[#EAE8E3] dark:hover:bg-[#2C2C2A] cursor-pointer">
              {label}
            </button>
          ))}
        </div>
      )}

      {activeChat && activeChat.messages.length > 0 && showScrollButton && (
        <button
          onClick={() => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })}
          className="absolute bottom-40 left-1/2 -translate-x-1/2 z-20 w-9 h-9 rounded-full bg-[#FAF9F6]/10 dark:bg-[#252523]/10 backdrop-blur-md shadow-[inset_0_0_4px_4px_rgba(23,23,23,0.1)] border border-[#E5E3DF] dark:border-[#2C2C2A]  flex items-center justify-center text-[#6E6D6A] dark:text-[#9E9D9A] hover:text-[#2E2E2D] dark:hover:text-[#EAE8E3] hover:bg-[#F1EFEA]/10 dark:hover:bg-[#2C2C2A]/10 transition-colors cursor-pointer"
          title="Scroll to bottom"
        >
          <HugeiconsIcon icon={ArrowDown} size={16} />
        </button>
      )}

      {/* Floating Chat Input Section (only shown when chat has messages) */}
      {activeChat && activeChat.messages.length > 0 && (
        <div className="shrink-0 z-10 pt-4 pb-6 px-4 md:px-8">
          <div className="max-w-3xl mx-auto">
            <PromptBox
              ref={promptRef}
              prefill={prefill}
              onSubmitPrompt={handlePromptSubmit}
              modelPicker={modelPicker}
              canSend={activeModels.length > 0}
              isBusy={activeChat.isSending}
              toolCallsAvailable={toolCallsAvailable}
              imageGenerationAvailable={imageGenerationAvailable}
              intent={composerPreference?.intent}
              draftKind={composerPreference?.draftKind}
              onIntentChange={(intent: ChatIntent) => onComposerChange?.({ intent })}
              onDraftKindChange={(draftKind) => onComposerChange?.({ draftKind })}
              onStop={() => onStopSending(activeChat.id)}
            />
          </div>
        </div>
      )}
      {/* Ambient glowing bar at the absolute bottom
      <div className="absolute bottom-0 left-0 right-0 h-[5px]  ambient-glow-line z-0 pointer-events-none" /> */}
    </main>
  )
}
