import React, { useState } from 'react'

interface LockScreenProps {
  onUnlock: () => void
}

export default function LockScreen({ onUnlock }: LockScreenProps): React.JSX.Element {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)

  const handleLogin = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!email || !password) return
    setError(null)
    setChecking(true)
    try {
      const ok = await window.api.loginUser(email.trim().toLowerCase(), password)
      if (ok) {
        onUnlock()
      } else {
        setError('Invalid email or password.')
      }
    } catch (err) {
      console.error(err)
      setError('An error occurred during login.')
    } finally {
      setChecking(false)
    }
  }

  const handleRegister = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    if (!name.trim() || !email.trim() || !password || !confirmPassword) return
    if (!email.includes('@')) {
      setError('Please enter a valid email address.')
      return
    }
    if (password.length < 4) {
      setError('Password must be at least 4 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setError(null)
    setChecking(true)
    try {
      const ok = await window.api.registerUser({
        email: email.trim().toLowerCase(),
        name: name.trim(),
        password,
        avatarDataUrl: null
      })
      if (ok) {
        onUnlock()
      } else {
        setError('Email address is already registered.')
      }
    } catch (err) {
      console.error(err)
      setError('An error occurred during account creation.')
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="h-full w-full flex items-center justify-center bg-[#FAF9F6] dark:bg-[#171717] select-none">
      <div className="w-full max-w-sm flex flex-col items-center gap-6 px-6">
        <div className="text-center space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-[#2E2E2D] dark:text-[#EAE8E3]">
            {mode === 'login' ? 'Welcome Back' : 'Create Account'}
          </h1>
          <p className="text-xs text-[#6E6D6A] dark:text-[#9E9D9A]">
            {mode === 'login'
              ? 'Enter your credentials to access Atlas'
              : 'Fill in details to set up your profile'}
          </p>
        </div>

        <form
          onSubmit={mode === 'login' ? handleLogin : handleRegister}
          className="w-full flex flex-col gap-3"
        >
          {mode === 'register' && (
            <input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setError(null)
              }}
              placeholder="Full name"
              className="w-full h-10 rounded-xl px-3.5 bg-[#F1EFEA] dark:bg-[#2C2C2A] text-sm font-medium text-[#2E2E2D] dark:text-[#EAE8E3] outline-none focus:ring-1 focus:ring-[#6E6D6A] dark:focus:ring-[#9E9D9A] transition-all"
            />
          )}

          <input
            autoFocus={mode === 'login'}
            type="email"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value)
              setError(null)
            }}
            placeholder="Email address"
            className="w-full h-10 rounded-xl px-3.5 bg-[#F1EFEA] dark:bg-[#2C2C2A] text-sm font-medium text-[#2E2E2D] dark:text-[#EAE8E3] outline-none focus:ring-1 focus:ring-[#6E6D6A] dark:focus:ring-[#9E9D9A] transition-all"
          />

          <input
            type="password"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value)
              setError(null)
            }}
            placeholder="Password"
            className="w-full h-10 rounded-xl px-3.5 bg-[#F1EFEA] dark:bg-[#2C2C2A] text-sm font-medium text-[#2E2E2D] dark:text-[#EAE8E3] outline-none focus:ring-1 focus:ring-[#6E6D6A] dark:focus:ring-[#9E9D9A] transition-all"
          />

          {mode === 'register' && (
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value)
                setError(null)
              }}
              placeholder="Confirm password"
              className="w-full h-10 rounded-xl px-3.5 bg-[#F1EFEA] dark:bg-[#2C2C2A] text-sm font-medium text-[#2E2E2D] dark:text-[#EAE8E3] outline-none focus:ring-1 focus:ring-[#6E6D6A] dark:focus:ring-[#9E9D9A] transition-all"
            />
          )}

          {error && (
            <p className="text-xs text-[#E0533C] dark:text-[#F87171] mt-1 font-semibold leading-relaxed">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={
              checking ||
              (mode === 'login'
                ? !email || !password
                : !name || !email || !password || !confirmPassword)
            }
            className="w-full h-10 mt-2 rounded-xl bg-[#2E2E2D] dark:bg-[#EAE8E3] text-white dark:text-[#1A1A19] text-sm font-semibold hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {checking
              ? checking && mode === 'login'
                ? 'Logging in...'
                : 'Creating account...'
              : mode === 'login'
                ? 'Log In'
                : 'Create Account'}
          </button>
        </form>

        <button
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login')
            setError(null)
            setPassword('')
            setConfirmPassword('')
          }}
          className="text-xs font-semibold text-[#6E6D6A] dark:text-[#9E9D9A] hover:text-[#2E2E2D] dark:hover:text-[#EAE8E3] transition-colors cursor-pointer"
        >
          {mode === 'login' ? "Don't have an account? Sign Up" : 'Already have an account? Log In'}
        </button>
      </div>
    </div>
  )
}
