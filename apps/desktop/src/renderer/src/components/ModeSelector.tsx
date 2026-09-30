import { useState, type JSX } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { ChevronDown } from 'lucide-react'
import type { ExecutionMode } from '@/lib/modes'

const modes: { value: ExecutionMode; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'research', label: 'Research' },
  { value: 'coding', label: 'Coding' },
  { value: 'documentation', label: 'Documentation' }
]

export function ModeSelector({
  value,
  onChange
}: {
  value: ExecutionMode
  onChange: (mode: ExecutionMode) => void
}): JSX.Element {
  const [open, setOpen] = useState(false)
  const label = modes.find((mode) => mode.value === value)?.label ?? 'Auto'

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={`Execution mode: ${label}`}
          className="flex h-8 items-center gap-2 rounded-full border-2 border-[#e5e3df11] px-2.5 text-xs text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-white dark:hover:bg-[#515151] cursor-pointer"
        >
          <span>{label}</span>
          <ChevronDown className="h-3.5 w-3.5 text-neutral-500" aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={4}
          aria-label="Execution mode options"
          className="z-50 w-64 rounded-xl border border-[#E5E3DF] bg-[#FAF9F6] p-2 text-[#2E2E2D] shadow-md outline-none dark:border-[#2C2C2A] dark:bg-[#252523] dark:text-[#EAE8E3] animate-in data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0 data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2"
        >
          <div className="flex flex-col gap-3">
            {modes.map((mode) => (
              <button
                key={mode.value}
                type="button"
                aria-pressed={mode.value === value}
                onClick={() => {
                  onChange(mode.value)
                  setOpen(false)
                }}
                className="flex w-full cursor-pointer items-center gap-2 rounded-md p-2 text-left text-xs text-[#6E6D6A] hover:bg-[#F1EFEA] hover:text-[#2E2E2D] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring dark:text-[#9E9D9A] dark:hover:bg-[#2C2C2A] dark:hover:text-[#EAE8E3]"
              >
                {mode.label}
              </button>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
