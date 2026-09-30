import React, { useEffect, useRef, useState } from 'react'
import Sidebar from '@/components/Sidebar'
import ChatArea, { Chat, Message, MessageAttachment } from '@/components/ChatArea'
import Library from '@/components/Library'
import Profile from '@/components/Profile'
import Help from '@/components/Help'
import type { Attachment, FileAttachment } from '@/components/ui/chatgpt-prompt-input'
import { modeForTool, type AgentEvent } from '@/lib/agent-events.mjs'
import type { ExecutionMode } from '@/lib/modes'
import { supportsImageGeneration, type ComposerPreference } from '@/lib/chat-intent'

interface UserProfile {
  name: string
  avatarDataUrl: string | null
  memoryPrompt?: string
  responseStyle?: string
  email?: string
}

type View = 'chat' | 'library' | 'profile' | 'help'
import {
  ApiAborted,
  ApiError,
  closeSession,
  createSession,
  friendlyErrorMessage,
  generateImage,
  routeTurn,
  sendMessageStream,
  sendAgentStream,
  type DraftKind,
  type ImagePayload,
  type MemoryRecall
} from '@/lib/api'

function timestamp(): string {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

// A plain-text image request ("draw me a cat", "generate an image of...")
// still needs to route to real image generation -- otherwise a text model
// just hallucinates a bracketed description ("[Image of a cat...]") since it
// has no way to render an image inline. Not exhaustive; anything phrased
// differently still needs the explicit Generate Image button.
const IMAGE_INTENT_RE =
  /\b(generate|create|make|draw|paint|design|render)\b[^.!?\n]{0,40}\b(image|picture|photo|photograph|illustration|artwork|drawing|wallpaper|icon|logo)\b/i

function detectImageIntent(content: string): boolean {
  return IMAGE_INTENT_RE.test(content)
}

/** Inlines attached text files as fenced blocks after the prompt text -- the
 * only channel a non-vision file's content can reach the model through.
 * Images are handled separately (sent as real vision content, see `images`
 * in handleSendMessage) and never inlined here. */
function applyAttachments(content: string, attachments: Attachment[]): string {
  const files = attachments.filter((a): a is FileAttachment => a.kind === 'file')
  if (files.length === 0) return content
  const blocks = files.map((a) => `File: ${a.name}\n\`\`\`\n${a.content}\n\`\`\``).join('\n\n')
  return `${content}\n\n${blocks}`
}

/** Splits a data: URL into base64 + mime for the wire payload. */
function splitDataUrl(dataUrl: string): { data: string; mime: string } {
  const match = /^data:([^;]+);base64,(.*)$/s.exec(dataUrl)
  return match ? { mime: match[1], data: match[2] } : { mime: 'image/png', data: '' }
}

/** Last 2 exchanges (up to 4 messages) of the chat so far, handed to a newly
 * switched-to provider as a one-time bootstrap -- not re-injected on every
 * later turn, since that provider's own session takes over from there. */
function buildSwitchContext(messages: Message[]): string {
  const lastFew = messages.slice(-4)
  if (lastFew.length === 0) return ''
  const lines = lastFew.map((m) => `${m.sender === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
  return `[Recent conversation before switching model]\n${lines.join('\n')}\n\n`
}

/** Baseline style rules applied to every request regardless of profile
 * settings -- keeps replies free of stylistic tics that read as AI-generated. */
function buildFormattingRules(): string {
  return (
    `[System Instruction - Formatting]\n` +
    `Do not use em dashes (—) anywhere in your response. Do not use emojis.\n\n`
  )
}

function buildPersonalizationContext(profile: UserProfile | null): string {
  if (!profile) return ''

  let instructions = ''

  if (profile.name && profile.name.trim() !== '') {
    instructions += `User's Name: ${profile.name.trim()}\n`
    instructions += `Please address the user by name when appropriate.\n\n`
  }

  if (profile.email && profile.email.trim() !== '') {
    instructions += `User's Email: ${profile.email.trim()}\n\n`
  }

  if (profile.memoryPrompt && profile.memoryPrompt.trim() !== '') {
    instructions += `Custom background & memory context:\n${profile.memoryPrompt.trim()}\n\n`
  }

  if (profile.responseStyle && profile.responseStyle !== 'default') {
    const styleDescriptions: Record<string, string> = {
      technical:
        'Provide highly technical responses that are precise, detailed, code-heavy, structured, and use correct terminology.',
      casual:
        'Provide casual, friendly, simple, and concise responses. Keep explanations brief and approachable.',
      teacher:
        'Respond like an educational teacher. Start with high-level conceptual summaries, build up step-by-step, use helpful analogies, and explain the "why" behind concepts.',
      creative:
        'Respond with a creative and expressive tone. Focus on brainstorming, listing alternative options, and styling recommendations.'
    }
    const styleDesc = styleDescriptions[profile.responseStyle]
    if (styleDesc) {
      instructions += `Response Style: ${styleDesc}\n\n`
    }
  }

  if (instructions) {
    return (
      `[System Instruction - Personalization Settings]\n` +
      `Please adhere to the following user preferences for this conversation:\n\n` +
      instructions +
      `---\n\n`
    )
  }

  return ''
}

function Home(): React.JSX.Element {
  const [chats, setChats] = useState<Chat[]>([])
  const [chatsLoaded, setChatsLoaded] = useState(false)
  const hasLoadedStoredChats = useRef(false)
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  // UI preference only; never persisted as an approval or inherited by a new chat.
  const [composerByChat, setComposerByChat] = useState<Record<string, ComposerPreference>>({})
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeView, setActiveView] = useState<View>('chat')
  const [profile, setProfile] = useState<UserProfile | null>(null)

  const activeChat = chats.find((chat) => chat.id === activeChatId) || null
  const abortControllers = useRef(new Map<string, AbortController>())
  const queuedMessages = useRef(
    new Map<
      string,
      {
        content: string
        tool: string | null
        provider: string
        model: string | null
        attachments: Attachment[]
        mode: ExecutionMode
        draftKind: DraftKind
        preferredModel: boolean
      }[]
    >()
  )
  const processingQueued = useRef(new Set<string>())
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const saveInFlight = useRef<Promise<void>>(Promise.resolve())

  // Restore chat history saved to disk from a previous session.
  useEffect(() => {
    window.api.getChats().then((stored) => {
      setChats(stored as Chat[])
      hasLoadedStoredChats.current = true
      setChatsLoaded(true)
    })
  }, [])

  // Fetch user profile settings
  useEffect(() => {
    window.api.getProfile().then(setProfile)
  }, [])

  // Listen to profile updates
  useEffect(() => {
    const handleProfileUpdate = (): void => {
      window.api.getProfile().then(setProfile)
    }
    window.addEventListener('profile:updated', handleProfileUpdate)
    return () => window.removeEventListener('profile:updated', handleProfileUpdate)
  }, [])

  // Streaming updates arrive per token. Debounce and serialize snapshots so
  // a slow full-library SQLite write cannot race a newer snapshot or make
  // large chats disappear after a restart.
  useEffect(() => {
    if (!chatsLoaded || !hasLoadedStoredChats.current || chats.length === 0) return
    if (saveTimer.current) clearTimeout(saveTimer.current)
    const snapshot = chats
    saveTimer.current = setTimeout(() => {
      saveInFlight.current = saveInFlight.current
        .catch(() => {})
        .then(() => window.api.setChats(snapshot))
        .catch(() => {})
    }, 500)
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [chats, chatsLoaded])

  const handleNewChat = (): void => {
    const newId = `chat-${Date.now()}`
    const newChat: Chat = {
      id: newId,
      title: 'New Session',
      isPinned: false,
      timestamp: 'Just now',
      messages: [],
      provider: null,
      sessionId: null,
      threadId: null
    }
    setChats((prev) => [newChat, ...prev])
    setActiveChatId(newId)
    setSearchQuery('')
    setActiveView('chat')
  }

  const handleTogglePin = (id: string): void => {
    setChats((prev) =>
      prev.map((chat) => (chat.id === id ? { ...chat, isPinned: !chat.isPinned } : chat))
    )
  }

  const handleDeleteChat = (id: string): void => {
    const chat = chats.find((c) => c.id === id)
    if (chat?.sessionId) {
      closeSession(chat.sessionId).catch(() => {
        // session may already be gone (e.g. server restarted) -- nothing to do
      })
    }
    setChats((prev) => prev.filter((c) => c.id !== id))
    setComposerByChat((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    if (activeChatId === id) {
      const remaining = chats.filter((c) => c.id !== id)
      setActiveChatId(remaining.length > 0 ? remaining[0].id : null)
    }
  }

  const handleRenameChat = (id: string, newTitle: string): void => {
    setChats((prev) => prev.map((chat) => (chat.id === id ? { ...chat, title: newTitle } : chat)))
  }

  const handleMessageRevealed = (messageId: string): void => {
    setChats((prev) =>
      prev.map((chat) => ({
        ...chat,
        messages: chat.messages.map((m) => (m.id === messageId ? { ...m, isNew: false } : m))
      }))
    )
  }

  const handleStopSending = (chatId: string): void => {
    abortControllers.current.get(chatId)?.abort()
    abortControllers.current.delete(chatId)
    setChats((prev) =>
      prev.map((chat) => (chat.id === chatId ? { ...chat, isSending: false } : chat))
    )
  }

  const handleSendMessage = async (
    content: string,
    tool: string | null,
    provider: string,
    model: string | null,
    attachments: Attachment[],
    mode: ExecutionMode,
    draftKind: DraftKind = 'research_brief',
    preferredModel = false
  ): Promise<void> => {
    let chatId = activeChatId
    let baseChat = chatId ? chats.find((c) => c.id === chatId) : undefined

    if (baseChat?.isSending && chatId && !processingQueued.current.has(chatId)) {
      const queue = queuedMessages.current.get(chatId) || []
      queue.push({ content, tool, provider, model, attachments, mode, draftKind, preferredModel })
      queuedMessages.current.set(chatId, queue)
      setChats((prev) =>
        prev.map((chat) =>
          chat.id === chatId ? { ...chat, queuedCount: queue.length } : chat
        )
      )
      return
    }

    if (!chatId || !baseChat) {
      chatId = `chat-${Date.now()}`
      baseChat = {
        id: chatId,
        title: 'New Session',
        isPinned: false,
        timestamp: 'Just now',
        messages: [],
        provider: null,
        sessionId: null,
        threadId: null
      }
      setChats((prev) => [baseChat as Chat, ...prev])
      const newId = chatId
      setComposerByChat((prev) => {
        const { new: blank, ...rest } = prev
        return blank ? { ...rest, [newId]: blank } : rest
      })
      setActiveChatId(chatId)
    }

    const targetChatId = chatId
    processingQueued.current.delete(targetChatId)
    // A plain-text image request with no tool explicitly picked (and nothing
    // attached, since an attachment implies vision/file context instead)
    // still routes to real image generation -- see detectImageIntent above.
    const resolvedTool =
      tool || (attachments.length === 0 && detectImageIntent(content) ? 'generateImage' : tool)

    // Images are saved to disk up front (so chat history stores a small file
    // path, not a multi-MB base64 blob) and also kept as base64 to hand the
    // provider for vision. Text-file attachments stay display-only blocks;
    // their content reaches the model via applyAttachments below.
    const messageAttachments: MessageAttachment[] = []
    const imagePayloads: ImagePayload[] = []
    for (const att of attachments) {
      if (att.kind === 'image') {
        const { data, mime } = splitDataUrl(att.dataUrl)
        imagePayloads.push({ data, mime })
        const path = await window.api.saveImage(data, mime)
        const formattedPath = path.replace(/\\/g, '/')
        const fileUrl = formattedPath.startsWith('/')
          ? `file://${formattedPath}`
          : `file:///${formattedPath}`
        messageAttachments.push({ kind: 'image', path: fileUrl })
      } else {
        messageAttachments.push({ kind: 'file', name: att.name })
      }
    }

    const userMsg: Message = {
      id: `msg-${Date.now()}-u`,
      sender: 'user',
      content,
      timestamp: timestamp(),
      attachments: messageAttachments.length ? messageAttachments : undefined
    }

    setChats((prev) =>
      prev.map((chat) => {
        if (chat.id !== targetChatId) return chat
        const title =
          chat.title === 'New Session'
            ? content.length > 25
              ? content.substring(0, 22) + '...'
              : content
            : chat.title
        return {
          ...chat,
          title,
          messages: [...chat.messages, userMsg],
          isSending: true,
          isGeneratingImage: resolvedTool === 'generateImage'
        }
      })
    )

    const startedAt = Date.now()
    const controller = new AbortController()
    abortControllers.current.set(targetChatId, controller)

    // Image generation is a standalone request -- no conversation state, the
    // reply IS the image(s) -- so it never touches sessions/adapters at all.
    if (resolvedTool === 'generateImage') {
      if (!supportsImageGeneration(provider)) {
        setChats((prev) => prev.map((chat) => chat.id === targetChatId
          ? { ...chat, isSending: false, isGeneratingImage: false, messages: [...chat.messages, {
              id: `msg-${Date.now()}-e`, sender: 'assistant', timestamp: timestamp(),
              content: '**Error:** Image generation requires OpenAI or Gemini. Choose one of those providers.'
            }] }
          : chat))
        abortControllers.current.delete(targetChatId)
        return
      }
      try {
        const result = await generateImage(provider, content)
        const replyAttachments: MessageAttachment[] = []
        for (const img of result.images) {
          if (img.data && img.mime) {
            const path = await window.api.saveImage(img.data, img.mime)
            const formattedPath = path.replace(/\\/g, '/')
            const fileUrl = formattedPath.startsWith('/')
              ? `file://${formattedPath}`
              : `file:///${formattedPath}`
            replyAttachments.push({ kind: 'image', path: fileUrl })
          } else if (img.url) {
            replyAttachments.push({ kind: 'image', path: img.url })
          }
        }
        const assistantMsg: Message = {
          id: `msg-${Date.now()}-a`,
          sender: 'assistant',
          content: '',
          timestamp: timestamp(),
          provider,
          latencyMs: Date.now() - startedAt,
          isNew: true,
          attachments: replyAttachments
        }
        setChats((prev) =>
          prev.map((chat) =>
            chat.id === targetChatId
              ? {
                  ...chat,
                  messages: [...chat.messages, assistantMsg],
                  isSending: false,
                  isGeneratingImage: false
                }
              : chat
          )
        )
      } catch (err) {
        const detail = friendlyErrorMessage(
          err,
          'Image generation failed. Please try again in a moment.'
        )
        const errorMsg: Message = {
          id: `msg-${Date.now()}-e`,
          sender: 'assistant',
          content: `**Error:** ${detail}`,
          timestamp: timestamp()
        }
        setChats((prev) =>
          prev.map((chat) =>
            chat.id === targetChatId
              ? {
                  ...chat,
                  messages: [...chat.messages, errorMsg],
                  isSending: false,
                  isGeneratingImage: false
                }
              : chat
          )
        )
      } finally {
        abortControllers.current.delete(targetChatId)
      }
      return
    }

    // Set once the (empty) assistant placeholder is pushed, so a failure
    // partway through streaming can turn that same bubble into the error
    // instead of leaving a permanently blank one sitting next to a separate
    // error message.
    let assistantMsgId: string | null = null

    try {
      const agentMode = modeForTool(resolvedTool)
      const route = mode === 'auto' && agentMode === 'chat'
        ? await routeTurn(content, mode,
            preferredModel ? { provider, model: model || '' } : undefined,
            controller.signal)
        : null
      if (route && (
        !['ready', 'degraded'].includes(route.state) || !route.model || !route.provider ||
        (route.provider !== 'local' && (!preferredModel || route.provider !== provider))
      )) {
        throw new ApiError(409, route.reason || 'No permitted model is available')
      }
      // Only an explicitly selected cloud model can leave the loopback-only Auto path.
      const turnMode = route?.provider && route.provider !== 'local' ? route.mode : mode
      const routedProvider = route?.provider ?? provider
      const routedModel = route?.model ?? model
      // A new route gets a new session; the previous provider context is explicitly bounded.
      const switchingProvider = !!baseChat.provider &&
        (baseChat.provider !== routedProvider || baseChat.model !== routedModel)
      let sessionId = baseChat.sessionId
      let threadId = baseChat.threadId
      let chatProvider = baseChat.provider ?? routedProvider
      let chatModel = baseChat.model ?? routedModel

      const previousSessionId = switchingProvider ? sessionId : null
      if (switchingProvider) {
        sessionId = null
        threadId = null
        chatProvider = routedProvider
        chatModel = routedModel
      }

      let promptToSend = buildFormattingRules() + applyAttachments(content, attachments)
      if (profile) {
        promptToSend = buildPersonalizationContext(profile) + promptToSend
      }
      if (switchingProvider) {
        promptToSend = buildSwitchContext(baseChat.messages) + promptToSend
      }

      if (controller.signal.aborted) throw new ApiAborted('request aborted')
      if (!sessionId) {
        const session = await createSession(chatProvider, false, chatModel)
        if (controller.signal.aborted) {
          closeSession(session.session_id).catch(() => {})
          throw new ApiAborted('request aborted')
        }
        sessionId = session.session_id
        threadId = session.thread_id
        chatProvider = session.provider
        if (previousSessionId) void closeSession(previousSessionId).catch(() => {})
        setChats((prev) =>
          prev.map((chat) =>
            chat.id === targetChatId
              ? { ...chat, sessionId, threadId, provider: chatProvider, model: chatModel }
              : chat
          )
        )
      }

      assistantMsgId = `msg-${Date.now()}-a`
      const assistantMsg: Message = {
        id: assistantMsgId,
        sender: 'assistant',
        content: '',
        timestamp: timestamp(),
        provider: chatProvider,
        model: chatModel || undefined,
        isNew: true,
        tool: resolvedTool || undefined,
        routeReason: route ? `${route.mode} · ${route.model} · ${route.reason}` : undefined
      }

      setChats((prev) =>
        prev.map((chat) =>
          chat.id === targetChatId
            ? { ...chat, messages: [...chat.messages, assistantMsg], isSending: true }
            : chat
        )
      )

      const handleMemoryRecall = (memory: MemoryRecall): void => {
        setChats((prev) =>
          prev.map((chat) => {
            if (chat.id !== targetChatId) return chat
            return {
              ...chat,
              messages: chat.messages.map((message) =>
                message.id === assistantMsgId ? { ...message, memory } : message
              )
            }
          })
        )
      }

      const handleStreamToken = (token: string): void => {
        setChats((prev) =>
          prev.map((chat) => {
            if (chat.id !== targetChatId) return chat
            const nextMessages = chat.messages.map((m) => {
              if (m.id !== assistantMsgId) return m
              return { ...m, content: m.content + token }
            })
            return { ...chat, messages: nextMessages }
          })
        )
      }

      const handleAgentEvent = (event: AgentEvent): void => {
        if (event.type === 'assistant.delta') {
          handleStreamToken(event.text)
          return
        }
        setChats((prev) =>
          prev.map((chat) => {
            if (chat.id !== targetChatId) return chat
            return {
              ...chat,
              messages: chat.messages.map((message) => {
                if (message.id !== assistantMsgId) return message
                if (event.type === 'source.found') {
                  return {
                    ...message,
                    sources: [...(message.sources || []).filter((source) =>
                      source.source_id !== event.source.source_id
                    ), event.source]
                  }
                }
                if (event.type === 'attachment.found') {
                  return {
                    ...message,
                    attachmentSources: [...(message.attachmentSources || []), event.attachment]
                  }
                }
                if (event.type === 'run.completed') {
                  return {
                    ...message,
                    sources: event.sources || message.sources,
                    queries: event.queries || message.queries,
                    attachmentSources: event.attachments || message.attachmentSources,
                    draft: event.draft || undefined,
                    runStatus: event.status,
                    runPhase: event.reason || undefined
                  }
                }
                if (event.type === 'plan.ready') return {
                  ...message,
                  queries: event.queries,
                  researchPlan: { objective: event.objective, freshness: event.freshness,
                    source_criteria: event.source_criteria },
                  runPhase: 'Searching'
                }
                if (event.type === 'plan.degraded') return { ...message, runPhase: 'Planning degraded' }
                if (event.type === 'tool.started') {
                  return { ...message, runPhase: event.tool === 'fetch_page' ? 'Reading sources' : 'Searching' }
                }
                if (event.type === 'tool.progress') return { ...message, runPhase: event.phase }
                if (event.type === 'tool.failed') return { ...message, runPhase: event.reason || 'Partial results' }
                return message
              })
            }
          })
        )
      }

      try {
        if (agentMode !== 'chat') {
          const recent = baseChat.messages.slice(-4).map((message) => ({
            role: message.sender,
            content: message.content.slice(0, 2000)
          }))
          await sendAgentStream(sessionId, {
            prompt: content,
            mode: agentMode,
            draft_kind: agentMode === 'draft' ? draftKind : undefined,
            instructions: buildFormattingRules() + (profile ? buildPersonalizationContext(profile) : ''),
            images: imagePayloads,
            recent,
            attachments: attachments
              .filter((att): att is FileAttachment => att.kind === 'file')
              .map((att) => ({ id: att.id, name: att.name, mime: 'text/plain', content: att.content }))
          }, handleAgentEvent, controller.signal)
        } else {
          await sendMessageStream(
            sessionId,
            promptToSend,
            imagePayloads,
            handleStreamToken,
            handleMemoryRecall,
            controller.signal,
            turnMode
          )
        }
      } catch (err) {
        if (agentMode === 'chat' && err instanceof ApiError && err.status === 404) {
          // session vanished (e.g. server restarted) -- transparently re-create
          const session = await createSession(chatProvider, false, chatModel)
          sessionId = session.session_id
          threadId = session.thread_id
          setChats((prev) =>
            prev.map((chat) => (chat.id === targetChatId ? { ...chat, sessionId, threadId } : chat))
          )

          // Clear current content before retrying streaming
          setChats((prev) =>
            prev.map((chat) => {
              if (chat.id !== targetChatId) return chat
              const nextMessages = chat.messages.map((m) => {
                if (m.id !== assistantMsgId) return m
                return { ...m, content: '' }
              })
              return { ...chat, messages: nextMessages }
            })
          )

          await sendMessageStream(
            sessionId,
            promptToSend,
            imagePayloads,
            handleStreamToken,
            handleMemoryRecall,
            controller.signal,
            turnMode
          )
        } else {
          throw err
        }
      }

      setChats((prev) =>
        prev.map((chat) => {
          if (chat.id !== targetChatId) return chat
          const nextMessages = chat.messages.map((m) => {
            if (m.id !== assistantMsgId) return m
            return { ...m, latencyMs: Date.now() - startedAt }
          })
          return { ...chat, messages: nextMessages, isSending: false }
        })
      )
    } catch (err) {
      // Deliberately stopped by the user -- handleStopSending() already reset
      // isSending, so there's nothing further to do here.
      if (err instanceof ApiAborted || controller.signal.aborted) return

      const detail = friendlyErrorMessage(
        err,
        'Could not reach the model. Check that the Atlas server is running.'
      )
      const errorText = `**Error:** ${detail}`
      const pendingId = assistantMsgId

      setChats((prev) =>
        prev.map((chat) => {
          if (chat.id !== targetChatId) return chat
          // The streaming placeholder is already sitting in the messages
          // array (possibly still empty) -- turn that same bubble into the
          // error instead of leaving a permanently blank one next to a
          // separate error message.
          if (pendingId && chat.messages.some((m) => m.id === pendingId)) {
            return {
              ...chat,
              messages: chat.messages.map((m) =>
                m.id === pendingId ? { ...m, content: errorText } : m
              ),
              isSending: false
            }
          }
          const errorMsg: Message = {
            id: `msg-${Date.now()}-e`,
            sender: 'assistant',
            content: errorText,
            timestamp: timestamp()
          }
          return { ...chat, messages: [...chat.messages, errorMsg], isSending: false }
        })
      )
    } finally {
      abortControllers.current.delete(targetChatId)
      const next = queuedMessages.current.get(targetChatId)?.shift()
      const remaining = queuedMessages.current.get(targetChatId) || []
      if (remaining.length === 0) queuedMessages.current.delete(targetChatId)
      setChats((prev) =>
        prev.map((chat) =>
          chat.id === targetChatId ? { ...chat, queuedCount: remaining.length } : chat
        )
      )
      if (next) {
        processingQueued.current.add(targetChatId)
        void handleSendMessage(
          next.content,
          next.tool,
          next.provider,
          next.model,
          next.attachments,
          next.mode,
          next.draftKind,
          next.preferredModel
        )
      }
    }
  }

  return (
    <div className="h-full w-full flex bg-[#FAF9F6] dark:bg-[#171717] overflow-hidden">
      <Sidebar
        isCollapsed={isSidebarCollapsed}
        setIsCollapsed={setIsSidebarCollapsed}
        activeChatId={activeChatId}
        setActiveChatId={(id) => {
          setActiveChatId(id)
          setActiveView('chat')
        }}
        chats={chats}
        onNewChat={handleNewChat}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        onTogglePin={handleTogglePin}
        onDeleteChat={handleDeleteChat}
        onRenameChat={handleRenameChat}
        onOpenLibrary={() => setActiveView('library')}
        onOpenProfile={() => setActiveView('profile')}
        onOpenHelp={() => setActiveView('help')}
      />

      {activeView === 'library' && (
        <Library
          chats={chats}
          onSelectChat={(id) => {
            setActiveChatId(id)
            setActiveView('chat')
          }}
          onClose={() => setActiveView('chat')}
          onTogglePin={handleTogglePin}
          onDeleteChat={handleDeleteChat}
          onRenameChat={handleRenameChat}
        />
      )}
      {activeView === 'profile' && <Profile onClose={() => setActiveView('chat')} />}
      {activeView === 'help' && <Help onClose={() => setActiveView('chat')} />}
      {activeView === 'chat' && (
        <ChatArea
          isSidebarCollapsed={isSidebarCollapsed}
          setIsSidebarCollapsed={setIsSidebarCollapsed}
          activeChat={activeChat}
          composerPreference={composerByChat[activeChatId ?? 'new']}
          onComposerChange={(update) => {
            const key = activeChatId ?? 'new'
            setComposerByChat((prev) => ({ ...prev, [key]: {
              intent: update.intent ?? prev[key]?.intent ?? 'auto',
              draftKind: update.draftKind ?? prev[key]?.draftKind ?? 'research_brief'
            } }))
          }}
          onSendMessage={handleSendMessage}
          onNewChat={handleNewChat}
          onTogglePin={handleTogglePin}
          onMessageRevealed={handleMessageRevealed}
          onStopSending={handleStopSending}
        />
      )}
    </div>
  )
}

export default Home
