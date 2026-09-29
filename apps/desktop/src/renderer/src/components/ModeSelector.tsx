import type { JSX } from 'react'
import type { ExecutionMode } from '@/lib/modes'

export function ModeSelector({
  value,
  onChange
}: {
  value: ExecutionMode
  onChange: (mode: ExecutionMode) => void
}): JSX.Element {
  return (
    <>
      <label htmlFor="execution-mode" className="sr-only">
        Execution mode
      </label>
      <select
        id="execution-mode"
        value={value}
        onChange={(event) => onChange(event.target.value as ExecutionMode)}
        className="h-8 rounded-lg border border-[#E5E3DF] bg-white px-2 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring dark:border-[#4d4d4d] dark:bg-[#303030] dark:text-white"
      >
        <option value="auto">Auto</option>
        <option value="research">Research</option>
        <option value="coding">Coding</option>
        <option value="documentation">Documentation</option>
      </select>
    </>
  )
}
