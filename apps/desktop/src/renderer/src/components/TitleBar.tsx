import React from 'react'
import SidebarIcon from '@/assets/icon/icon.png'
export default function TitleBar(): React.JSX.Element {
  const handleMinimize = (): void => {
    window.api.minimizeWindow()
  }

  const handleMaximize = (): void => {
    window.api.maximizeWindow()
  }

  const handleClose = (): void => {
    window.api.closeWindow()
  }

  return (
    <div
      className="h-10 w-full flex items-center justify-between px-4 pt-2 bg-[#FAF9F6] dark:bg-[#171717] b text-[#2E2E2D] dark:text-[#EAE8E3] select-none shrink-0"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Left side: Logo + Atlas title */}
      <div
        className="flex items-center gap-2"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <img
          src={SidebarIcon}
          className="w-5 h-5 object-conver rounded-md shrink-0 items-center"
          alt="Logo"
        />
        <span className="font-medium text-md tracking-tighter font-sans">Atlas</span>
      </div>

      {/* Right side: Window management controls */}
      <div
        className="flex items-center h-full"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        {/* Minimize */}
        <button
          onClick={handleMinimize}
          className="w-6 h-6 rounded-md flex items-center justify-center hover:bg-[#F1EFEA] dark:hover:bg-[#daffcb] transition-colors duration-150 cursor-pointer text-[#6E6D6A] dark:text-[#9E9D9A] hover:dark:text-[#000000]"
          title="Minimize"
        >
          <svg
            className="w-3.5 h-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>

        {/* Maximize */}
        <button
          onClick={handleMaximize}
          className="w-6 h-6 rounded-md flex items-center justify-center hover:bg-[#F1EFEA] dark:hover:bg-[#ffe987] transition-colors duration-150 cursor-pointer text-[#6E6D6A] dark:text-[#757575] hover:dark:text-[#000000]"
          title="Maximize"
        >
          <svg
            className="w-3 h-3"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
          </svg>
        </button>

        {/* Close */}
        <button
          onClick={handleClose}
          className="w-6 h-6 rounded-md flex items-center justify-center hover:bg-red-500 hover:text-white dark:hover:bg-red-600 transition-colors duration-150 cursor-pointer text-[#6E6D6A] dark:text-[#9E9D9A] hover:dark:text-[#000000]"
          title="Close"
        >
          <svg
            className="w-3.5 h-3.5"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  )
}
