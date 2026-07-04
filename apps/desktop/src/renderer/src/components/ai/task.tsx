'use client'

import { ChevronDownIcon, SearchIcon } from 'lucide-react'
import type { ComponentProps } from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

export type TaskItemFileProps = ComponentProps<'div'>

export const TaskItemFile = ({ children, className, ...props }: TaskItemFileProps) => (
  <div
    className={cn(
      'inline-flex items-center gap-1 rounded-md border border-[#E5E3DF] dark:border-[#2C2C2A] bg-[#F1EFEA] dark:bg-[#2C2C2A] px-1.5 py-0.5 text-[10px] text-[#2E2E2D] dark:text-[#EAE8E3]',
      className
    )}
    {...props}
  >
    {children}
  </div>
)

export type TaskItemProps = ComponentProps<'div'>

export const TaskItem = ({ children, className, ...props }: TaskItemProps) => (
  <div className={cn('text-[11px] text-[#6E6D6A] dark:text-[#9E9D9A]', className)} {...props}>
    {children}
  </div>
)

export type TaskProps = ComponentProps<typeof Collapsible>

export const Task = ({ defaultOpen = true, className, ...props }: TaskProps) => (
  <Collapsible className={cn('mb-2', className)} defaultOpen={defaultOpen} {...props} />
)

export type TaskTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
  title: string
}

export const TaskTrigger = ({ children, className, title, ...props }: TaskTriggerProps) => (
  <CollapsibleTrigger asChild className={cn('group', className)} {...props}>
    {children ?? (
      <div className="flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-[11px] font-medium text-[#6E6D6A] dark:text-[#9E9D9A] transition-colors hover:bg-[#F1EFEA] dark:hover:bg-[#2C2C2A] hover:text-[#2E2E2D] dark:hover:text-[#EAE8E3]">
        <SearchIcon className="size-3.5" />
        <p>{title}</p>
        <ChevronDownIcon className="size-3.5 ml-auto transition-transform group-data-[state=open]:rotate-180" />
      </div>
    )}
  </CollapsibleTrigger>
)

export type TaskContentProps = ComponentProps<typeof CollapsibleContent>

export const TaskContent = ({ children, className, ...props }: TaskContentProps) => (
  <CollapsibleContent
    className={cn(
      'data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className
    )}
    {...props}
  >
    <div className="mt-1 space-y-1.5 border-l-2 border-[#E5E3DF] dark:border-[#2C2C2A] pl-4">
      {children}
    </div>
  </CollapsibleContent>
)
