import { ElectronAPI } from '@electron-toolkit/preload'
import type { LocalRuntimeId, LocalRuntimeStatus } from '../shared/localRuntime'

export interface Profile {
  name: string
  avatarDataUrl: string | null
  memoryPrompt?: string
  responseStyle?: string
  email?: string
}

export interface RegisterProfile {
  email: string
  name: string
  password: string
  avatarDataUrl: string | null
}

export interface Api {
  exportPdf: (html: string) => Promise<{ ok: boolean; path?: string; canceled?: boolean }>
  getProfile: () => Promise<Profile>
  setProfile: (profile: Profile) => Promise<void>
  hasAppPassword: () => Promise<boolean>
  setAppPassword: (password: string | null) => Promise<void>
  verifyAppPassword: (password: string) => Promise<boolean>
  getBackendToken: () => Promise<string>
  getLocalRuntimeStatus: (runtimeId: LocalRuntimeId) => Promise<LocalRuntimeStatus>
  startLocalRuntime: (runtimeId: LocalRuntimeId) => Promise<LocalRuntimeStatus>
  stopLocalRuntime: (runtimeId: LocalRuntimeId) => Promise<LocalRuntimeStatus>
  getChats: () => Promise<unknown[]>
  setChats: (chats: unknown[]) => Promise<void>
  minimizeWindow: () => void
  maximizeWindow: () => void
  closeWindow: () => void
  setFullscreen: (flag: boolean) => Promise<void>

  // Auth APIs
  loginUser: (email: string, password: string) => Promise<boolean>
  logoutUser: () => Promise<void>
  registerUser: (profile: RegisterProfile) => Promise<boolean>
  deleteAccount: () => Promise<void>
  saveImage: (base64: string, mime: string) => Promise<string>
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: Api
  }
}
