import { useEffect, useRef, useState } from 'react'

const delays = Array.from({ length: 9 }, (_, i) => ((i % 3) + Math.abs(Math.floor(i / 3) - 1)) * 90)

export function LoadingState(): React.JSX.Element {
  const started = useRef(0)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    started.current = performance.now()
    const timer = setInterval(() => setElapsed(performance.now() - started.current), 100)
    return () => clearInterval(timer)
  }, [])

  const seconds = Math.floor(elapsed / 100) / 10
  const time =
    seconds < 60
      ? `${seconds.toFixed(1)}s`
      : `${Math.floor(seconds / 60)}m ${(seconds % 60).toFixed(1)}s`

  return (
    <div role="status" aria-label="Thinking" className="flex items-center gap-2.5">
      <span aria-hidden="true" className="grid shrink-0 grid-cols-[repeat(3,4px)] gap-[1.5px]">
        {delays.map((delay, index) => (
          <span
            key={index}
            className="atlas-loading-cell size-[4px] rounded-[1px] bg-foreground"
            style={{ animationDelay: `${delay}ms` }}
          />
        ))}
      </span>
      <span className="shimmer-text text-sm font-medium">Thinking</span>
      <span
        aria-hidden="true"
        className="font-mono text-xs tabular-nums text-[#6E6D6A] dark:text-[#9E9D9A]"
      >
        {time}
      </span>
    </div>
  )
}
