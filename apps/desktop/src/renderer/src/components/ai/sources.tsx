'use client'

import { BookIcon, ChevronDownIcon } from 'lucide-react'
import type { ComponentProps } from 'react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'

export type SourcesProps = ComponentProps<'div'>

export const Sources = ({ className, ...props }: SourcesProps) => (
  <Collapsible className={cn('mb-2 text-[11px]', className)} {...props} />
)

export type SourcesTriggerProps = ComponentProps<typeof CollapsibleTrigger> & {
  count: number
}

export const SourcesTrigger = ({ className, count, children, ...props }: SourcesTriggerProps) => (
  <CollapsibleTrigger
    className={cn(
      'group flex items-center gap-2 rounded-lg px-2 py-1 font-medium text-[#6E6D6A] dark:text-[#9E9D9A] transition-colors hover:bg-[#F1EFEA] dark:hover:bg-[#2C2C2A] hover:text-[#2E2E2D] dark:hover:text-[#EAE8E3] cursor-pointer',
      className
    )}
    {...props}
  >
    {children ?? (
      <>
        <p>
          Used {count} source{count === 1 ? '' : 's'}
        </p>
        <ChevronDownIcon className="size-3.5 transition-transform group-data-[state=open]:rotate-180" />
      </>
    )}
  </CollapsibleTrigger>
)

export type SourcesContentProps = ComponentProps<typeof CollapsibleContent>

export const SourcesContent = ({ className, ...props }: SourcesContentProps) => (
  <CollapsibleContent
    className={cn(
      'mt-1 flex w-fit flex-col gap-1.5 rounded-lg border border-[#E5E3DF] dark:border-[#2C2C2A] px-3 py-2',
      'data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
      className
    )}
    {...props}
  />
)

export type SourceProps = ComponentProps<'a'>

export const Source = ({ href, title, children, ...props }: SourceProps) => (
  <a
    className="flex items-center gap-2 text-[#6E6D6A] dark:text-[#9E9D9A] hover:text-[#2E2E2D] dark:hover:text-[#EAE8E3] hover:underline"
    href={href}
    rel="noreferrer"
    target="_blank"
    {...props}
  >
    {children ?? (
      <>
        <BookIcon className="size-3.5 shrink-0" />
        <span className="block truncate">{title}</span>
      </>
    )}
  </a>
)
