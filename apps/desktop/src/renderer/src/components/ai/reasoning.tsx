'use client'

import { useControllableState } from '@radix-ui/react-use-controllable-state'
import { BrainIcon, ChevronDownIcon } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { createContext, memo, useContext, useEffect, useState } from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

interface ReasoningContextValue {
  isStreaming: boolean
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  duration: number | undefined
}

const ReasoningContext = createContext<ReasoningContextValue | null>(null)

export const useReasoning = (): ReasoningContextValue => {
  const context = useContext(ReasoningContext)
  if (!context) {
    throw new Error('Reasoning components must be used within Reasoning')
  }
  return context
}

export type ReasoningProps = ComponentProps<typeof Collapsible> & {
  isStreaming?: boolean
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  duration?: number
}

const AUTO_CLOSE_DELAY = 1000
const MS_IN_S = 1000

export const Reasoning = memo(
  ({
    className,
    isStreaming = false,
    open,
    defaultOpen = true,
    onOpenChange,
    duration: durationProp,
    children,
    ...props
  }: ReasoningProps) => {
    const [isOpen, setIsOpen] = useControllableState({
      prop: open,
      defaultProp: defaultOpen,
      onChange: onOpenChange
    })
    const [duration, setDuration] = useControllableState({
      prop: durationProp,
      defaultProp: undefined
    })

    const [hasAutoClosed, setHasAutoClosed] = useState(false)
    const [startTime, setStartTime] = useState<number | null>(null)

    // Track duration when streaming starts and ends
    useEffect(() => {
      if (isStreaming) {
        if (startTime === null) {
          setStartTime(Date.now())
        }
      } else if (startTime !== null) {
        setDuration(Math.ceil((Date.now() - startTime) / MS_IN_S))
        setStartTime(null)
      }
    }, [isStreaming, startTime, setDuration])

    // Auto-open when streaming starts, auto-close when streaming ends (once only)
    useEffect(() => {
      if (defaultOpen && !isStreaming && isOpen && !hasAutoClosed) {
        const timer = setTimeout(() => {
          setIsOpen(false)
          setHasAutoClosed(true)
        }, AUTO_CLOSE_DELAY)

        return () => clearTimeout(timer)
      }
      return undefined
    }, [isStreaming, isOpen, defaultOpen, setIsOpen, hasAutoClosed])

    return (
      <ReasoningContext.Provider value={{ isStreaming, isOpen: !!isOpen, setIsOpen, duration }}>
        <Collapsible
          className={cn('mb-2', className)}
          onOpenChange={setIsOpen}
          open={isOpen}
          {...props}
        >
          {children}
        </Collapsible>
      </ReasoningContext.Provider>
    )
  }
)

export type ReasoningTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
  getThinkingMessage?: (isStreaming: boolean, duration?: number) => ReactNode
}

const defaultGetThinkingMessage = (isStreaming: boolean, duration?: number): ReactNode => {
  if (isStreaming || duration === 0) {
    return <span className="shimmer-text">Thinking...</span>
  }
  if (duration === undefined) {
    return <span>Thought for a few seconds</span>
  }
  return (
    <span>
      Thought for {duration} second{duration === 1 ? '' : 's'}
    </span>
  )
}

export const ReasoningTrigger = memo(
  ({
    className,
    children,
    getThinkingMessage = defaultGetThinkingMessage,
    ...props
  }: ReasoningTriggerProps) => {
    const { isStreaming, isOpen, duration } = useReasoning()

    return (
      <CollapsibleTrigger
        className={cn(
          'flex w-full items-center gap-2 rounded-lg px-2 py-1 text-[11px] font-medium text-[#6E6D6A] dark:text-[#9E9D9A] transition-colors hover:bg-[#F1EFEA] dark:hover:bg-[#2C2C2A] hover:text-[#2E2E2D] dark:hover:text-[#EAE8E3] cursor-pointer',
          className
        )}
        {...props}
      >
        {children ?? (
          <>
            <BrainIcon className="size-3.5" />
            {getThinkingMessage(isStreaming, duration)}
            <ChevronDownIcon
              className={cn('size-3.5 ml-auto transition-transform', isOpen && 'rotate-180')}
            />
          </>
        )}
      </CollapsibleTrigger>
    )
  }
)

export type ReasoningContentProps = ComponentProps<typeof CollapsibleContent> & {
  children: string
}

export const ReasoningContent = memo(({ className, children, ...props }: ReasoningContentProps) => (
  <CollapsibleContent
    className={cn(
      'mt-1 rounded-lg border border-[#E5E3DF] dark:border-[#2C2C2A] px-3 py-2 text-[11px] leading-relaxed text-[#6E6D6A] dark:text-[#9E9D9A] whitespace-pre-wrap',
      'data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className
    )}
    {...props}
  >
    {children}
  </CollapsibleContent>
))

Reasoning.displayName = 'Reasoning'
ReasoningTrigger.displayName = 'ReasoningTrigger'
ReasoningContent.displayName = 'ReasoningContent'
