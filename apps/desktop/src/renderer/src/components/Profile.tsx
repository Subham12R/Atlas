import React, { useEffect, useRef, useState } from 'react'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Cancel01Icon,
  UserIcon,
  LockIcon,
  Settings01Icon,
  ArrowDown,
  Alert01Icon
} from '@hugeicons/core-free-icons'
import { SunIcon, MoonIcon, MonitorIcon } from 'lucide-react'
import { useTheme } from 'next-themes'
import { cn } from '@/lib/utils'
import {
  ApiError,
  deleteProviderSettings,
  deleteSearchSettings,
  getProviderSettings,
  getSearchSettings,
  resetAccount,
  setProviderSettings,
  setSearchSettings,
  testProviderConnection,
  type ProviderSettingsMap
} from '@/lib/api'

const KEY_PROVIDERS = [
  { id: 'openai', name: 'OpenAI', hint: 'From platform.openai.com -> API keys' },
  { id: 'anthropic', name: 'Anthropic', hint: 'From console.anthropic.com -> API keys' },
  { id: 'gemini', name: 'Gemini', hint: 'From aistudio.google.com -> Get API key' },
  { id: 'openrouter', name: 'OpenRouter', hint: 'From openrouter.ai -> Keys' }
]

interface ProfileProps {
  onClose: () => void
}

export default function Profile({ onClose }: ProfileProps): React.JSX.Element {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const { theme, setTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  // next-themes only resolves the real theme after its own mount effect runs
  // (matches its documented usage) -- deferring our render by one tick avoids
  // briefly showing neither Light/Dark selected as active.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), [])

  const [name, setName] = useState('')
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null)
  const [nameSaved, setNameSaved] = useState(false)

  const [memoryPrompt, setMemoryPrompt] = useState('')
  const [responseStyle, setResponseStyle] = useState('default')
  const [personalizationSaved, setPersonalizationSaved] = useState(false)

  const [hasPassword, setHasPassword] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordSaved, setPasswordSaved] = useState(false)
  const [savingPassword, setSavingPassword] = useState(false)

  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [deletingAccount, setDeletingAccount] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    window.api.getProfile().then((profile) => {
      setName(profile.name)
      setAvatarDataUrl(profile.avatarDataUrl)
      setMemoryPrompt(profile.memoryPrompt || '')
      setResponseStyle(profile.responseStyle || 'default')
    })
    window.api.hasAppPassword().then(setHasPassword)
  }, [])

  // ---- Advanced: provider API keys + local LLM connection -----------------
  const [isAdvancedExpanded, setIsAdvancedExpanded] = useState(false)
  const [providerSettings, setProviderSettingsState] = useState<ProviderSettingsMap>({})
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({})
  const [savingProvider, setSavingProvider] = useState<string | null>(null)
  const [savedProvider, setSavedProvider] = useState<string | null>(null)

  const [localBaseUrl, setLocalBaseUrl] = useState('')
  const [localModel, setLocalModel] = useState('')
  const [testingLocal, setTestingLocal] = useState(false)
  const [localTestResult, setLocalTestResult] = useState<{ ok: boolean; message: string } | null>(
    null
  )

  const [openrouterModel, setOpenrouterModel] = useState('')
  const [savedOpenrouterModel, setSavedOpenrouterModel] = useState(false)

  const [searchConfigured, setSearchConfigured] = useState(false)
  const [searchKeyInput, setSearchKeyInput] = useState('')
  const [savingSearch, setSavingSearch] = useState(false)
  const [savedSearch, setSavedSearch] = useState(false)

  const refreshSearchSettings = (): void => {
    getSearchSettings()
      .then((s) => setSearchConfigured(s.configured))
      .catch(() => {})
  }

  const handleSaveSearchKey = async (): Promise<void> => {
    const apiKey = searchKeyInput.trim()
    if (!apiKey) return
    setSavingSearch(true)
    try {
      await setSearchSettings(apiKey)
      refreshSearchSettings()
      setSearchKeyInput('')
      setSavedSearch(true)
      setTimeout(() => setSavedSearch(false), 1500)
    } catch {
      // key save failed -- status pill simply stays "not configured"
    } finally {
      setSavingSearch(false)
    }
  }

  const handleDisconnectSearch = async (): Promise<void> => {
    setSavingSearch(true)
    try {
      await deleteSearchSettings()
      refreshSearchSettings()
    } catch {
      // disconnect failed -- status pill simply stays "configured"
    } finally {
      setSavingSearch(false)
    }
  }

  const refreshProviderSettings = (): void => {
    getProviderSettings()
      .then((s) => {
        setProviderSettingsState(s)
        if (s.local) {
          setLocalBaseUrl(s.local.base_url || '')
          setLocalModel(s.local.model || '')
        }
        if (s.openrouter) {
          setOpenrouterModel(s.openrouter.model || '')
        }
        // Lets the model selector (ChatArea) know it should refetch and
        // re-filter down to only actively-configured providers.
        window.dispatchEvent(new Event('providers:updated'))
      })
      .catch(() => {})
  }

  const handleSaveOpenrouterModel = async (): Promise<void> => {
    setSavedOpenrouterModel(false)
    try {
      await setProviderSettings('openrouter', { model: openrouterModel.trim() })
      refreshProviderSettings()
      setSavedOpenrouterModel(true)
      setTimeout(() => setSavedOpenrouterModel(false), 1500)
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    refreshProviderSettings()
    refreshSearchSettings()
  }, [])

  const handleSaveKey = async (providerId: string): Promise<void> => {
    const apiKey = keyInputs[providerId]?.trim()
    if (!apiKey) return
    setSavingProvider(providerId)
    try {
      await setProviderSettings(providerId, { api_key: apiKey })
      refreshProviderSettings()
      setKeyInputs((prev) => ({ ...prev, [providerId]: '' }))
      setSavedProvider(providerId)
      setTimeout(() => setSavedProvider(null), 1500)
    } catch {
      // key save failed -- status pill simply stays "not configured"
    } finally {
      setSavingProvider(null)
    }
  }

  const handleDisconnect = async (providerId: string): Promise<void> => {
    setSavingProvider(providerId)
    try {
      await deleteProviderSettings(providerId)
      refreshProviderSettings()
    } catch {
      // disconnect failed -- status pill simply stays "configured"
    } finally {
      setSavingProvider(null)
    }
  }

  const handleTestLocal = async (): Promise<void> => {
    setTestingLocal(true)
    setLocalTestResult(null)
    try {
      await setProviderSettings('local', { base_url: localBaseUrl, model: localModel })
      const res = await testProviderConnection('local')
      setLocalTestResult({ ok: true, message: res.reply || 'Connected.' })
    } catch (err) {
      setLocalTestResult({
        ok: false,
        message: err instanceof ApiError ? err.message : 'Could not reach the local model.'
      })
    } finally {
      setTestingLocal(false)
    }
  }

  const persistProfile = (
    updates: Partial<{
      name: string
      avatarDataUrl: string | null
      memoryPrompt: string
      responseStyle: string
    }>
  ): void => {
    const next = {
      name,
      avatarDataUrl,
      memoryPrompt,
      responseStyle,
      ...updates
    }
    window.api.setProfile(next).catch(() => {})
    window.dispatchEvent(new Event('profile:updated'))
  }

  const handleAvatarClick = (): void => {
    fileInputRef.current?.click()
  }

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0]
    if (file && file.type.startsWith('image/')) {
      const reader = new FileReader()
      reader.onloadend = () => {
        const dataUrl = reader.result as string
        setAvatarDataUrl(dataUrl)
        persistProfile({ avatarDataUrl: dataUrl })
      }
      reader.readAsDataURL(file)
    }
    e.target.value = ''
  }

  const handleNameBlur = (): void => {
    persistProfile({ name })
    setNameSaved(true)
    setTimeout(() => setNameSaved(false), 1500)
  }

  const handleMemoryPromptBlur = (): void => {
    persistProfile({ memoryPrompt })
    setPersonalizationSaved(true)
    setTimeout(() => setPersonalizationSaved(false), 1500)
  }

  const handleResponseStyleChange = (style: string): void => {
    setResponseStyle(style)
    persistProfile({ responseStyle: style })
    setPersonalizationSaved(true)
    setTimeout(() => setPersonalizationSaved(false), 1500)
  }

  const handleSetPassword = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault()
    setPasswordError(null)
    setPasswordSaved(false)

    if (newPassword.length < 4) {
      setPasswordError('Password must be at least 4 characters.')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match.')
      return
    }

    setSavingPassword(true)
    try {
      if (hasPassword) {
        const ok = await window.api.verifyAppPassword(currentPassword)
        if (!ok) {
          setPasswordError('Current password is incorrect.')
          return
        }
      }
      await window.api.setAppPassword(newPassword)
      setHasPassword(true)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      setPasswordSaved(true)
      setTimeout(() => setPasswordSaved(false), 2000)
    } catch (err) {
      setPasswordError(err instanceof Error ? err.message : 'Could not save password.')
    } finally {
      setSavingPassword(false)
    }
  }

  const handleRemovePassword = async (): Promise<void> => {
    setPasswordError(null)
    if (!currentPassword) {
      setPasswordError('Enter your current password to remove it.')
      return
    }
    setSavingPassword(true)
    try {
      const ok = await window.api.verifyAppPassword(currentPassword)
      if (!ok) {
        setPasswordError('Current password is incorrect.')
        return
      }
      await window.api.setAppPassword(null)
      setHasPassword(false)
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } finally {
      setSavingPassword(false)
    }
  }

  const handleDeleteAccount = async (): Promise<void> => {
    setDeleteError(null)
    setDeletingAccount(true)
    try {
      await resetAccount()
      await window.api.deleteAccount()
      window.dispatchEvent(new Event('app:lock'))
    } catch (err) {
      setDeleteError(
        err instanceof ApiError
          ? err.message
          : 'Could not delete account. Is the Atlas server running?'
      )
      setDeletingAccount(false)
    }
  }

  return (
    <main className="flex-1 h-full flex flex-col bg-[#FAF9F6] dark:bg-[#1E1E1C] overflow-hidden">
      <div className="shrink-0 px-6 md:px-10 pt-6 pb-4">
        <div className="max-w-xl mx-auto flex items-center justify-between">
          <h1 className="text-lg font-semibold tracking-tight text-[#2E2E2D] dark:text-[#EAE8E3]">
            Profile
          </h1>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-[#F1EFEA] dark:hover:bg-[#2C2C2A] text-[#6E6D6A] dark:text-[#9E9D9A] hover:text-[#2E2E2D] dark:hover:text-[#EAE8E3] transition-colors cursor-pointer"
            title="Back to chat"
          >
            <HugeiconsIcon icon={Cancel01Icon} size={18} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar px-6 md:px-10 pb-10">
        <div className="max-w-xl mx-auto space-y-8">
          {/* Avatar + name */}
          <div className="flex items-center gap-4">
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleAvatarChange}
              accept="image/*"
              className="hidden"
            />
            <button
              onClick={handleAvatarClick}
              className="w-16 h-16 rounded-full bg-[#EAE8E3] dark:bg-[#2C2C2A] border border-[#E5E3DF] dark:border-[#2C2C2A] flex items-center justify-center overflow-hidden shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
              title="Change photo"
            >
              {avatarDataUrl ? (
                <img src={avatarDataUrl} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                <HugeiconsIcon
                  icon={UserIcon}
                  size={24}
                  className="text-[#6E6D6A] dark:text-[#9E9D9A]"
                />
              )}
            </button>
            <div className="flex-1 min-w-0">
              <label className="text-xs font-medium text-[#6E6D6A] dark:text-[#9E9D9A]">
                Display name
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={handleNameBlur}
                placeholder="Your name"
                className="mt-1 w-full h-10 rounded-xl px-3 bg-[#F1EFEA] dark:bg-[#2C2C2A] text-sm font-medium text-[#2E2E2D] dark:text-[#EAE8E3] outline-none placeholder:text-[#9E9D9A] placeholder:font-normal"
              />
              {nameSaved && (
                <p className="mt-1 text-[10px] text-[#6E6D6A] dark:text-[#9E9D9A]">Saved</p>
              )}
            </div>
          </div>

          {/* Password / app lock */}
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <HugeiconsIcon
                icon={LockIcon}
                size={15}
                className="text-[#6E6D6A] dark:text-[#9E9D9A]"
              />
              <h2 className="text-sm font-semibold text-[#2E2E2D] dark:text-[#EAE8E3]">App lock</h2>
            </div>
            <p className="text-xs text-[#6E6D6A] dark:text-[#9E9D9A] leading-relaxed">
              {hasPassword
                ? 'A password is required to open this app. Your connected accounts’ session cookies are stored locally, so this is worth keeping on.'
                : 'Set a password to require it whenever this app is opened -- worth doing since your connected accounts’ session cookies are stored locally on this machine.'}
            </p>

            <form onSubmit={handleSetPassword} className="space-y-2 max-w-xs">
              {hasPassword && (
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Current password"
                  className="w-full h-9 rounded-lg px-3 bg-[#F1EFEA] dark:bg-[#2C2C2A] text-sm text-[#2E2E2D] dark:text-[#EAE8E3] outline-none placeholder:text-[#9E9D9A]"
                />
              )}
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New password"
                className="w-full h-9 rounded-lg px-3 bg-[#F1EFEA] dark:bg-[#2C2C2A] text-sm text-[#2E2E2D] dark:text-[#EAE8E3] outline-none placeholder:text-[#9E9D9A]"
              />
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                className="w-full h-9 rounded-lg px-3 bg-[#F1EFEA] dark:bg-[#2C2C2A] text-sm text-[#2E2E2D] dark:text-[#EAE8E3] outline-none placeholder:text-[#9E9D9A]"
              />

              {passwordError && (
                <p className="text-xs text-[#E0533C] dark:text-[#F87171]">{passwordError}</p>
              )}
              {passwordSaved && (
                <p className="text-xs text-[#6E6D6A] dark:text-[#9E9D9A]">Password saved.</p>
              )}

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="submit"
                  disabled={savingPassword}
                  className="h-9 px-4 rounded-lg bg-[#2E2E2D] dark:bg-[#EAE8E3] text-white dark:text-[#1A1A19] text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
                >
                  {hasPassword ? 'Change password' : 'Set password'}
                </button>
                {hasPassword && (
                  <button
                    type="button"
                    onClick={handleRemovePassword}
                    disabled={savingPassword}
                    className="h-9 px-4 rounded-lg text-xs font-semibold text-red-500 dark:text-[#F87171] hover:bg-red-50 dark:hover:bg-[#441C1A] transition-colors cursor-pointer disabled:opacity-50"
                  >
                    Remove password
                  </button>
                )}
              </div>
            </form>
          </div>

          {/* Appearance */}
          <div className="flex items-center justify-between py-2 border-b border-[#E5E3DF] dark:border-[#2C2C2A]">
            <span className="text-sm font-semibold text-[#2E2E2D] dark:text-[#EAE8E3]">
              Appearance
            </span>
            {mounted && (
              <div className="flex items-center bg-[#F1EFEA] dark:bg-[#2C2C2A] rounded-lg p-0.5 border border-[#E5E3DF] dark:border-[#2C2C2A]">
                <button
                  onClick={() => setTheme('light')}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all cursor-pointer text-xs font-medium',
                    theme === 'light'
                      ? 'bg-white dark:bg-[#1E1E1C] text-[#2E2E2D] dark:text-[#EAE8E3] shadow-sm'
                      : 'text-[#6E6D6A] dark:text-[#9E9D9A] hover:text-[#2E2E2D] dark:hover:text-[#EAE8E3]'
                  )}
                  title="Light"
                >
                  <SunIcon size={15} />
                  <span>Light</span>
                </button>
                <button
                  onClick={() => setTheme('dark')}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all cursor-pointer text-xs font-medium',
                    theme === 'dark'
                      ? 'bg-white dark:bg-[#1E1E1C] text-[#2E2E2D] dark:text-[#EAE8E3] shadow-sm'
                      : 'text-[#6E6D6A] dark:text-[#9E9D9A] hover:text-[#2E2E2D] dark:hover:text-[#EAE8E3]'
                  )}
                  title="Dark"
                >
                  <MoonIcon size={15} />
                  <span>Dark</span>
                </button>
                <button
                  onClick={() => setTheme('system')}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-md transition-all cursor-pointer text-xs font-medium',
                    theme === 'system'
                      ? 'bg-white dark:bg-[#1E1E1C] text-[#2E2E2D] dark:text-[#EAE8E3] shadow-sm'
                      : 'text-[#6E6D6A] dark:text-[#9E9D9A] hover:text-[#2E2E2D] dark:hover:text-[#EAE8E3]'
                  )}
                  title="System"
                >
                  <MonitorIcon size={15} />
                  <span>System</span>
                </button>
              </div>
            )}
          </div>

          {/* Personalization */}
          <div className="space-y-4 pt-4 border-t border-[#E5E3DF] dark:border-[#2C2C2A]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <HugeiconsIcon
                  icon={UserIcon}
                  size={15}
                  className="text-[#6E6D6A] dark:text-[#9E9D9A]"
                />
                <h2 className="text-sm font-semibold text-[#2E2E2D] dark:text-[#EAE8E3]">
                  Personalization
                </h2>
              </div>
              {personalizationSaved && (
                <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">
                  Saved settings
                </span>
              )}
            </div>

            {/* Custom Memory Prompt */}
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-[#6E6D6A] dark:text-[#9E9D9A]">
                Persistent Memory & Custom Instructions
              </label>
              <p className="text-[11px] text-[#6E6D6A] dark:text-[#9E9D9A] leading-relaxed">
                This prompt is cooked into the start of each conversation. Tell the AI who you are,
                what projects you are working on, or how it should remember you.
              </p>
              <textarea
                value={memoryPrompt}
                onChange={(e) => setMemoryPrompt(e.target.value)}
                onBlur={handleMemoryPromptBlur}
                placeholder="e.g. I am a frontend developer working on a React desktop app. Keep explanations concise, prioritize modern code patterns, and explain key design decisions."
                rows={4}
                className="w-full rounded-xl p-3 bg-[#F1EFEA] dark:bg-[#2C2C2A] text-sm text-[#2E2E2D] dark:text-[#EAE8E3] outline-none placeholder:text-[#9E9D9A] placeholder:font-normal border border-transparent focus:border-[#2E2E2D] dark:focus:border-[#EAE8E3] resize-none"
              />
            </div>

            {/* Response Style Options */}
            <div className="space-y-2">
              <label className="block text-xs font-semibold text-[#6E6D6A] dark:text-[#9E9D9A]">
                Response Style
              </label>
              <p className="text-[11px] text-[#6E6D6A] dark:text-[#9E9D9A] leading-relaxed">
                Select the tone and detail level of responses.
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {[
                  { id: 'default', label: 'Default', desc: 'Standard balanced mode' },
                  { id: 'technical', label: 'Technical', desc: 'Precise, deep, code-heavy' },
                  { id: 'casual', label: 'Casual', desc: 'Friendly, simple, concise' },
                  { id: 'teacher', label: 'Teacher', desc: 'Conceptual, educational' },
                  { id: 'creative', label: 'Creative', desc: 'Expressive, exploratory' }
                ].map((style) => (
                  <button
                    key={style.id}
                    onClick={() => handleResponseStyleChange(style.id)}
                    className={cn(
                      'flex flex-col items-start gap-1 p-3 rounded-xl border text-left cursor-pointer transition-all',
                      responseStyle === style.id
                        ? 'border-[#2E2E2D] dark:border-[#EAE8E3] bg-[#F1EFEA] dark:bg-[#2C2C2A] shadow-sm'
                        : 'border-[#E5E3DF] dark:border-[#2C2C2A] hover:bg-[#F1EFEA]/40 dark:hover:bg-[#2C2C2A]/40 bg-transparent'
                    )}
                  >
                    <span className="text-xs font-semibold text-[#2E2E2D] dark:text-[#EAE8E3]">
                      {style.label}
                    </span>
                    <span className="text-[10px] text-[#6E6D6A] dark:text-[#9E9D9A] leading-tight">
                      {style.desc}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Advanced: provider API keys + local LLM connection */}
          <div className="space-y-3">
            <button
              onClick={() => setIsAdvancedExpanded(!isAdvancedExpanded)}
              className="w-full flex items-center justify-between gap-2 cursor-pointer group"
            >
              <div className="flex items-center gap-2">
                <HugeiconsIcon
                  icon={Settings01Icon}
                  size={15}
                  className="text-[#6E6D6A] dark:text-[#9E9D9A]"
                />
                <h2 className="text-sm font-semibold text-[#2E2E2D] dark:text-[#EAE8E3]">
                  Advanced
                </h2>
                <span className="text-[10px] text-[#9E9D9A] dark:text-[#6E6D6A]">
                  Providers & local models
                </span>
              </div>
              <HugeiconsIcon
                icon={ArrowDown}
                size={13}
                className={cn(
                  'text-[#9E9D9A] dark:text-[#6E6D6A] group-hover:text-[#2E2E2D] dark:group-hover:text-[#EAE8E3] transition-transform duration-200',
                  isAdvancedExpanded && 'rotate-180'
                )}
              />
            </button>

            {isAdvancedExpanded && (
              <div className="space-y-6 animate-in fade-in slide-in-from-top-1 duration-200">
                <div className="space-y-2 w-full">
                  <p className="text-[11px] text-[#6E6D6A] dark:text-[#9E9D9A]">
                    Paste an API key for any provider you want to chat with. Keys are stored locally
                    and never leave your machine except to call that provider.
                  </p>
                  {KEY_PROVIDERS.map((p) => {
                    const configured = !!providerSettings[p.id]?.configured
                    return (
                      <div key={p.id} className="flex flex-col gap-1 w-full">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-[#2E2E2D] dark:text-[#EAE8E3]">
                            {p.name}
                          </span>
                          <span className="text-[10px] text-[#9E9D9A] dark:text-[#6E6D6A]">
                            {p.hint}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 w-full">
                          <input
                            type="password"
                            value={keyInputs[p.id] || ''}
                            onChange={(e) =>
                              setKeyInputs((prev) => ({ ...prev, [p.id]: e.target.value }))
                            }
                            placeholder={configured ? 'Connected' : 'Paste API key'}
                            className="flex-1 min-w-0 h-9 rounded-lg px-3 bg-[#F1EFEA] dark:bg-[#2C2C2A] text-sm text-[#2E2E2D] dark:text-[#EAE8E3] outline-none placeholder:text-[#9E9D9A]"
                          />
                          {configured ? (
                            <button
                              onClick={() => handleDisconnect(p.id)}
                              disabled={savingProvider === p.id}
                              className="h-9 px-3 rounded-lg text-xs font-semibold text-red-500 dark:text-[#F87171] hover:bg-red-50 dark:hover:bg-[#441C1A] transition-colors cursor-pointer disabled:opacity-50 shrink-0"
                            >
                              {savingProvider === p.id ? 'Disconnecting...' : 'Disconnect'}
                            </button>
                          ) : (
                            <button
                              onClick={() => handleSaveKey(p.id)}
                              disabled={savingProvider === p.id || !keyInputs[p.id]?.trim()}
                              className="h-9 px-3 rounded-lg bg-[#2E2E2D] dark:bg-[#EAE8E3] text-white dark:text-[#1A1A19] text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50 shrink-0"
                            >
                              {savedProvider === p.id ? 'Saved' : 'Save'}
                            </button>
                          )}
                        </div>
                        {p.id === 'openrouter' && configured && (
                          <div className="flex items-center gap-2 mt-1 w-full pl-4 animate-in fade-in duration-200">
                            <span className="text-[10px] font-medium text-[#6E6D6A] dark:text-[#9E9D9A] shrink-0">
                              Model Slug:
                            </span>
                            <input
                              type="text"
                              value={openrouterModel}
                              onChange={(e) => setOpenrouterModel(e.target.value)}
                              onBlur={handleSaveOpenrouterModel}
                              placeholder="e.g. deepseek/deepseek-chat (default: openai/gpt-4o)"
                              className="flex-1 h-8 rounded-lg px-2.5 bg-[#F1EFEA]/80 dark:bg-[#2C2C2A]/80 text-xs text-[#2E2E2D] dark:text-[#EAE8E3] outline-none placeholder:text-[#9E9D9A]"
                            />
                            {savedOpenrouterModel && (
                              <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold shrink-0 animate-in fade-in duration-200">
                                Saved
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>

                <div className="space-y-2 w-full">
                  <h3 className="text-xs font-semibold text-[#2E2E2D] dark:text-[#EAE8E3]">
                    Local LLM
                  </h3>
                  <p className="text-[11px] text-[#6E6D6A] dark:text-[#9E9D9A] leading-relaxed">
                    Prefer to run a model on this machine instead? Install{' '}
                    <span className="font-medium">Ollama</span>, run{' '}
                    <code className="px-1 py-0.5 bg-[#F1EFEA] dark:bg-[#2C2C2A] rounded text-[10px]">
                      ollama pull &lt;model&gt;
                    </code>
                    , then point the two fields below at its OpenAI-compatible endpoint and the
                    model name you pulled.
                  </p>
                  <div className="flex flex-col sm:flex-row gap-2 w-full">
                    <input
                      value={localBaseUrl}
                      onChange={(e) => setLocalBaseUrl(e.target.value)}
                      placeholder="Endpoint -- e.g. http://localhost:11434/v1"
                      className="flex-1 min-w-0 h-9 rounded-lg px-3 bg-[#F1EFEA] dark:bg-[#2C2C2A] text-sm text-[#2E2E2D] dark:text-[#EAE8E3] outline-none placeholder:text-[#9E9D9A]"
                    />
                    <input
                      value={localModel}
                      onChange={(e) => setLocalModel(e.target.value)}
                      placeholder="Model name -- e.g. llama3.2"
                      className="flex-1 min-w-0 h-9 rounded-lg px-3 bg-[#F1EFEA] dark:bg-[#2C2C2A] text-sm text-[#2E2E2D] dark:text-[#EAE8E3] outline-none placeholder:text-[#9E9D9A]"
                    />
                  </div>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      onClick={handleTestLocal}
                      disabled={testingLocal}
                      className="h-9 px-4 rounded-lg bg-[#2E2E2D] dark:bg-[#EAE8E3] text-white dark:text-[#1A1A19] text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
                    >
                      {testingLocal ? 'Testing connection...' : 'Test connection'}
                    </button>
                  </div>
                  {localTestResult && (
                    <p
                      className={cn(
                        'text-xs',
                        localTestResult.ok
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-[#E0533C] dark:text-[#F87171]'
                      )}
                    >
                      {localTestResult.message}
                    </p>
                  )}
                </div>

                <div className="space-y-2 w-full">
                  <h3 className="text-xs font-semibold text-[#2E2E2D] dark:text-[#EAE8E3]">
                    Web search
                  </h3>
                  <p className="text-[11px] text-[#6E6D6A] dark:text-[#9E9D9A] leading-relaxed">
                    Backs the Search web and Research mode tools. From{' '}
                    <span className="font-medium">tavily.com</span> -&gt; API Keys.
                  </p>
                  <div className="flex items-center gap-2 w-full">
                    <input
                      type="password"
                      value={searchKeyInput}
                      onChange={(e) => setSearchKeyInput(e.target.value)}
                      placeholder={searchConfigured ? 'Connected' : 'Paste Tavily API key'}
                      className="flex-1 min-w-0 h-9 rounded-lg px-3 bg-[#F1EFEA] dark:bg-[#2C2C2A] text-sm text-[#2E2E2D] dark:text-[#EAE8E3] outline-none placeholder:text-[#9E9D9A]"
                    />
                    {searchConfigured ? (
                      <button
                        onClick={handleDisconnectSearch}
                        disabled={savingSearch}
                        className="h-9 px-3 rounded-lg text-xs font-semibold text-red-500 dark:text-[#F87171] hover:bg-red-50 dark:hover:bg-[#441C1A] transition-colors cursor-pointer disabled:opacity-50 shrink-0"
                      >
                        {savingSearch ? 'Disconnecting...' : 'Disconnect'}
                      </button>
                    ) : (
                      <button
                        onClick={handleSaveSearchKey}
                        disabled={savingSearch || !searchKeyInput.trim()}
                        className="h-9 px-3 rounded-lg bg-[#2E2E2D] dark:bg-[#EAE8E3] text-white dark:text-[#1A1A19] text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50 shrink-0"
                      >
                        {savedSearch ? 'Saved' : 'Save'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Danger zone */}
          <div className="space-y-3 pt-4 border-t border-red-200 dark:border-[#441C1A]">
            <div className="flex items-center gap-2">
              <HugeiconsIcon
                icon={Alert01Icon}
                size={15}
                className="text-red-500 dark:text-[#F87171]"
              />
              <h2 className="text-sm font-semibold text-red-500 dark:text-[#F87171]">
                Danger zone
              </h2>
            </div>
            <p className="text-xs text-[#6E6D6A] dark:text-[#9E9D9A] leading-relaxed">
              Permanently deletes your account, connected provider keys, and all stored conversation
              memory. This cannot be undone.
            </p>

            {deleteError && (
              <p className="text-xs text-[#E0533C] dark:text-[#F87171]">{deleteError}</p>
            )}

            {confirmingDelete ? (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDeleteAccount}
                  disabled={deletingAccount}
                  className="h-9 px-4 rounded-lg bg-red-500 text-white text-xs font-semibold hover:opacity-90 transition-opacity cursor-pointer disabled:opacity-50"
                >
                  {deletingAccount ? 'Deleting...' : 'Yes, delete everything'}
                </button>
                <button
                  onClick={() => setConfirmingDelete(false)}
                  disabled={deletingAccount}
                  className="h-9 px-4 rounded-lg text-xs font-semibold text-[#6E6D6A] dark:text-[#9E9D9A] hover:bg-[#F1EFEA] dark:hover:bg-[#2C2C2A] transition-colors cursor-pointer disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmingDelete(true)}
                className="h-9 px-4 rounded-lg text-xs font-semibold text-red-500 dark:text-[#F87171] border border-red-200 dark:border-[#441C1A] hover:bg-red-50 dark:hover:bg-[#441C1A] transition-colors cursor-pointer"
              >
                Delete account
              </button>
            )}
          </div>
        </div>
      </div>
    </main>
  )
}
