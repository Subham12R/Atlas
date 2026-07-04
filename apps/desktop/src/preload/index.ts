import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

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

// Custom APIs for renderer
const api = {
  exportPdf: (html: string): Promise<{ ok: boolean; path?: string; canceled?: boolean }> =>
    ipcRenderer.invoke('export-pdf', html),
  getProfile: (): Promise<Profile> => ipcRenderer.invoke('get-profile'),
  setProfile: (profile: Profile): Promise<void> => ipcRenderer.invoke('set-profile', profile),
  hasAppPassword: (): Promise<boolean> => ipcRenderer.invoke('has-app-password'),
  setAppPassword: (password: string | null): Promise<void> =>
    ipcRenderer.invoke('set-app-password', password),
  verifyAppPassword: (password: string): Promise<boolean> =>
    ipcRenderer.invoke('verify-app-password', password),
  getChats: (): Promise<unknown[]> => ipcRenderer.invoke('get-chats'),
  setChats: (chats: unknown[]): Promise<void> => ipcRenderer.invoke('set-chats', chats),
  minimizeWindow: (): void => ipcRenderer.send('window-minimize'),
  maximizeWindow: (): void => ipcRenderer.send('window-maximize'),
  closeWindow: (): void => ipcRenderer.send('window-close'),
  setFullscreen: (flag: boolean): Promise<void> => ipcRenderer.invoke('set-fullscreen', flag),
  loginUser: (email: string, password: string): Promise<boolean> =>
    ipcRenderer.invoke('login-user', email, password),
  logoutUser: (): Promise<void> => ipcRenderer.invoke('logout-user'),
  registerUser: (profile: RegisterProfile): Promise<boolean> =>
    ipcRenderer.invoke('register-user', profile),
  deleteAccount: (): Promise<void> => ipcRenderer.invoke('delete-account'),
  saveImage: (base64: string, mime: string): Promise<string> =>
    ipcRenderer.invoke('save-image', base64, mime)
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
