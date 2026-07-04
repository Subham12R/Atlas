import { useEffect, useState } from 'react'
import { HashRouter, Route, Routes } from 'react-router-dom'
import { ThemeProvider } from 'next-themes'

import Home from '@/pages/Home'
import About from '@/pages/About'
import LockScreen from '@/components/LockScreen'
import TitleBar from '@/components/TitleBar'
import Onboarding from '@/components/Onboarding'

interface Profile {
  name: string
  avatarDataUrl: string | null
}

function App(): React.JSX.Element {
  const [locked, setLocked] = useState<boolean | null>(null) // null = still checking
  const [profile, setProfile] = useState<Profile | null>(null)

  useEffect(() => {
    window.api.hasAppPassword().then(setLocked)
    window.api.getProfile().then(setProfile)
  }, [])

  // Sidebar's Logout dispatches this to re-lock without needing the lock
  // state threaded through the router tree.
  useEffect(() => {
    const handler = (): void => setLocked(true)
    window.addEventListener('app:lock', handler)
    return () => window.removeEventListener('app:lock', handler)
  }, [])

  useEffect(() => {
    const handleProfileUpdate = (): void => {
      window.api.getProfile().then((p) => {
        setProfile(p)
        // Empty profile → onboarding (e.g. after account deletion).
        if (!p.name) setLocked(false)
      })
    }
    window.addEventListener('profile:updated', handleProfileUpdate)
    return () => window.removeEventListener('profile:updated', handleProfileUpdate)
  }, [])

  const showOnboarding = profile !== null && !profile.name

  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem={true}>
      <HashRouter>
        <div className="flex flex-col h-screen w-full bg-[#FAF9F6] dark:bg-[#212121] text-[#2E2E2D] dark:text-white transition-colors duration-200 overflow-hidden">
          <TitleBar />
          <div className="flex-1 overflow-hidden relative flex flex-col">
            {locked === null || profile === null ? null : locked ? (
              <LockScreen onUnlock={() => setLocked(false)} />
            ) : showOnboarding ? (
              <Onboarding
                onComplete={(name, avatarUrl) => setProfile({ name, avatarDataUrl: avatarUrl })}
              />
            ) : (
              <Routes>
                <Route path="/" element={<Home />} />
                <Route path="/about" element={<About />} />
              </Routes>
            )}
          </div>
        </div>
      </HashRouter>
    </ThemeProvider>
  )
}

export default App
