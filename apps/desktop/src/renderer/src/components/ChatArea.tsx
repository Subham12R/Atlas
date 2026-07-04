import React, { useState, useRef, useEffect } from 'react'
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
import { chatToHtml } from '@/lib/exportHtml'
import { PromptBox, fileIcon, type Attachment } from '@/components/ui/chatgpt-prompt-input'
import { Reasoning, ReasoningTrigger, ReasoningContent } from '@/components/ai/reasoning'
import { Task, TaskTrigger, TaskContent, TaskItem } from '@/components/ai/task'
import { Plan, PlanHeader, PlanTitle, PlanTrigger, PlanContent } from '@/components/ai/plan'
import { Sources, SourcesTrigger, SourcesContent, Source } from '@/components/ai/sources'
import { getProviderSettings, type ProviderSettingsMap } from '@/lib/api'
import ThemeSwitch from '@/components/ui/theme-switch'
import geminiLogo from '@/assets/icon/gemini.svg'
import openaiLogo from '@/assets/icon/openai.svg'
import claudeLogo from '@/assets/icon/claude.png'
import openRouterLogo from '@/assets/icon/openrouter.svg'
import ollamaLogo from '@/assets/icon/ollama.png'
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

export interface Message {
  id: string
  sender: 'user' | 'assistant'
  content: string
  timestamp: string
  provider?: string
  latencyMs?: number
  /** Marks a just-arrived assistant reply so ChatArea typewriter-reveals it
   * once; historical messages (loaded, not freshly received) render instantly. */
  isNew?: boolean
  /** Reasoning/thinking trace, when a provider exposes one. Not populated by
   * any adapter yet -- the display is ready for when one is wired up. */
  thinking?: string
  /** Uploaded/generated attachments, rendered as blocks above the text. */
  attachments?: MessageAttachment[]
  /** Sources consulted for a Search-web/Research-mode reply -- rendered as
   * circular favicon pins below the response text. */
  sources?: { title: string; url: string }[]
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
  sessionId: string | null
  threadId: string | null
  isSending?: boolean
  /** The in-flight request is generating an image -- shows a 4:3 skeleton
   * instead of the text "Thinking..." indicator while isSending is true. */
  isGeneratingImage?: boolean
}

interface ChatAreaProps {
  isSidebarCollapsed: boolean
  setIsSidebarCollapsed: (collapsed: boolean) => void
  activeChat: Chat | null
  onSendMessage: (
    content: string,
    tool: string | null,
    provider: string,
    attachments: Attachment[]
  ) => void
  onNewChat: () => void
  onTogglePin: (id: string) => void
  onMessageRevealed: (messageId: string) => void
  onStopSending: (chatId: string) => void
}

const MODELS = [
  { id: 'openai', name: 'OpenAI', desc: 'GPT models via official API', logo: openaiLogo },
  { id: 'anthropic', name: 'Anthropic', desc: 'Claude models via official API', logo: claudeLogo },
  { id: 'gemini', name: 'Gemini', desc: 'Google Gemini via official API', logo: geminiLogo },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    desc: 'Any model, routed through OpenRouter',
    logo: openRouterLogo
  },
  { id: 'local', name: 'Ollama', desc: 'Your own local model (Ollama, ...)', logo: ollamaLogo }
]

/** Providers without a bundled logo image (OpenRouter, Local) fall back to a
 * simple initials badge instead of an <img>. */
function ProviderLogo({
  name,
  logo,
  className
}: {
  id: string
  name: string
  logo: string | null
  className: string
}): React.JSX.Element {
  if (logo) return <img src={logo} alt="" className={cn('object-contain', className)} />
  return (
    <div
      className={cn(
        'rounded-md bg-[#EAE8E3] dark:bg-[#2C2C2A] text-[#6E6D6A] dark:text-[#9E9D9A] flex items-center justify-center font-semibold text-[9px] shrink-0',
        className
      )}
      title={name}
    >
      {name.substring(0, 2).toUpperCase()}
    </div>
  )
}

const THINKING_VERBS = ['Thinking', 'Reasoning', 'Composing', 'Considering', 'Drafting']

/** Collapsible reasoning-trace panel, shown above the reply when a provider
 * supplies one. No adapter populates `thinking` yet -- this stays inert
 * (renders nothing) until reasoning-model streaming is wired up. */
function ThinkingBlock({ thinking }: { thinking?: string }): React.JSX.Element | null {
  if (!thinking) return null

  return (
    <Reasoning defaultOpen={false}>
      <ReasoningTrigger />
      <ReasoningContent>{thinking}</ReasoningContent>
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
  sources
}: {
  tool?: string
  sources?: { title: string; url: string }[]
}): React.JSX.Element | null {
  if ((tool !== 'searchWeb' && tool !== 'deepResearch') || !sources || sources.length === 0) {
    return null
  }

  return (
    <Task defaultOpen={false}>
      <TaskTrigger title={tool === 'deepResearch' ? 'Researched the web' : 'Searched the web'} />
      <TaskContent>
        {sources.map((s, i) => (
          <TaskItem key={i}>
            <a
              href={s.url}
              target="_blank"
              rel="noreferrer"
              className="hover:text-[#2E2E2D] dark:hover:text-[#EAE8E3] hover:underline"
            >
              {s.title || s.url}
            </a>
          </TaskItem>
        ))}
      </TaskContent>
    </Task>
  )
}

/** Collapsible "Used N sources" list for a Search-web/Research-mode reply's
 * citations, shown below the response text. */
function SourcePins({
  sources
}: {
  sources?: { title: string; url: string }[]
}): React.JSX.Element | null {
  if (!sources || sources.length === 0) return null

  return (
    <Sources>
      <SourcesTrigger count={sources.length} />
      <SourcesContent>
        {sources.map((s, i) => (
          <Source key={i} href={s.url} title={s.title || s.url} />
        ))}
      </SourcesContent>
    </Sources>
  )
}

function ThinkingIndicator(): React.JSX.Element {
  const [verbIndex, setVerbIndex] = useState(0)

  useEffect(() => {
    const id = setInterval(() => {
      setVerbIndex((i) => (i + 1) % THINKING_VERBS.length)
    }, 1600)
    return () => clearInterval(id)
  }, [])

  return <span className="shimmer-text text-sm font-medium">{THINKING_VERBS[verbIndex]}...</span>
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
  onSendMessage,
  onNewChat,
  onTogglePin,
  onMessageRevealed,
  onStopSending
}: ChatAreaProps): React.JSX.Element {
  const [selectedModel, setSelectedModel] = useState('openai')
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false)
  const [isExportingPdf, setIsExportingPdf] = useState(false)
  const [showScrollButton, setShowScrollButton] = useState(false)
  const [providerSettings, setProviderSettings] = useState<ProviderSettingsMap>({})
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Only providers the user has actually connected (an API key, or "local"
  // which never needs one) show up as pickable models -- everything else
  // stays in Profile's Advanced section until it's configured there.
  useEffect(() => {
    const refresh = (): void => {
      getProviderSettings()
        .then(setProviderSettings)
        .catch(() => {})
    }
    refresh()
    window.addEventListener('providers:updated', refresh)
    return () => window.removeEventListener('providers:updated', refresh)
  }, [])

  const activeModels = MODELS.filter((m) => providerSettings[m.id]?.configured)

  const handleScroll = (): void => {
    const el = scrollContainerRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    setShowScrollButton(distanceFromBottom > 150)
  }

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
    if (activeChat?.provider) setSelectedModel(activeChat.provider)
  }

  // A brand-new chat (no provider bound yet) shouldn't default to a provider
  // the user hasn't actually connected -- once settings load, fall back to
  // the first active one instead of the hardcoded initial guess.
  useEffect(() => {
    if (activeChat?.provider) return
    if (activeModels.length === 0) return
    if (activeModels.some((m) => m.id === selectedModel)) return
    setSelectedModel(activeModels[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeModels, activeChat?.provider])

  const effectiveModel = selectedModel

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [activeChat?.messages, activeChat?.isSending])

  const handlePromptSubmit = (
    text: string,
    selectedTool: string | null,
    attachments: Attachment[]
  ): void => {
    onSendMessage(text, selectedTool, effectiveModel, attachments)
  }

  // Custom typography parser for markdown-like formatting
  const parseMarkdownContent = (text: string): React.ReactNode[] => {
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

      // Match bold (**text**) or code (`code`)
      const regex = /(\*\*([^*]+)\*\*|`([^`]+)`)/g
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
          // Code inline
          parts.push(
            <code
              key={index++}
              className="px-1.5 py-0.5 bg-[#F1EFEA] dark:bg-[#2A2A28] text-[#1A1A19] dark:text-[#EAE8E3] font-mono text-[11px] rounded-md border border-[#E5E3DF]/50 dark:border-[#2C2C2A]/50"
            >
              {match[3]}
            </code>
          )
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
                <button
                  onClick={() => navigator.clipboard.writeText(source)}
                  className="hover:text-[#2E2E2D] dark:hover:text-[#EAE8E3] transition-colors cursor-pointer"
                >
                  Copy code
                </button>
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

      // Check for headings
      if (line.startsWith('# ')) {
        const listNode = renderList(`list-${index}`)
        if (listNode) renderedNodes.push(listNode)
        renderedNodes.push(
          <h1
            key={`h1-${index}`}
            className="text-lg font-semibold tracking-tight text-[#1A1A19] dark:text-[#EAE8E3] mt-6 mb-2"
          >
            {parseInlineStyles(line.substring(2))}
          </h1>
        )
        return
      }
      if (line.startsWith('## ')) {
        const listNode = renderList(`list-${index}`)
        if (listNode) renderedNodes.push(listNode)
        renderedNodes.push(
          <h2
            key={`h2-${index}`}
            className="text-base font-semibold tracking-tight text-[#1A1A19] dark:text-[#EAE8E3] mt-5 mb-2"
          >
            {parseInlineStyles(line.substring(3))}
          </h2>
        )
        return
      }
      if (line.startsWith('### ')) {
        const listNode = renderList(`list-${index}`)
        if (listNode) renderedNodes.push(listNode)
        renderedNodes.push(
          <h3
            key={`h3-${index}`}
            className="text-sm font-semibold tracking-tight text-[#1A1A19] dark:text-[#EAE8E3] mt-4 mb-1.5"
          >
            {parseInlineStyles(line.substring(4))}
          </h3>
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
    const finalListNode = renderList(`list-final`)
    if (finalListNode) renderedNodes.push(finalListNode)
    const finalTableNode = renderTable(`table-final`)
    if (finalTableNode) renderedNodes.push(finalTableNode)

    return renderedNodes
  }

  /** The answer text + latency/copy footer, shared between the default
   * assistant bubble and the Plan-mode card (Plan mode only changes the
   * framing around this, not the content itself). */
  const renderReplyBody = (message: Message, isStreaming: boolean): React.JSX.Element => (
    <>
      <div className="selectable-text prose prose-neutral dark:prose-invert max-w-none text-[#2E2E2D] dark:text-[#EAE8E3]">
        <TypewriterText
          text={message.content}
          animate={!!message.isNew}
          isStreaming={isStreaming}
          onDone={() => onMessageRevealed(message.id)}
          render={parseMarkdownContent}
        />
      </div>
      <SourcePins sources={message.sources} />
      <div className="mt-1.5 flex items-center justify-between">
        <span className="text-[10px] text-[#9E9D9A] dark:text-[#6E6D6A]">
          {typeof message.latencyMs === 'number' ? `${(message.latencyMs / 1000).toFixed(1)}s` : ''}
        </span>
        <button
          onClick={() => navigator.clipboard.writeText(message.content)}
          className="p-1 rounded-md text-[#9E9D9A] dark:text-[#6E6D6A] hover:text-[#2E2E2D] dark:hover:text-[#EAE8E3] hover:bg-[#F1EFEA] dark:hover:bg-[#2C2C2A] transition-colors cursor-pointer"
          title="Copy response"
        >
          <HugeiconsIcon icon={Copy01Icon} size={13} />
        </button>
      </div>
    </>
  )

  const selectedModelObj = MODELS.find((m) => m.id === effectiveModel) || MODELS[0]

  return (
    <main className="flex-1 h-full flex flex-col bg-[#FAF9F6] dark:bg-[#1E1E1C] relative overflow-hidden">
      {/* Header */}
      <header className="relative h-14 px-4  flex items-center justify-between shrink-0 bg-[#FAF9F6] dark:bg-[#1E1E1C] z-10">
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

          {/* Model Selector Dropdown */}
          <div className="relative">
            <button
              onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
              title="Switch model for the next message"
              className="h-8 px-2 rounded-lg text-sm font-semibold text-[#2E2E2D] dark:text-[#EAE8E3] transition-colors flex items-center gap-1.5 font-sans hover:bg-[#F1EFEA] dark:hover:bg-[#2C2C2A] cursor-pointer"
            >
              <ProviderLogo
                id={selectedModelObj.id}
                name={selectedModelObj.name}
                logo={selectedModelObj.logo}
                className="rounded-sm w-6 h-6"
              />
              <span>{selectedModelObj.name}</span>
              <HugeiconsIcon
                icon={ArrowDown}
                size={12}
                className="text-[#6E6D6A] dark:text-[#9E9D9A]"
              />
            </button>

            {isModelDropdownOpen && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setIsModelDropdownOpen(false)} />
                <div className="absolute left-0 mt-1.5 w-60 rounded-xl border border-[#E5E3DF] dark:border-[#2C2C2A] bg-[#FAF9F6] dark:bg-[#252523] shadow-md p-1.5 z-30 animate-in fade-in slide-in-from-top-1 duration-150">
                  {activeModels.length === 0 ? (
                    <p className="p-2 text-xs text-[#6E6D6A] dark:text-[#9E9D9A] leading-relaxed">
                      No providers connected yet -- add an API key under Profile &gt; Advanced.
                    </p>
                  ) : (
                    activeModels.map((model) => (
                      <button
                        key={model.id}
                        onClick={() => {
                          setSelectedModel(model.id)
                          setIsModelDropdownOpen(false)
                        }}
                        className={cn(
                          'w-full text-left p-2 rounded-lg transition-colors cursor-pointer flex items-center gap-2',
                          selectedModel === model.id
                            ? 'bg-[#EAE8E3] dark:bg-[#2C2C2A] text-[#2E2E2D] dark:text-[#EAE8E3]'
                            : 'hover:bg-[#F1EFEA] dark:hover:bg-[#2C2C2A] text-[#6E6D6A] dark:text-[#9E9D9A] hover:text-[#2E2E2D] dark:hover:text-[#EAE8E3]'
                        )}
                      >
                        <ProviderLogo
                          id={model.id}
                          name={model.name}
                          logo={model.logo}
                          className="rounded-md shrink-0 w-6 h-6"
                        />
                        <div className="flex flex-col gap-0.5">
                          <span className="text-sm font-semibold">{model.name}</span>
                          <span className="text-[10px] opacity-80 leading-normal">
                            {model.desc}
                          </span>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </>
            )}
          </div>
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

                <h2 className="text-2xl font-semibold tracking-tight text-[#2E2E2D] dark:text-[#EAE8E3] mb-2">
                  Hey welcome back, what&apos;s in your mind today?
                </h2>
              </div>

              {/* Render centered PromptBox when chat has no messages */}
              <div className="w-full max-w-3xl">
                <PromptBox onSubmitPrompt={handlePromptSubmit} />
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
                  (!lastMessage || lastMessage.sender !== 'assistant' || lastMessage.content === '')

                return (
                  <>
                    {activeChat.messages.map((message) => {
                      const respondingModel = MODELS.find((m) => m.id === message.provider)
                      const isStreamingMessage =
                        !!activeChat.isSending &&
                        message.sender === 'assistant' &&
                        message.id === lastMessage?.id

                      // The empty placeholder pushed before any tokens arrive would
                      // otherwise render as its own near-empty bubble alongside the
                      // "Thinking..." indicator below -- skip it until real content
                      // (or an error) lands, since the indicator already covers this state.
                      if (isStreamingMessage && message.content === '') return null

                      return (
                        <div
                          key={message.id}
                          className={cn(
                            'flex gap-3.5 md:gap-5 pb-4',
                            message.sender === 'user' ? 'justify-end' : 'justify-start'
                          )}
                        >
                          {message.sender === 'assistant' && (
                            <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 select-none overflow-hidden">
                              {respondingModel ? (
                                <ProviderLogo
                                  id={respondingModel.id}
                                  name={respondingModel.name}
                                  logo={respondingModel.logo}
                                  className="w-6 h-6"
                                />
                              ) : (
                                <HugeiconsIcon
                                  icon={Message01Icon}
                                  size={16}
                                  className="text-[#6E6D6A] dark:text-[#9E9D9A]"
                                />
                              )}
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
                                <ThinkingBlock thinking={message.thinking} />
                                <Plan defaultOpen>
                                  <PlanHeader>
                                    <PlanTitle>Plan mode</PlanTitle>
                                    <PlanTrigger />
                                  </PlanHeader>
                                  <PlanContent>
                                    {renderReplyBody(message, isStreamingMessage)}
                                  </PlanContent>
                                </Plan>
                              </>
                            ) : (
                              <>
                                <AttachmentBlocks attachments={message.attachments} />
                                <SearchTrace tool={message.tool} sources={message.sources} />
                                <ThinkingBlock thinking={message.thinking} />
                                {renderReplyBody(message, isStreamingMessage)}
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
                        <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 select-none overflow-hidden">
                          {(() => {
                            const pendingModel = MODELS.find((m) => m.id === activeChat.provider)
                            return pendingModel ? (
                              <ProviderLogo
                                id={pendingModel.id}
                                name={pendingModel.name}
                                logo={pendingModel.logo}
                                className="w-6 h-6"
                              />
                            ) : (
                              <HugeiconsIcon
                                icon={Message01Icon}
                                size={16}
                                className="text-[#6E6D6A] dark:text-[#9E9D9A]"
                              />
                            )
                          })()}
                        </div>
                        <div className="flex-1 flex items-center py-2">
                          {activeChat.isGeneratingImage ? (
                            <div className="w-full max-w-56 aspect-[4/3] rounded-xl bg-[#EAE8E3] dark:bg-[#2C2C2A] overflow-hidden relative">
                              <div className="skeleton-shimmer absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/40 dark:via-white/10 to-transparent" />
                            </div>
                          ) : (
                            <ThinkingIndicator />
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
              onSubmitPrompt={handlePromptSubmit}
              isBusy={activeChat.isSending}
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
