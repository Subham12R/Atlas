import React, { useEffect, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Add01Icon,
  Search01Icon,
  Book02Icon,
  PinIcon,
  Message01Icon,
  SidebarLeftIcon,
  EllipsisIcon,
  Cancel01Icon,
  MoreVerticalIcon,
  UserIcon,
  ArrowDown,
  HelpCircleIcon,
  Logout01Icon
} from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'
import type { Chat } from './ChatArea'
import { useTheme } from 'next-themes'

interface SidebarProps {
  isCollapsed: boolean
  setIsCollapsed: (collapsed: boolean) => void
  activeChatId: string | null
  setActiveChatId: (id: string) => void
  chats: Chat[]
  onNewChat: () => void
  searchQuery: string
  onSearchChange: (query: string) => void
  onTogglePin: (id: string) => void
  onDeleteChat: (id: string) => void
  onRenameChat: (id: string, newTitle: string) => void
  onOpenLibrary: () => void
  onOpenProfile: () => void
  onOpenHelp: () => void
}

export default function Sidebar({
  isCollapsed,
  setIsCollapsed,
  activeChatId,
  setActiveChatId,
  chats,
  onNewChat,
  searchQuery,
  onSearchChange,
  onTogglePin,
  onDeleteChat,
  onRenameChat,
  onOpenLibrary,
  onOpenProfile,
  onOpenHelp
}: SidebarProps): React.JSX.Element {
  const [activeDropdownId, setActiveDropdownId] = useState<string | null>(null)
  const [showFeatureCard, setShowFeatureCard] = useState(true)
  const [editingChatId, setEditingChatId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [showProfileMenu, setShowProfileMenu] = useState(false)
  const [isPinnedExpanded, setIsPinnedExpanded] = useState(true)
  const [isRecentExpanded, setIsRecentExpanded] = useState(true)
  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [profile, setProfile] = useState<{ name: string; avatarDataUrl: string | null }>({
    name: '',
    avatarDataUrl: null
  })
  const { resolvedTheme } = useTheme()
  const isDark = resolvedTheme === 'dark'

  useEffect(() => {
    const loadProfile = (): void => {
      window.api.getProfile().then(setProfile)
    }
    loadProfile()
    window.addEventListener('profile:updated', loadProfile)
    return () => window.removeEventListener('profile:updated', loadProfile)
  }, [])

  const handleOpenSearch = (): void => {
    setIsCollapsed(false)
    setIsSearchOpen(true)
  }

  const handleCloseSearch = (): void => {
    setIsSearchOpen(false)
    onSearchChange('')
  }

  const handleSaveRename = (id: string): void => {
    if (editTitle.trim()) {
      onRenameChat(id, editTitle.trim())
    }
    setEditingChatId(null)
  }

  // Filter chats by search query
  const filteredChats = chats.filter((chat) =>
    chat.title.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const pinnedChats = filteredChats.filter((chat) => chat.isPinned)
  const recentChats = filteredChats.filter((chat) => !chat.isPinned)

  return (
    <aside
      className={cn(
        'h-full flex flex-col bg-[#FAF9F6] dark:bg-[#171717] text-[#2E2E2D] dark:text-[#EAE8E3] select-none transition-all duration-300 ease-in-out relative z-10 shrink-0',
        isCollapsed ? 'w-0 overflow-hidden opacity-0 pointer-events-none' : 'w-64'
      )}
    >
      {/* Sidebar Header: Logo, Title, and Collapse Button */}
      <div className="h-15 px-4 flex items-center justify-between shrink-0 bg-transparent">
        <div className="flex items-center gap-1.5 overflow-hidden">
          {/* Logo inline with text */}

          {!isCollapsed && (
            <span className="font-medium text-lg  font-sans tracking-tighter text-[#2E2E2D] dark:text-[#EAE8E3] transition-opacity duration-300">
              Menu
            </span>
          )}
        </div>

        {!isCollapsed && (
          <button
            onClick={() => setIsCollapsed(true)}
            className="p-1.5 rounded-md hover:bg-[#F1EFEA] dark:hover:bg-[#2C2C2A] text-[#6E6D6A] dark:text-[#9E9D9A] hover:text-[#2E2E2D] dark:hover:text-[#EAE8E3] transition-colors cursor-pointer"
            title="Collapse Sidebar"
          >
            <HugeiconsIcon icon={SidebarLeftIcon} size={16} />
          </button>
        )}
      </div>

      {/* Navigation Buttons Group: Left-aligned list */}
      <div className="px-2 pt-2 shrink-0 space-y-1.5">
        {/* New Chat Button */}
        {isCollapsed ? (
          <button
            onClick={onNewChat}
            className="w-10 h-10 mx-auto rounded-lg text-[#2E2E2D] dark:text-[#EAE8E3] hover:bg-[#F1EFEA] dark:hover:bg-[#2C2C2A] flex items-center justify-center transition-colors cursor-pointer"
            title="New Chat"
          >
            <HugeiconsIcon icon={Add01Icon} size={18} />
          </button>
        ) : (
          <button
            onClick={onNewChat}
            className="w-full h-9 rounded-lg text-[#2E2E2D] dark:text-[#EAE8E3] hover:bg-[#F1EFEA] dark:hover:bg-[#2C2C2A] px-3 flex items-center justify-between font-medium text-sm tracking-tight transition-colors cursor-pointer"
          >
            <span className="flex items-center gap-1.5  ">
              <HugeiconsIcon
                icon={Add01Icon}
                size={16}
                className="text-[#6E6D6A] dark:text-[#9E9D9A]"
              />
              New Chat
            </span>
          </button>
        )}

        {/* Search: a button that turns into an inline search input */}
        {isCollapsed ? (
          <button
            onClick={handleOpenSearch}
            className="w-10 h-10 mx-auto rounded-lg text-[#2E2E2D] dark:text-[#EAE8E3] hover:bg-[#F1EFEA] dark:hover:bg-[#2C2C2A] flex items-center justify-center transition-colors cursor-pointer"
            title="Search"
          >
            <HugeiconsIcon icon={Search01Icon} size={18} />
          </button>
        ) : isSearchOpen ? (
          <div className="w-full h-9 rounded-lg px-3 flex items-center gap-1.5 bg-[#F1EFEA] dark:bg-[#2C2C2A]">
            <HugeiconsIcon
              icon={Search01Icon}
              size={16}
              className="text-[#6E6D6A] dark:text-[#9E9D9A] shrink-0"
            />
            <input
              autoFocus
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') handleCloseSearch()
              }}
              placeholder="Search chats..."
              className="flex-1 min-w-0 bg-transparent outline-none text-sm font-medium text-[#2E2E2D] dark:text-[#EAE8E3] placeholder:text-[#9E9D9A] placeholder:font-normal"
            />
            <button
              onClick={handleCloseSearch}
              className="shrink-0 text-[#9E9D9A] hover:text-[#2E2E2D] dark:hover:text-[#EAE8E3] transition-colors cursor-pointer"
              title="Close search"
            >
              <HugeiconsIcon icon={Cancel01Icon} size={14} />
            </button>
          </div>
        ) : (
          <button
            onClick={handleOpenSearch}
            className="w-full h-9 rounded-lg text-[#2E2E2D] dark:text-[#EAE8E3] hover:bg-[#F1EFEA] dark:hover:bg-[#2C2C2A] px-3 flex items-center justify-between font-medium text-sm tracking-tight transition-colors cursor-pointer"
          >
            <span className="flex items-center gap-1.5">
              <HugeiconsIcon
                icon={Search01Icon}
                size={16}
                className="text-[#6E6D6A] dark:text-[#9E9D9A]"
              />
              Search
            </span>
          </button>
        )}

        {/* Library Button */}
        {isCollapsed ? (
          <button
            onClick={onOpenLibrary}
            className="w-10 h-10 mx-auto rounded-lg text-[#2E2E2D] dark:text-[#EAE8E3] hover:bg-[#F1EFEA] dark:hover:bg-[#2C2C2A] flex items-center justify-center transition-colors cursor-pointer"
            title="Library"
          >
            <HugeiconsIcon icon={Book02Icon} size={18} />
          </button>
        ) : (
          <button
            onClick={onOpenLibrary}
            className="w-full h-9 rounded-lg text-[#2E2E2D] dark:text-[#EAE8E3] hover:bg-[#F1EFEA] dark:hover:bg-[#2C2C2A] px-3 flex items-center font-medium text-sm tracking-tight transition-colors cursor-pointer"
          >
            <span className="flex items-center gap-1.5">
              <HugeiconsIcon
                icon={Book02Icon}
                size={16}
                className="text-[#6E6D6A] dark:text-[#9E9D9A]"
              />
              Library
            </span>
          </button>
        )}
      </div>

      {/* Scrollable chat lists container (Non-scrolling wrapper) */}
      <div className="flex-1 flex flex-col min-h-0 px-3 pt-8 pb-4 space-y-5">
        {/* Pinned Section */}
        {(!isCollapsed || pinnedChats.length > 0) && (
          <div className="flex flex-col min-h-0 shrink-0 space-y-1">
            {!isCollapsed && (
              <div
                onClick={() => setIsPinnedExpanded(!isPinnedExpanded)}
                className="px-2 flex items-center justify-between text-[12px] font-medium text-[#9E9D9A] tracking-tighter select-none mb-1 cursor-pointer hover:text-[#2E2E2D] dark:hover:text-white transition-colors group/header"
              >
                <div className="flex items-center gap-1.5">
                  <HugeiconsIcon
                    icon={ArrowDown}
                    size={10}
                    className={cn(
                      'transition-transform duration-200 text-[#9E9D9A] group-hover/header:text-[#2E2E2D] dark:group-hover/header:text-white',
                      !isPinnedExpanded && '-rotate-90'
                    )}
                  />
                  <span className="font-sans">Pinned</span>
                </div>
                <span className="text-[9px] bg-[#EAE8E3] dark:bg-[#2C2C2A] text-[#6E6D6A] dark:text-[#9E9D9A] px-1 rounded-sm font-normal">
                  {pinnedChats.length}
                </span>
              </div>
            )}

            {isPinnedExpanded && (
              <div
                className={cn(
                  'space-y-0.5 max-h-[160px] min-h-0 pr-0.5',
                  activeDropdownId ? 'overflow-visible' : 'overflow-y-auto no-scrollbar'
                )}
              >
                {pinnedChats.map((chat) => (
                  <div
                    key={chat.id}
                    className={cn(
                      'group relative flex items-center rounded-lg text-sm transition-all cursor-pointer',
                      isCollapsed ? 'justify-center h-10' : 'h-8 px-3 gap-1.5',
                      activeChatId === chat.id
                        ? 'bg-[#EAE8E3] dark:bg-[#2C2C2A] text-[#2E2E2D] dark:text-[#EAE8E3] font-medium'
                        : 'text-[#6E6D6A] dark:text-[#9E9D9A] hover:text-[#2E2E2D] dark:hover:text-[#EAE8E3] hover:bg-[#F1EFEA] dark:hover:bg-[#2C2C2A]/50'
                    )}
                    onClick={() => setActiveChatId(chat.id)}
                  >
                    <HugeiconsIcon
                      icon={PinIcon}
                      size={14}
                      className={cn(
                        'shrink-0',
                        activeChatId === chat.id
                          ? 'text-[#2E2E2D] dark:text-[#EAE8E3]'
                          : 'text-[#9E9D9A] dark:text-[#6E6D6A]'
                      )}
                    />
                    {!isCollapsed &&
                      (editingChatId === chat.id ? (
                        <input
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          onBlur={() => handleSaveRename(chat.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveRename(chat.id)
                            if (e.key === 'Escape') setEditingChatId(null)
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs font-medium text-[#2E2E2D] dark:text-[#EAE8E3] bg-[#FAF9F6] dark:bg-[#252523] border border-[#E5E3DF] dark:border-[#2C2C2A] rounded px-1.5 py-0.5 outline-hidden w-[70%] font-sans"
                          autoFocus
                        />
                      ) : (
                        <span className="truncate pr-8 w-full">{chat.title}</span>
                      ))}

                    {/* Actions Dropdown (Triple vertical dots) */}
                    {!isCollapsed && (
                      <div className="absolute right-2 top-1.5 flex items-center">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setActiveDropdownId(activeDropdownId === chat.id ? null : chat.id)
                          }}
                          className={cn(
                            'p-0.5 rounded hover:bg-[#EAE8E3] dark:hover:bg-[#2C2C2A] text-[#9E9D9A] hover:text-[#2E2E2D] dark:hover:text-[#EAE8E3] transition-colors cursor-pointer',
                            activeDropdownId === chat.id ? 'flex' : 'hidden group-hover:flex'
                          )}
                          title="Chat actions"
                        >
                          <HugeiconsIcon icon={MoreVerticalIcon} size={12} />
                        </button>

                        {activeDropdownId === chat.id && (
                          <>
                            <div
                              className="fixed inset-0 z-40 cursor-default"
                              onClick={(e) => {
                                e.stopPropagation()
                                setActiveDropdownId(null)
                              }}
                            />
                            <div
                              className="absolute right-0 top-6 w-28 rounded-lg border border-[#E5E3DF] dark:border-[#2C2C2A] bg-[#FAF9F6] dark:bg-[#252523] shadow-md p-1 z-50 flex flex-col text-left text-[11px]"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  onTogglePin(chat.id)
                                  setActiveDropdownId(null)
                                }}
                                className="w-full text-left px-2 py-1.5 rounded-md hover:bg-[#F1EFEA] dark:hover:bg-[#2C2C2A] text-[#2E2E2D] dark:text-[#EAE8E3] flex items-center gap-1.5 cursor-pointer font-medium"
                              >
                                <HugeiconsIcon
                                  icon={PinIcon}
                                  size={12}
                                  className="fill-[#2E2E2D] dark:fill-[#EAE8E3] text-[#2E2E2D] dark:text-[#EAE8E3]"
                                />
                                <span className="text-xs font-semibold">Unpin</span>
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setEditingChatId(chat.id)
                                  setEditTitle(chat.title)
                                  setActiveDropdownId(null)
                                }}
                                className="w-full text-left px-2 py-1.5 rounded-md hover:bg-[#F1EFEA] dark:hover:bg-[#2C2C2A] text-[#2E2E2D] dark:text-[#EAE8E3] flex items-center gap-1.5 cursor-pointer font-medium"
                              >
                                <HugeiconsIcon
                                  icon={EllipsisIcon}
                                  size={12}
                                  className="text-[#6E6D6A] dark:text-[#9E9D9A]"
                                />
                                <span className="text-xs font-semibold">Rename</span>
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  onDeleteChat(chat.id)
                                  setActiveDropdownId(null)
                                }}
                                className="w-full text-left px-2 py-1.5 rounded-md hover:bg-red-50 dark:hover:bg-[#441C1A] text-red-600 dark:text-[#F87171] flex items-center gap-1.5 cursor-pointer font-medium"
                              >
                                <HugeiconsIcon
                                  icon={Cancel01Icon}
                                  size={12}
                                  className="text-red-600 dark:text-[#F87171]"
                                />
                                <span className="text-xs font-semibold">Delete</span>
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                {!isCollapsed && pinnedChats.length === 0 && (
                  <div className="px-3 py-2 text-[11px] text-[#9E9D9A] italic">No pinned chats</div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Recent Chats Section */}
        {(!isCollapsed || recentChats.length > 0) && (
          <div className="flex-1 flex flex-col min-h-0 space-y-1">
            {!isCollapsed && (
              <div
                onClick={() => setIsRecentExpanded(!isRecentExpanded)}
                className="px-2 flex items-center justify-between text-[12px] font-medium text-[#9E9D9A] tracking-tighter select-none mb-1 cursor-pointer hover:text-[#2E2E2D] dark:hover:text-white transition-colors group/header"
              >
                <div className="flex items-center gap-1.5">
                  <HugeiconsIcon
                    icon={ArrowDown}
                    size={10}
                    className={cn(
                      'transition-transform duration-200 text-[#9E9D9A] group-hover/header:text-[#2E2E2D] dark:group-hover/header:text-white',
                      !isRecentExpanded && '-rotate-90'
                    )}
                  />
                  <span className="font-sans">Recent Chats</span>
                </div>
              </div>
            )}

            {isRecentExpanded && (
              <div
                className={cn(
                  'flex-1 space-y-0.5 min-h-0 pr-0.5',
                  activeDropdownId ? 'overflow-visible' : 'overflow-y-auto no-scrollbar'
                )}
              >
                {recentChats.map((chat) => (
                  <div
                    key={chat.id}
                    className={cn(
                      'group relative flex items-center rounded-lg text-sm transition-all cursor-pointer',
                      isCollapsed ? 'justify-center h-10' : 'h-8 px-3 gap-1.5',
                      activeChatId === chat.id
                        ? 'bg-[#EAE8E3] dark:bg-[#2C2C2A] text-[#2E2E2D] dark:text-[#EAE8E3] font-medium'
                        : 'text-[#6E6D6A] dark:text-[#9E9D9A] hover:text-[#2E2E2D] dark:hover:text-[#EAE8E3] hover:bg-[#F1EFEA] dark:hover:bg-[#2C2C2A]/50'
                    )}
                    onClick={() => setActiveChatId(chat.id)}
                  >
                    <HugeiconsIcon
                      icon={Message01Icon}
                      size={14}
                      className="shrink-0 text-[#9E9D9A] group-hover:text-[#2E2E2D] dark:text-[#6E6D6A] dark:group-hover:text-[#EAE8E3]"
                    />
                    {!isCollapsed &&
                      (editingChatId === chat.id ? (
                        <input
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          onBlur={() => handleSaveRename(chat.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveRename(chat.id)
                            if (e.key === 'Escape') setEditingChatId(null)
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="text-xs font-medium text-[#2E2E2D] dark:text-[#EAE8E3] bg-[#FAF9F6] dark:bg-[#252523] border border-[#E5E3DF] dark:border-[#2C2C2A] rounded px-1.5 py-0.5 outline-hidden w-[70%] font-sans"
                          autoFocus
                        />
                      ) : (
                        <span className="truncate pr-8 w-full">{chat.title}</span>
                      ))}

                    {/* Actions Dropdown (Triple vertical dots) */}
                    {!isCollapsed && (
                      <div className="absolute right-2 top-1.5 flex items-center">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setActiveDropdownId(activeDropdownId === chat.id ? null : chat.id)
                          }}
                          className={cn(
                            'p-0.5 rounded hover:bg-[#EAE8E3] dark:hover:bg-[#2C2C2A] text-[#9E9D9A] hover:text-[#2E2E2D] dark:hover:text-[#EAE8E3] transition-colors cursor-pointer',
                            activeDropdownId === chat.id ? 'flex' : 'hidden group-hover:flex'
                          )}
                          title="Chat actions"
                        >
                          <HugeiconsIcon icon={MoreVerticalIcon} size={12} />
                        </button>

                        {activeDropdownId === chat.id && (
                          <>
                            <div
                              className="fixed inset-0 z-40 cursor-default"
                              onClick={(e) => {
                                e.stopPropagation()
                                setActiveDropdownId(null)
                              }}
                            />
                            <div
                              className="absolute right-0 top-6 w-30 rounded-lg border border-[#E5E3DF] dark:border-[#2C2C2A] bg-[#FAF9F6] dark:bg-[#252523] shadow-md p-1 z-50 flex flex-col text-left text-[11px]"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  onTogglePin(chat.id)
                                  setActiveDropdownId(null)
                                }}
                                className="w-full text-left px-2 py-1.5 rounded-md hover:bg-[#F1EFEA] dark:hover:bg-[#2C2C2A] text-[#2E2E2D] dark:text-[#EAE8E3] flex items-center gap-3.5 cursor-pointer font-medium"
                              >
                                <HugeiconsIcon
                                  icon={PinIcon}
                                  size={12}
                                  className="text-[#6E6D6A] dark:text-[#9E9D9A]"
                                />
                                <span className="text-xs font-semibold">Pin Chat</span>
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  setEditingChatId(chat.id)
                                  setEditTitle(chat.title)
                                  setActiveDropdownId(null)
                                }}
                                className="w-full text-left px-2 py-1.5 rounded-md hover:bg-[#F1EFEA] dark:hover:bg-[#2C2C2A] text-[#2E2E2D] dark:text-[#EAE8E3] flex items-center gap-3.5 cursor-pointer font-medium"
                              >
                                <HugeiconsIcon
                                  icon={EllipsisIcon}
                                  size={12}
                                  className="text-[#6E6D6A] dark:text-[#9E9D9A]"
                                />
                                <span className="text-xs font-semibold">Rename</span>
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation()
                                  onDeleteChat(chat.id)
                                  setActiveDropdownId(null)
                                }}
                                className="w-full text-left px-2 py-1.5 rounded-md hover:bg-red-50 dark:hover:bg-[#441C1A] text-red-600 dark:text-[#F87171] flex items-center gap-3.5 cursor-pointer font-medium"
                              >
                                <HugeiconsIcon
                                  icon={Cancel01Icon}
                                  size={12}
                                  className="text-red-600 dark:text-[#F87171]"
                                />
                                <span className="text-xs font-semibold">Delete</span>
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ))}
                {!isCollapsed && recentChats.length === 0 && (
                  <div className="px-3 py-2 text-[11px] text-[#9E9D9A] italic">No recent chats</div>
                )}
                {/* Spacer to scroll past the absolute floating profile card and optional feature card */}
                <div
                  className={cn('shrink-0', showFeatureCard && !isCollapsed ? 'h-44' : 'h-16')}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Floating card for new feature */}
      {!isCollapsed && showFeatureCard && (
        <div
          className={cn(
            'absolute left-3 right-3 bg-[#FAF9F6] dark:bg-[#252523] border-2 border-[#E5E3DF] dark:border-[#2C2C2A] rounded-xl p-3.5 shadow-sm flex flex-col gap-1.5 transition-all duration-300 ease-in-out',
            showProfileMenu ? 'bottom-50 z-30' : 'bottom-24 z-10'
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-[12px] font-sans tracking-tighter font-medium text-[#6E6D6A] dark:text-[#9E9D9A]">
              New Feature
            </span>
            <button
              onClick={() => setShowFeatureCard(false)}
              className="p-1 rounded-md text-[#9E9D9A] dark:text-[#6E6D6A] hover:text-[#2E2E2D] dark:hover:text-[#EAE8E3] hover:bg-[#EAE8E3]/60 dark:hover:bg-[#2C2C2A]/60 transition-colors cursor-pointer flex items-center justify-center shrink-0"
              title="Dismiss"
            >
              <HugeiconsIcon icon={Cancel01Icon} size={11} />
            </button>
          </div>
          <h4 className="text-sm font-bold text-[#2E2E2D] dark:text-[#EAE8E3]">
            Deep Research Nodes
          </h4>
          <p className="text-[12px] text-[#6E6D6A] dark:text-[#9E9D9A] leading-relaxed">
            Compile files directly from web research pages into active project workspaces. Try
            selecting it in Tools!
          </p>
        </div>
      )}

      {/* Account Section at the Bottom: Floating with progressive linear blur backdrop */}
      <div className="absolute bottom-0 left-0 right-0 h-24 z-20 flex items-end p-3 pb-4">
        {/* Progressive linear blur gradient background layer */}
        <div
          className="absolute inset-0 pointer-events-none -z-10"
          style={{
            backdropFilter: 'blur(14px)',
            WebkitBackdropFilter: 'blur(14px)',
            maskImage: 'linear-gradient(to top, black 25%, transparent 100%)',
            WebkitMaskImage: 'linear-gradient(to top, black 25%, transparent 100%)',
            background: `linear-gradient(to top, ${isDark ? '#1C1C1A' : '#F9F8F6'} 25%, transparent 100%)`
          }}
        />

        {showProfileMenu && !isCollapsed && (
          <>
            <div
              className="fixed inset-0 z-40 cursor-default"
              onClick={(e) => {
                e.stopPropagation()
                setShowProfileMenu(false)
              }}
            />
            <div
              className="absolute bottom-16 left-3 right-3 z-50 bg-[#FAF9F6] dark:bg-[#252523] border border-[#E5E3DF] dark:border-[#2C2C2A] rounded-xl p-1 shadow-md flex flex-col text-left text-[11px] animate-in fade-in-0 slide-in-from-bottom-2 duration-150"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={() => {
                  setShowProfileMenu(false)
                  onOpenProfile()
                }}
                className="w-full text-left px-2.5 py-1.5 rounded-md hover:bg-[#F1EFEA] dark:hover:bg-[#2C2C2A] text-[#2E2E2D] dark:text-[#EAE8E3] flex items-center gap-2.5 cursor-pointer font-medium text-xs"
              >
                <HugeiconsIcon
                  icon={UserIcon}
                  size={13}
                  className="text-[#6E6D6A] dark:text-[#9E9D9A]"
                />
                <span>Profile</span>
              </button>
              <button
                onClick={() => {
                  setShowProfileMenu(false)
                  onOpenHelp()
                }}
                className="w-full text-left px-2.5 py-1.5 rounded-md hover:bg-[#F1EFEA] dark:hover:bg-[#2C2C2A] text-[#2E2E2D] dark:text-[#EAE8E3] flex items-center gap-2.5 cursor-pointer font-medium text-xs"
              >
                <HugeiconsIcon
                  icon={HelpCircleIcon}
                  size={13}
                  className="text-[#6E6D6A] dark:text-[#9E9D9A]"
                />
                <span>Help</span>
              </button>
              <div className="h-px bg-[#E5E3DF] dark:bg-[#2C2C2A] my-0.5" />
              <button
                onClick={async () => {
                  setShowProfileMenu(false)
                  await window.api.logoutUser()
                  window.dispatchEvent(new Event('app:lock'))
                }}
                className="w-full text-left px-2.5 py-1.5 rounded-md hover:bg-[#FCEAE6] dark:hover:bg-[#441C1A] text-[#E0533C] dark:text-[#F87171] flex items-center gap-2.5 cursor-pointer font-semibold text-xs"
              >
                <HugeiconsIcon
                  icon={Logout01Icon}
                  size={13}
                  className="text-[#E0533C] dark:text-[#F87171]"
                />
                <span>Logout</span>
              </button>
            </div>
          </>
        )}

        <div
          onClick={() => {
            if (!isCollapsed) setShowProfileMenu(!showProfileMenu)
          }}
          className={cn(
            'w-full flex items-center justify-between rounded-lg transition-colors p-1.5 cursor-pointer',
            isCollapsed
              ? 'justify-center hover:bg-[#F1EFEA]/80 dark:hover:bg-[#2C2C2A]/80'
              : 'hover:bg-[#F1EFEA]/80 dark:hover:bg-[#2C2C2A]/80'
          )}
        >
          <div className="flex items-center gap-1.5 overflow-hidden bg-transparent">
            {/* Avatar */}
            <div className="w-8 h-8 rounded-md bg-[#eae8e309] border-2 border-[#E5E3DF] dark:border-[#2C2C2A] flex items-center justify-center overflow-hidden shrink-0 select-none">
              {profile.avatarDataUrl ? (
                <img
                  src={profile.avatarDataUrl}
                  alt="Profile"
                  className="w-full h-full object-cover"
                />
              ) : (
                <HugeiconsIcon
                  icon={UserIcon}
                  size={18}
                  className="text-[#6E6D6A] dark:text-[#9E9D9A]"
                />
              )}
            </div>
            {!isCollapsed && (
              <div className="flex flex-col text-left truncate leading-tight select-none">
                <span className="text-sm font-semibold text-[#2E2E2D] dark:text-[#EAE8E3] truncate font-sans">
                  {profile.name || 'Profile'}
                </span>
              </div>
            )}
          </div>

          {!isCollapsed && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                setShowProfileMenu(!showProfileMenu)
              }}
              className="p-1 rounded-md text-[#9E9D9A] dark:text-[#6E6D6A] hover:text-[#2E2E2D] dark:hover:text-[#EAE8E3] hover:bg-[#EAE8E3]/60 dark:hover:bg-[#2C2C2A]/60 transition-colors cursor-pointer"
              title="Settings"
            >
              <HugeiconsIcon icon={EllipsisIcon} size={14} />
            </button>
          )}
        </div>
      </div>
    </aside>
  )
}
