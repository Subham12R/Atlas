import React, { useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Search01Icon,
  PinIcon,
  EllipsisIcon,
  Cancel01Icon,
  Message01Icon
} from '@hugeicons/core-free-icons'
import { cn } from '@/lib/utils'
import type { Chat } from './ChatArea'

interface LibraryProps {
  chats: Chat[]
  onSelectChat: (id: string) => void
  onClose: () => void
  onTogglePin: (id: string) => void
  onDeleteChat: (id: string) => void
  onRenameChat: (id: string, newTitle: string) => void
}

export default function Library({
  chats,
  onSelectChat,
  onClose,
  onTogglePin,
  onDeleteChat,
  onRenameChat
}: LibraryProps): React.JSX.Element {
  const [searchQuery, setSearchQuery] = useState('')
  const [editingChatId, setEditingChatId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')

  const filteredChats = chats
    .filter((chat) => chat.title.toLowerCase().includes(searchQuery.toLowerCase()))
    .sort((a, b) => Number(b.isPinned) - Number(a.isPinned))

  const startRename = (chat: Chat): void => {
    setEditingChatId(chat.id)
    setEditTitle(chat.title)
  }

  const saveRename = (id: string): void => {
    if (editTitle.trim()) onRenameChat(id, editTitle.trim())
    setEditingChatId(null)
  }

  return (
    <main className="flex-1 h-full flex flex-col bg-[#FAF9F6] dark:bg-[#1E1E1C] overflow-hidden">
      {/* Fixed header: title + close, and the search bar */}
      <div className="shrink-0 px-6 md:px-10 pt-6 pb-4">
        <div className="max-w-3xl mx-auto space-y-4">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold tracking-tight text-[#2E2E2D] dark:text-[#EAE8E3]">
              Library
            </h1>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-[#F1EFEA] dark:hover:bg-[#2C2C2A] text-[#6E6D6A] dark:text-[#9E9D9A] hover:text-[#2E2E2D] dark:hover:text-[#EAE8E3] transition-colors cursor-pointer"
              title="Back to chat"
            >
              <HugeiconsIcon icon={Cancel01Icon} size={18} />
            </button>
          </div>

          <div className="flex items-center gap-2 h-10 rounded-xl px-3 bg-[#F1EFEA] dark:bg-[#2C2C2A]">
            <HugeiconsIcon
              icon={Search01Icon}
              size={16}
              className="text-[#6E6D6A] dark:text-[#9E9D9A] shrink-0"
            />
            <input
              autoFocus
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search all chats..."
              className="flex-1 min-w-0 bg-transparent outline-none text-sm font-medium text-[#2E2E2D] dark:text-[#EAE8E3] placeholder:text-[#9E9D9A] placeholder:font-normal"
            />
          </div>
        </div>
      </div>

      {/* Scrollable row list */}
      <div className="flex-1 overflow-y-auto no-scrollbar px-6 md:px-10 pb-6">
        <div className="max-w-3xl mx-auto space-y-0.5">
          {filteredChats.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-[#9E9D9A] dark:text-[#6E6D6A] select-none">
              <HugeiconsIcon icon={Message01Icon} size={28} />
              <p className="mt-3 text-sm">
                {searchQuery ? 'No chats match your search.' : 'No chats yet.'}
              </p>
            </div>
          )}

          {filteredChats.map((chat) => (
            <div
              key={chat.id}
              onClick={() => onSelectChat(chat.id)}
              className="group flex items-center justify-between gap-4 px-3 py-3 rounded-xl hover:bg-[#F1EFEA] dark:hover:bg-[#2C2C2A] cursor-pointer transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                {chat.isPinned && (
                  <HugeiconsIcon
                    icon={PinIcon}
                    size={13}
                    className="shrink-0 text-[#9E9D9A] dark:text-[#6E6D6A]"
                  />
                )}
                {editingChatId === chat.id ? (
                  <input
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onBlur={() => saveRename(chat.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') saveRename(chat.id)
                      if (e.key === 'Escape') setEditingChatId(null)
                    }}
                    onClick={(e) => e.stopPropagation()}
                    autoFocus
                    className="text-sm font-medium text-[#2E2E2D] dark:text-[#EAE8E3] bg-[#FAF9F6] dark:bg-[#252523] border border-[#E5E3DF] dark:border-[#2C2C2A] rounded px-1.5 py-0.5 outline-hidden"
                  />
                ) : (
                  <span className="truncate text-sm font-medium text-[#2E2E2D] dark:text-[#EAE8E3]">
                    {chat.title}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <span className="text-xs text-[#9E9D9A] dark:text-[#6E6D6A]">{chat.timestamp}</span>
                <div className="hidden group-hover:flex items-center gap-1">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onTogglePin(chat.id)
                    }}
                    className={cn(
                      'p-1 rounded-md hover:bg-[#E5E3DF] dark:hover:bg-[#333331] transition-colors cursor-pointer',
                      chat.isPinned
                        ? 'text-[#2E2E2D] dark:text-[#EAE8E3]'
                        : 'text-[#9E9D9A] dark:text-[#6E6D6A]'
                    )}
                    title={chat.isPinned ? 'Unpin' : 'Pin'}
                  >
                    <HugeiconsIcon
                      icon={PinIcon}
                      size={13}
                      className={chat.isPinned ? 'fill-[#2E2E2D] dark:fill-[#EAE8E3]' : ''}
                    />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      startRename(chat)
                    }}
                    className="p-1 rounded-md text-[#9E9D9A] dark:text-[#6E6D6A] hover:bg-[#E5E3DF] dark:hover:bg-[#333331] hover:text-[#2E2E2D] dark:hover:text-[#EAE8E3] transition-colors cursor-pointer"
                    title="Rename"
                  >
                    <HugeiconsIcon icon={EllipsisIcon} size={13} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onDeleteChat(chat.id)
                    }}
                    className="p-1 rounded-md text-red-500 dark:text-[#F87171] hover:bg-red-50 dark:hover:bg-[#441C1A] transition-colors cursor-pointer"
                    title="Delete"
                  >
                    <HugeiconsIcon icon={Cancel01Icon} size={13} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </main>
  )
}
