import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/** One piece of context the reply (or a search) drew on: a memory recall,
 * a saved fact, or an indexed document chunk. Clickable when `onClick` is set. */
export function ContextCard({
  label,
  meta,
  children,
  onClick
}: {
  label: string
  meta?: string
  children?: ReactNode
  onClick?: () => void
}): React.JSX.Element {
  const Tag = onClick ? 'button' : 'article'
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'block w-full rounded-lg border border-[#E5E3DF] bg-[#FAF9F6] p-2.5 text-left text-xs dark:border-[#2C2C2A] dark:bg-[#1F1F1D]',
        onClick &&
          'cursor-pointer hover:bg-[#F1EFEA] focus-visible:outline-2 focus-visible:outline-ring dark:hover:bg-[#2C2C2A]'
      )}
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="truncate font-medium text-[#2E2E2D] dark:text-[#EAE8E3]">{label}</span>
        {meta && <span className="shrink-0 text-[10px] text-[#6E6D6A] dark:text-[#9E9D9A]">{meta}</span>}
      </span>
      {children && (
        <span className="mt-1 line-clamp-3 text-[#6E6D6A] dark:text-[#9E9D9A]">{children}</span>
      )}
    </Tag>
  )
}
