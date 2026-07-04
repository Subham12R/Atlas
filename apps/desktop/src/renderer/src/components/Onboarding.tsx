import React, { useLayoutEffect, useRef, useState } from 'react'
import gsap from 'gsap'
import { cn } from '@/lib/utils'

interface OnboardingProps {
  onComplete: (name: string, avatarDataUrl: string | null) => void
}

const TOTAL_STEPS = 3

/** Small circular "continue" button, echoing the return-arrow on a macOS
 * lock screen's password field. */
function ContinueButton({
  onClick,
  disabled,
  busy,
  label
}: {
  onClick: () => void
  disabled?: boolean
  busy?: boolean
  label: string
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      className="w-12 h-12 shrink-0 rounded-full bg-[#2E2E2D] dark:bg-white flex items-center justify-center text-white dark:text-black hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
    >
      {busy ? (
        <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
          />
        </svg>
      ) : (
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className="w-4 h-4"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M5 12h14" strokeLinecap="round" />
          <path d="M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  )
}

/** Full-window overlay -- not nested in the app's normal boxed layout. Only
 * asks for a name + optional avatar; app lock and theme are configured later
 * from Settings, not during onboarding. */
export default function Onboarding({ onComplete }: OnboardingProps): React.JSX.Element {
  const [step, setStep] = useState(1)
  const [name, setName] = useState('')
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [isExiting, setIsExiting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const sceneRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  // Staggered reveal per step. Reset the scene container first — transitionOut
  // fades the whole scene to opacity 0 and that inline style persists otherwise.
  useLayoutEffect(() => {
    const scene = sceneRef.current
    if (!scene) return

    gsap.killTweensOf(scene)
    gsap.set(scene, { opacity: 1, y: 0 })

    const lines = scene.querySelectorAll('[data-gsap-line]')
    if (lines.length === 0) return

    gsap.killTweensOf(lines)
    gsap.set(lines, { opacity: 0, y: 34 })
    gsap.to(lines, {
      opacity: 1,
      y: 0,
      duration: 1.15,
      ease: 'power3.out',
      stagger: 0.18
    })
  }, [step])

  const handleAvatarClick = (): void => {
    fileInputRef.current?.click()
  }

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0]
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader()
      reader.onloadend = () => {
        setAvatarDataUrl(reader.result as string)
      }
      reader.readAsDataURL(file)
    }
    e.target.value = ''
  }

  /** Fades the current scene's lines out before the step advances. */
  const transitionOut = (): Promise<void> => {
    const scene = sceneRef.current
    if (!scene) return Promise.resolve()
    const lines = scene.querySelectorAll('[data-gsap-line]')
    if (lines.length === 0) return Promise.resolve()
    return new Promise((resolve) => {
      gsap.to(lines, {
        opacity: 0,
        y: -18,
        duration: 0.35,
        ease: 'power2.in',
        stagger: 0.06,
        onComplete: resolve
      })
    })
  }

  const handleNext = async (): Promise<void> => {
    if (step === 2 && !name.trim()) {
      return // Name is required
    }
    if (step === 3) {
      if (!email.trim() || !email.includes('@')) {
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
    }

    if (step === TOTAL_STEPS) {
      setSaving(true)
      try {
        const ok = await window.api.registerUser({
          email: email.trim().toLowerCase(),
          name: name.trim(),
          password,
          avatarDataUrl
        })
        if (!ok) {
          setError('Email is already registered.')
          setSaving(false)
          return
        }
        window.dispatchEvent(new Event('profile:updated'))

        setIsExiting(true)
        await new Promise<void>((resolve) => {
          gsap.to(overlayRef.current, {
            opacity: 0,
            duration: 0.9,
            ease: 'power2.inOut',
            onComplete: resolve
          })
        })
        onComplete(name.trim(), avatarDataUrl)
      } catch (err) {
        console.error(err)
        setError('Could not create account.')
        setSaving(false)
        setIsExiting(false)
      }
    } else {
      await transitionOut()
      setStep((prev) => prev + 1)
    }
  }

  const handleBack = async (): Promise<void> => {
    if (step <= 1) return
    await transitionOut()
    setStep((prev) => Math.max(1, prev - 1))
  }

  const handleEnterKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (!saving) handleNext()
    }
  }

  return (
    <div
      ref={overlayRef}
      className={cn(
        'fixed inset-0 z-50 flex flex-col select-none overflow-hidden',
        'bg-[#FAF9F6] dark:bg-[#171717]',
        isExiting && 'pointer-events-none'
      )}
    >
      {/* Bottom radial glow — fades to transparent over the titlebar-matched base */}
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden
        style={{
          background:
            'radial-gradient(ellipse 100% 140% at 50% 100%, rgba(186, 230, 253, 0.6) 0%, rgba(56, 189, 248, 0.4) 10%, rgba(14, 165, 233, 0.2) 28%, transparent 44%)'
        }}
      />

      <div className="relative z-10 flex flex-col flex-1 min-h-0">
      {/* Progress -- minimal dots, top center */}
      <div className="flex items-center gap-1.5 justify-center pt-10 shrink-0">
        {Array.from({ length: TOTAL_STEPS }, (_, i) => i + 1).map((s) => (
          <div
            key={s}
            className={cn(
              'h-1 rounded-full transition-all duration-300',
              s === step
                ? 'w-6 bg-[#2E2E2D] dark:bg-white'
                : s < step
                  ? 'w-1.5 bg-[#2E2E2D]/40 dark:bg-white/40'
                  : 'w-1.5 bg-[#2E2E2D]/15 dark:bg-white/15'
            )}
          />
        ))}
      </div>

      {/* Story text -- centered, large, GSAP-revealed per scene */}
      <div
        ref={sceneRef}
        className="flex-1 flex flex-col items-center justify-center text-center px-8 gap-4"
      >
        {step === 1 && (
          <>
            <h1
              data-gsap-line
              className="text-4xl md:text-8xl font-sans font-medium tracking-tighter text-[#2E2E2D] dark:text-white"
            >
              Welcome to Atlas.
            </h1>
            <p
              data-gsap-line
              className="font-sans tracking-tighter md:text-xl text-[#6E6D6A] dark:text-white/60 max-w-4xl"
            >
              One platform to work hassle free - Research, Document, Chat, Anything you wanna do..
              <span className="italic ml-1">No interruptions.</span>
            </p>
          </>
        )}

        {step === 2 && (
          <>
            <h1
              data-gsap-line
              className="text-3xl md:text-5xl font-medium font-sans tracking-tighter text-[#2E2E2D] dark:text-white"
            >
              What should we call you?
            </h1>
            <p
              data-gsap-line
              className="font-sans tracking-tighter md:text-xl text-[#6E6D6A] dark:text-white/60 max-w-4xl"
            >
              Choose a User name and select an optional profile picture to personalize your
              workspace.
            </p>
          </>
        )}

        {step === 3 && (
          <>
            <h1
              data-gsap-line
              className="text-3xl md:text-5xl font-medium font-sans tracking-tighter text-[#2E2E2D] dark:text-white"
            >
              Create your account
            </h1>
            <p
              data-gsap-line
              className="font-sans max-w-lg tracking-tighter md:text-xl text-[#6E6D6A] dark:text-white/60 "
            >
              Sign up with an email address and password.
            </p>
          </>
        )}
      </div>

      {/* Sleek, bottom-docked controls -- mac-lockscreen style */}
      <div className="shrink-0 pb-14 px-6 flex flex-col items-center gap-3">
        {step === 1 && <ContinueButton onClick={handleNext} label="Begin" />}

        {step === 2 && (
          <div className="w-full max-w-2xl flex flex-col items-center gap-4">
            <div className="w-full  flex items-center gap-2">
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleAvatarChange}
                accept="image/*"
                className="hidden"
              />
              <button
                onClick={handleAvatarClick}
                title="Optional profile photo"
                className="w-14 h-12 rounded-full bg-black/5 dark:bg-white/10 border border-black/10 dark:border-white/20 flex items-center justify-center overflow-hidden cursor-pointer hover:border-black/25 dark:hover:border-white/40 transition-colors backdrop-blur-sm"
              >
                {avatarDataUrl ? (
                  <img src={avatarDataUrl} alt="Avatar" className="w-full h-full object-contain" />
                ) : (
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="w-6 h-6 text-[#6E6D6A] dark:text-white/50"
                  >
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                )}
              </button>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={handleEnterKey}
                placeholder="Your name"
                className="w-full h-12 rounded-3xl px-5 text-left text-base bg-black/5 dark:bg-white/10 backdrop-blur-2xl border border-black/10 dark:border-white/20 text-[#2E2E2D] dark:text-white placeholder:text-[#9E9D9A] dark:placeholder:text-white/40 outline-none focus:border-[#2E2E2D]/40 dark:focus:border-white/50 transition-colors"
              />
              <ContinueButton
                onClick={handleNext}
                disabled={!name.trim()}
                busy={saving}
                label="Continue"
              />
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="w-full max-w-sm flex flex-col items-center gap-3">
            <input
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value)
                setError(null)
              }}
              onKeyDown={handleEnterKey}
              placeholder="Email address"
              className="w-full h-12 rounded-3xl px-5 text-left text-base bg-black/5 dark:bg-white/10 backdrop-blur-2xl border border-black/10 dark:border-white/20 text-[#2E2E2D] dark:text-white placeholder:text-[#9E9D9A] dark:placeholder:text-white/40 outline-none focus:border-[#2E2E2D]/40 dark:focus:border-white/50 transition-colors"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                setError(null)
              }}
              onKeyDown={handleEnterKey}
              placeholder="Password"
              className="w-full h-12 rounded-3xl px-5 text-left text-base bg-black/5 dark:bg-white/10 backdrop-blur-2xl border border-black/10 dark:border-white/20 text-[#2E2E2D] dark:text-white placeholder:text-[#9E9D9A] dark:placeholder:text-white/40 outline-none focus:border-[#2E2E2D]/40 dark:focus:border-white/50 transition-colors"
            />
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value)
                setError(null)
              }}
              onKeyDown={handleEnterKey}
              placeholder="Confirm password"
              className="w-full h-12 rounded-3xl px-5 text-left text-base bg-black/5 dark:bg-white/10 backdrop-blur-2xl border border-black/10 dark:border-white/20 text-[#2E2E2D] dark:text-white placeholder:text-[#9E9D9A] dark:placeholder:text-white/40 outline-none focus:border-[#2E2E2D]/40 dark:focus:border-white/50 transition-colors"
            />
            {error && (
              <p className="text-xs text-[#E0533C] dark:text-red-400 self-start px-2 font-medium">
                {error}
              </p>
            )}
            <button
              onClick={handleNext}
              disabled={!email.trim() || !password || !confirmPassword || saving}
              className="w-full h-12 rounded-3xl bg-[#2E2E2D] dark:bg-white flex items-center justify-center gap-2 text-white dark:text-black text-base font-semibold hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {saving ? (
                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
              ) : (
                <>
                  <span>Continue</span>
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    className="w-4 h-4"
                    stroke="currentColor"
                    strokeWidth="2.5"
                  >
                    <path d="M5 12h14" strokeLinecap="round" />
                    <path d="M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </>
              )}
            </button>
          </div>
        )}

        {step > 1 && (
          <button
            onClick={handleBack}
            disabled={saving}
            className="text-[11px] font-medium text-[#9E9D9A] dark:text-white/40 hover:text-[#2E2E2D] dark:hover:text-white/80 transition-colors cursor-pointer disabled:opacity-40 mt-1"
          >
            Back
          </button>
        )}
      </div>
      </div>
    </div>
  )
}
