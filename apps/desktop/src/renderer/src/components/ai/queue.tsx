import { ChevronDownIcon, PaperclipIcon } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'

export interface QueueMessagePart {
  type: string
  text?: string
  url?: string
  filename?: string
  mediaType?: string
}

export interface QueueMessage {
  id: string
  parts: QueueMessagePart[]
}

export interface QueueTodo {
  id: string
  title: string
  description?: string
  status?: 'pending' | 'completed'
}

export type QueueItemProps = ComponentProps<'li'>

export const QueueItem = ({ className, ...props }: QueueItemProps) => (
  <li
    className={cn(
      'group flex flex-col gap-1 rounded-md px-3 py-1 text-[11px] transition-colors hover:bg-[#F1EFEA] dark:hover:bg-[#2C2C2A]',
      className
    )}
    {...props}
  />
)

export type QueueItemIndicatorProps = ComponentProps<'span'> & {
  completed?: boolean
}

export const QueueItemIndicator = ({
  completed = false,
  className,
  ...props
}: QueueItemIndicatorProps) => (
  <span
    className={cn(
      'mt-0.5 inline-block size-2 rounded-full border',
      completed
        ? 'border-[#9E9D9A]/40 bg-[#9E9D9A]/20 dark:border-[#6E6D6A]/40 dark:bg-[#6E6D6A]/20'
        : 'border-[#9E9D9A] dark:border-[#6E6D6A]',
      className
    )}
    {...props}
  />
)

export type QueueItemContentProps = ComponentProps<'span'> & {
  completed?: boolean
}

export const QueueItemContent = ({
  completed = false,
  className,
  ...props
}: QueueItemContentProps) => (
  <span
    className={cn(
      'line-clamp-1 grow break-words',
      completed
        ? 'text-[#9E9D9A]/60 dark:text-[#6E6D6A]/60 line-through'
        : 'text-[#6E6D6A] dark:text-[#9E9D9A]',
      className
    )}
    {...props}
  />
)

export type QueueItemDescriptionProps = ComponentProps<'div'> & {
  completed?: boolean
}

export const QueueItemDescription = ({
  completed = false,
  className,
  ...props
}: QueueItemDescriptionProps) => (
  <div
    className={cn(
      'ml-6 text-[10px]',
      completed
        ? 'text-[#9E9D9A]/50 dark:text-[#6E6D6A]/50 line-through'
        : 'text-[#6E6D6A] dark:text-[#9E9D9A]',
      className
    )}
    {...props}
  />
)

export type QueueItemActionsProps = ComponentProps<'div'>

export const QueueItemActions = ({ className, ...props }: QueueItemActionsProps) => (
  <div className={cn('flex gap-1', className)} {...props} />
)

export type QueueItemActionProps = Omit<ComponentProps<typeof Button>, 'variant' | 'size'>

export const QueueItemAction = ({ className, ...props }: QueueItemActionProps) => (
  <Button
    className={cn(
      'size-auto rounded p-1 text-[#9E9D9A] dark:text-[#6E6D6A] opacity-0 transition-opacity hover:bg-[#F1EFEA] dark:hover:bg-[#2C2C2A] hover:text-[#2E2E2D] dark:hover:text-[#EAE8E3] group-hover:opacity-100',
      className
    )}
    size="icon"
    type="button"
    variant="ghost"
    {...props}
  />
)

export type QueueItemAttachmentProps = ComponentProps<'div'>

export const QueueItemAttachment = ({ className, ...props }: QueueItemAttachmentProps) => (
  <div className={cn('mt-1 flex flex-wrap gap-2', className)} {...props} />
)

export type QueueItemImageProps = ComponentProps<'img'>

export const QueueItemImage = ({ className, ...props }: QueueItemImageProps) => (
  <img
    alt=""
    className={cn(
      'h-8 w-8 rounded border border-[#E5E3DF] dark:border-[#2C2C2A] object-cover',
      className
    )}
    height={32}
    width={32}
    {...props}
  />
)

export type QueueItemFileProps = ComponentProps<'span'>

export const QueueItemFile = ({ children, className, ...props }: QueueItemFileProps) => (
  <span
    className={cn(
      'flex items-center gap-1 rounded border border-[#E5E3DF] dark:border-[#2C2C2A] bg-[#F1EFEA] dark:bg-[#2C2C2A] px-2 py-1 text-[10px] text-[#2E2E2D] dark:text-[#EAE8E3]',
      className
    )}
    {...props}
  >
    <PaperclipIcon size={12} />
    <span className="max-w-[100px] truncate">{children}</span>
  </span>
)

export type QueueListProps = ComponentProps<typeof ScrollArea>

export const QueueList = ({ children, className, ...props }: QueueListProps) => (
  <ScrollArea className={cn('-mb-1 mt-2', className)} {...props}>
    <div className="max-h-40 pr-4">
      <ul>{children}</ul>
    </div>
  </ScrollArea>
)

export type QueueSectionProps = ComponentProps<typeof Collapsible>

export const QueueSection = ({ className, defaultOpen = true, ...props }: QueueSectionProps) => (
  <Collapsible className={cn(className)} defaultOpen={defaultOpen} {...props} />
)

export type QueueSectionTriggerProps = ComponentProps<'button'>

export const QueueSectionTrigger = ({
  children,
  className,
  ...props
}: QueueSectionTriggerProps) => (
  <CollapsibleTrigger asChild>
    <button
      className={cn(
        'group flex w-full items-center justify-between rounded-lg bg-[#F1EFEA]/60 dark:bg-[#2C2C2A]/60 px-3 py-2 text-left text-[11px] font-medium text-[#6E6D6A] dark:text-[#9E9D9A] transition-colors hover:bg-[#F1EFEA] dark:hover:bg-[#2C2C2A]',
        className
      )}
      type="button"
      {...props}
    >
      {children}
    </button>
  </CollapsibleTrigger>
)

export type QueueSectionLabelProps = ComponentProps<'span'> & {
  count?: number
  label: string
  icon?: ReactNode
}

export const QueueSectionLabel = ({
  count,
  label,
  icon,
  className,
  ...props
}: QueueSectionLabelProps) => (
  <span className={cn('flex items-center gap-2', className)} {...props}>
    <ChevronDownIcon className="size-3.5 transition-transform group-data-[state=closed]:-rotate-90" />
    {icon}
    <span>
      {count} {label}
    </span>
  </span>
)

export type QueueSectionContentProps = ComponentProps<typeof CollapsibleContent>

export const QueueSectionContent = ({ className, ...props }: QueueSectionContentProps) => (
  <CollapsibleContent className={cn(className)} {...props} />
)

export type QueueProps = ComponentProps<'div'>

export const Queue = ({ className, ...props }: QueueProps) => (
  <div
    className={cn(
      'flex flex-col gap-2 rounded-xl border border-[#E5E3DF] dark:border-[#2C2C2A] bg-white dark:bg-[#252523] px-3 pt-2 pb-2',
      className
    )}
    {...props}
  />
)
