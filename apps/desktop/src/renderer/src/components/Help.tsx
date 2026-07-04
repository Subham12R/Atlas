import React from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import { Cancel01Icon } from '@hugeicons/core-free-icons'

interface HelpProps {
  onClose: () => void
}

const TOPICS = [
  {
    title: 'Switching models',
    body: 'Use the model dropdown in the top-left of a chat to pick Gemini, ChatGPT, Perplexity, or Claude. You can switch mid-conversation -- the new model gets a short recap of the last couple of exchanges to pick up where things left off.'
  },
  {
    title: 'Connecting accounts',
    body: 'Open your profile menu -> Connect accounts to sync session cookies from an already-logged-in Chromium-based browser (Brave, Chrome, Edge, Vivaldi) or Firefox-based browser (Firefox, Zen, LibreWolf, Waterfox). No separate login needed if you’re already signed in there.'
  },
  {
    title: 'Attachments',
    body: 'Attach text-based files (.md, .txt, .csv, .json, and common source files) alongside your prompt -- their content gets included for the model to read. Image attachments are preview-only for now; no provider here supports real image understanding yet.'
  },
  {
    title: 'Exporting a chat',
    body: 'The share icon in a chat’s header exports the full conversation as a PDF.'
  },
  {
    title: 'Library',
    body: 'Browse and search every chat you’ve had, pin, rename, or delete them, from one place.'
  }
]

export default function Help({ onClose }: HelpProps): React.JSX.Element {
  return (
    <main className="flex-1 h-full flex flex-col bg-[#FAF9F6] dark:bg-[#1E1E1C] overflow-hidden">
      <div className="shrink-0 px-6 md:px-10 pt-6 pb-4">
        <div className="max-w-xl mx-auto flex items-center justify-between">
          <h1 className="text-lg font-semibold tracking-tight text-[#2E2E2D] dark:text-[#EAE8E3]">
            Help
          </h1>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[#F1EFEA] dark:hover:bg-[#2C2C2A] text-[#6E6D6A] dark:text-[#9E9D9A] hover:text-[#2E2E2D] dark:hover:text-[#EAE8E3] transition-colors cursor-pointer"
            title="Back to chat"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={18} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar px-6 md:px-10 pb-10">
        <div className="max-w-xl mx-auto space-y-6">
          {TOPICS.map((topic) => (
            <div key={topic.title} className="space-y-1">
              <h2 className="text-sm font-semibold text-[#2E2E2D] dark:text-[#EAE8E3]">
                {topic.title}
              </h2>
              <p className="text-xs text-[#6E6D6A] dark:text-[#9E9D9A] leading-relaxed">
                {topic.body}
              </p>
            </div>
          ))}

          <div className="pt-4 border-t border-[#E5E3DF] dark:border-[#2C2C2A]">
            <p className="text-[10px] text-[#9E9D9A] dark:text-[#6E6D6A]">
              Electron v{window.electron.process.versions.electron} · Chromium v
              {window.electron.process.versions.chrome} · Node v
              {window.electron.process.versions.node}
            </p>
          </div>
        </div>
      </div>
    </main>
  )
}
