import React, { useEffect, useRef, useState } from 'react'
import Sidebar from '@/components/Sidebar'
import ChatArea, { Chat, Message, MessageAttachment } from '@/components/ChatArea'
import Library from '@/components/Library'
import Profile from '@/components/Profile'
import Help from '@/components/Help'
import type { Attachment, FileAttachment } from '@/components/ui/chatgpt-prompt-input'

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
  generateImage,
  sendMessageStream,
  webSearch,
  type ImagePayload,
  type SearchResult
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

function applyTool(content: string, tool: string | null): string {
  switch (tool) {
    case 'searchWeb':
      return `Search the web for current, up-to-date information and use it to answer:\n\n${content}`
    case 'deepResearch':
      return `Do deep, thorough research covering multiple angles and sources, then answer:\n\n${content}`
    case 'writeCode':
      return `Focus on writing clean, correct, well-structured code for the following:\n\n${content}`
    case 'thinkLonger':
      return `Think through this carefully, step by step, before giving your final answer:\n\n${content}`
    default:
      return content
  }
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

/** Folds real Tavily search results into the prompt -- the model answers
 * from these directly, and the same results become the source pins shown
 * under the reply (see Message.sources in ChatArea.tsx). */
function buildSearchContext(results: SearchResult[]): string {
  if (results.length === 0) return ''
  const lines = results
    .map((r, i) => `[${i + 1}] ${r.title}\n${r.content}\nSource: ${r.url}`)
    .join('\n\n')
  return (
    `[Web search results]\n${lines}\n\n` +
    `Using the search results above, answer the user's question that follows.\n\n`
  )
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
  const [activeChatId, setActiveChatId] = useState<string | null>(null)
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeView, setActiveView] = useState<View>('chat')
  const [profile, setProfile] = useState<UserProfile | null>(null)

  const activeChat = chats.find((chat) => chat.id === activeChatId) || null
  const abortControllers = useRef(new Map<string, AbortController>())

  // Restore chat history saved to disk from a previous session.
  useEffect(() => {
    window.api.getChats().then((stored) => {
      setChats(stored as Chat[])
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

  // Persist on every change, once the initial load has completed -- guards
  // against the empty initial state overwriting what's on disk.
  useEffect(() => {
    if (!chatsLoaded) return
    window.api.setChats(chats)
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
    attachments: Attachment[]
  ): Promise<void> => {
    let chatId = activeChatId
    let baseChat = chatId ? chats.find((c) => c.id === chatId) : undefined

    if (baseChat?.isSending) return

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
      setActiveChatId(chatId)
    }

    const targetChatId = chatId
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
        const detail =
          err instanceof ApiError ? err.message : 'Image generation failed. Is the server running?'
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

    // A chat with an established provider that picks a different one mid-
    // conversation gets a fresh session -- a brand new chat (provider still
    // null) is never treated as a "switch".
    const switchingProvider = !!baseChat.provider && baseChat.provider !== provider

    // Set once the (empty) assistant placeholder is pushed, so a failure
    // partway through streaming can turn that same bubble into the error
    // instead of leaving a permanently blank one sitting next to a separate
    // error message.
    let assistantMsgId: string | null = null

    try {
      let sessionId = baseChat.sessionId
      let threadId = baseChat.threadId
      let chatProvider = baseChat.provider ?? provider

      if (switchingProvider) {
        if (sessionId) closeSession(sessionId).catch(() => {})
        sessionId = null
        threadId = null
        chatProvider = provider
      }

      // Research mode is the same real search, just cast a wider net --
      // more results to synthesize from, no separate multi-step agent.
      let searchResults: SearchResult[] = []
      if (resolvedTool === 'searchWeb' || resolvedTool === 'deepResearch') {
        const maxResults = resolvedTool === 'deepResearch' ? 8 : 5
        searchResults = (await webSearch(content, maxResults)).results
      }

      let promptToSend = applyAttachments(applyTool(content, resolvedTool), attachments)
      promptToSend = buildFormattingRules() + promptToSend
      if (searchResults.length > 0) {
        promptToSend = buildSearchContext(searchResults) + promptToSend
      }
      if (profile) {
        promptToSend = buildPersonalizationContext(profile) + promptToSend
      }
      if (switchingProvider) {
        promptToSend = buildSwitchContext(baseChat.messages) + promptToSend
      }

      if (!sessionId) {
        const session = await createSession(chatProvider)
        sessionId = session.session_id
        threadId = session.thread_id
        chatProvider = session.provider
        setChats((prev) =>
          prev.map((chat) =>
            chat.id === targetChatId
              ? { ...chat, sessionId, threadId, provider: chatProvider }
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
        isNew: true,
        tool: resolvedTool || undefined,
        sources:
          searchResults.length > 0
            ? searchResults.map((r) => ({ title: r.title, url: r.url }))
            : undefined
      }

      setChats((prev) =>
        prev.map((chat) =>
          chat.id === targetChatId
            ? { ...chat, messages: [...chat.messages, assistantMsg], isSending: true }
            : chat
        )
      )

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

      try {
        await sendMessageStream(
          sessionId,
          promptToSend,
          imagePayloads,
          handleStreamToken,
          controller.signal
        )
      } catch (err) {
        if (err instanceof ApiError && err.status === 404) {
          // session vanished (e.g. server restarted) -- transparently re-create
          const session = await createSession(chatProvider)
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
            controller.signal
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
      if (err instanceof ApiAborted) return

      const detail =
        err instanceof ApiError
          ? err.message
          : 'Could not reach the model. Check that the Atlas server is running.'
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
    }
  }

  return (
    <div className="h-full w-full flex bg-[#FAF9F6] dark:bg-[#1E1E1C] overflow-hidden">
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
