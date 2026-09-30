import React from 'react'
import SidebarIcon from '@/assets/icon/icon.png'

export default function TitleBar({
  transparent = false
}: {
  transparent?: boolean
}): React.JSX.Element {
  const controls = [
    {
      label: 'Close',
      color: 'bg-[#ff5f57] border-[#e0443e]',
      symbol: '×',
      action: () => window.api.closeWindow()
    },
    {
      label: 'Minimize',
      color: 'bg-[#febc2e] border-[#dea123]',
      symbol: '−',
      action: () => window.api.minimizeWindow()
    },
    {
      label: 'Maximize',
      color: 'bg-[#28c840] border-[#1aab29]',
      symbol: '+',
      action: () => window.api.maximizeWindow()
    }
  ]

  return (
    <div
      className={`relative z-20 h-10 w-full flex items-center gap-5 px-4 pt-2 text-[#2E2E2D] dark:text-[#EAE8E3] select-none shrink-0 ${transparent ? 'bg-transparent' : 'bg-[#FAF9F6] dark:bg-[#171717]'}`}
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div
        className="flex items-center gap-2"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {controls.map(({ label, color, symbol, action }) => (
          <button
            key={label}
            type="button"
            onClick={action}
            aria-label={label}
            title={label}
            className="group grid size-7 place-items-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-current"
          >
            <span
              aria-hidden="true"
              className={`grid size-3.5 place-items-center rounded-full border ${color} text-[11px] leading-none text-black/0 group-hover:text-black/60 group-focus-visible:text-black/60`}
            >
              {symbol}
            </span>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 pointer-events-none">
        <img src={SidebarIcon} className="size-5 object-contain rounded-md" alt="" />
        <span className="font-medium text-md tracking-tighter font-sans">Atlas</span>
      </div>
    </div>
  )
}
