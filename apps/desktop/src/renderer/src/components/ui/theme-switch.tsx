'use client'

import React, { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { SunIcon, MoonIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

const ThemeSwitch = ({ className, ...props }: React.HTMLAttributes<HTMLButtonElement>) => {
  const { resolvedTheme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)
  const [checked, setChecked] = useState(false)

  useEffect(() => setMounted(true), [])
  useEffect(() => setChecked(resolvedTheme === 'dark'), [resolvedTheme])

  if (!mounted) return null

  return (
    <button
      onClick={() => setTheme(checked ? 'light' : 'dark')}
      className={cn(
        'p-1.5 rounded-lg hover:bg-[#F1EFEA] dark:hover:bg-[#2C2C2A] text-[#6E6D6A] dark:text-[#9E9D9A] hover:text-[#2E2E2D] dark:hover:text-[#EAE8E3] transition-colors cursor-pointer flex items-center justify-center shrink-0',
        className
      )}
      {...props}
      title={checked ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
    >
      <div className="transition-transform duration-300 ease-out transform hover:rotate-12">
        {checked ? <MoonIcon size={16} /> : <SunIcon size={16} />}
      </div>
    </button>
  )
}

export default ThemeSwitch
