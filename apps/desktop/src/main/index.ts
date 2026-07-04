import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import bcrypt from 'bcryptjs'
import { writeFile, rm, readFile, mkdir, rename } from 'fs/promises'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'

interface ExportPdfResult {
  ok: boolean
  path?: string
  canceled?: boolean
}

interface Profile {
  name: string
  avatarDataUrl: string | null
  memoryPrompt?: string
  responseStyle?: string
  email?: string
}

interface RegisterProfile {
  email: string
  name: string
  password: string
  avatarDataUrl: string | null
}

interface User {
  email: string
  passwordHash: string
  name: string
  avatarDataUrl: string | null
  memoryPrompt?: string
  responseStyle?: string
}

const DEFAULT_PROFILE: Profile = {
  name: '',
  avatarDataUrl: null,
  memoryPrompt: '',
  responseStyle: 'default'
}

let currentSessionEmail: string | null = null

function usersDbPath(): string {
  return join(app.getPath('userData'), 'users.db.json')
}

function sessionPath(): string {
  return join(app.getPath('userData'), 'session.json')
}

function chatsPath(): string {
  return join(app.getPath('userData'), 'chats.json')
}

function attachmentsDir(): string {
  return join(app.getPath('userData'), 'attachments')
}

// Images (uploaded or generated) are written to disk and only a file path is
// kept in chat history -- inlining base64 into chats.json would bloat that
// file fast (a handful of images = many MB in one JSON blob).
async function saveImageAttachment(base64: string, mime: string): Promise<string> {
  await mkdir(attachmentsDir(), { recursive: true })
  const ext = mime.split('/')[1] || 'png'
  const filePath = join(attachmentsDir(), `${randomUUID()}.${ext}`)
  await writeFile(filePath, Buffer.from(base64, 'base64'))
  return filePath
}

async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  const tempPath = `${filePath}.tmp`
  await writeFile(tempPath, JSON.stringify(data), 'utf-8')
  await rename(tempPath, filePath)
}

async function getUsers(): Promise<User[]> {
  try {
    const raw = await readFile(usersDbPath(), 'utf-8')
    return JSON.parse(raw)
  } catch {
    return []
  }
}

async function saveUsers(users: User[]): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeJsonAtomic(usersDbPath(), users)
}

async function getSessionEmail(): Promise<string | null> {
  try {
    const raw = await readFile(sessionPath(), 'utf-8')
    const data = JSON.parse(raw)
    return data.email || null
  } catch {
    return null
  }
}

async function saveSession(email: string | null): Promise<void> {
  await mkdir(app.getPath('userData'), { recursive: true })
  await writeJsonAtomic(sessionPath(), { email })
}

const BACKEND_URL = 'http://127.0.0.1:8000'

async function getChats(): Promise<unknown[]> {
  let backendChats: unknown[] = []
  let fetchFailed = false
  try {
    const res = await fetch(`${BACKEND_URL}/chats`)
    if (res.ok) {
      backendChats = (await res.json()) as unknown[]
    } else {
      fetchFailed = true
    }
  } catch (err) {
    fetchFailed = true
    console.error('Failed to connect to backend for chats', err)
  }

  if (!fetchFailed) {
    if (backendChats.length === 0) {
      try {
        const raw = await readFile(chatsPath(), 'utf-8')
        const localChats = JSON.parse(raw) as unknown[]
        if (localChats.length > 0) {
          console.log('Migrating legacy chats.json to backend SQLite database...')
          await setChats(localChats)
          await rm(chatsPath(), { force: true })
          return localChats
        }
      } catch (err) {
        // legacy file not found or already migrated
      }
    }
    return backendChats
  }

  // Fallback if local backend is offline
  try {
    const raw = await readFile(chatsPath(), 'utf-8')
    return JSON.parse(raw) as unknown[]
  } catch {
    return []
  }
}

async function setChats(chats: unknown[]): Promise<void> {
  // Sync to backend SQLite
  try {
    const res = await fetch(`${BACKEND_URL}/chats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(chats)
    })
    if (res.ok) {
      return
    }
  } catch (err) {
    console.error('Failed to sync chats to backend', err)
  }

  // Double write to local chats.json as local fallback backup
  try {
    await mkdir(app.getPath('userData'), { recursive: true })
    await writeJsonAtomic(chatsPath(), chats)
  } catch (err) {
    console.error('Failed to write chats fallback backup', err)
  }
}

async function getProfile(): Promise<Profile> {
  if (!currentSessionEmail) {
    return DEFAULT_PROFILE
  }
  const users = await getUsers()
  const user = users.find((u) => u.email.toLowerCase() === currentSessionEmail?.toLowerCase())
  if (!user) return DEFAULT_PROFILE
  return {
    name: user.name,
    avatarDataUrl: user.avatarDataUrl,
    memoryPrompt: user.memoryPrompt || '',
    responseStyle: user.responseStyle || 'default',
    email: user.email
  }
}

async function setProfile(profile: Profile): Promise<void> {
  const users = await getUsers()
  let emailToUpdate = currentSessionEmail || profile.email
  if (!emailToUpdate && users.length > 0) {
    emailToUpdate = profile.email
  }

  if (!emailToUpdate) return

  const index = users.findIndex((u) => u.email.toLowerCase() === emailToUpdate?.toLowerCase())
  if (index !== -1) {
    users[index] = {
      ...users[index],
      name: profile.name,
      avatarDataUrl: profile.avatarDataUrl,
      memoryPrompt: profile.memoryPrompt || users[index].memoryPrompt || '',
      responseStyle: profile.responseStyle || users[index].responseStyle || 'default'
    }
    await saveUsers(users)
  } else if (profile.email) {
    const newUser: User = {
      email: profile.email,
      name: profile.name,
      avatarDataUrl: profile.avatarDataUrl,
      passwordHash: '',
      memoryPrompt: profile.memoryPrompt || '',
      responseStyle: profile.responseStyle || 'default'
    }
    users.push(newUser)
    await saveUsers(users)
    currentSessionEmail = profile.email
    await saveSession(currentSessionEmail)
  }
}

async function hasAppPassword(): Promise<boolean> {
  const users = await getUsers()
  return users.length > 0
}

async function setAppPassword(password: string | null): Promise<void> {
  if (!currentSessionEmail) {
    throw new Error('No active user session')
  }
  const users = await getUsers()
  const index = users.findIndex((u) => u.email.toLowerCase() === currentSessionEmail?.toLowerCase())
  if (index !== -1) {
    if (password === null) {
      users[index].passwordHash = ''
    } else {
      users[index].passwordHash = bcrypt.hashSync(password, 10)
    }
    await saveUsers(users)
  }
}

async function verifyAppPassword(password: string): Promise<boolean> {
  if (!currentSessionEmail) return false
  const users = await getUsers()
  const user = users.find((u) => u.email.toLowerCase() === currentSessionEmail?.toLowerCase())
  if (!user || !user.passwordHash) return false
  return bcrypt.compareSync(password, user.passwordHash)
}

async function loginUser(email: string, password: string): Promise<boolean> {
  const users = await getUsers()
  const user = users.find((u) => u.email.toLowerCase() === email.toLowerCase())
  if (!user || !user.passwordHash) return false
  const match = bcrypt.compareSync(password, user.passwordHash)
  if (match) {
    currentSessionEmail = user.email
    await saveSession(currentSessionEmail)
    return true
  }
  return false
}

async function logoutUser(): Promise<void> {
  currentSessionEmail = null
  await saveSession(null)
}

async function deleteAccount(): Promise<void> {
  if (!currentSessionEmail) return
  const users = await getUsers()
  const remaining = users.filter(
    (u) => u.email.toLowerCase() !== currentSessionEmail?.toLowerCase()
  )
  await saveUsers(remaining)
  currentSessionEmail = null
  await saveSession(null)
}

async function registerUser(profile: RegisterProfile): Promise<boolean> {
  const users = await getUsers()
  const exists = users.some((u) => u.email.toLowerCase() === profile.email.toLowerCase())
  if (exists) return false

  const passwordHash = bcrypt.hashSync(profile.password, 10)
  const newUser: User = {
    email: profile.email,
    name: profile.name,
    avatarDataUrl: profile.avatarDataUrl,
    passwordHash,
    memoryPrompt: '',
    responseStyle: 'default'
  }
  users.push(newUser)
  await saveUsers(users)
  currentSessionEmail = newUser.email
  await saveSession(currentSessionEmail)
  return true
}

async function exportHtmlToPdf(html: string): Promise<ExportPdfResult> {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Export chat as PDF',
    defaultPath: 'chat.pdf',
    filters: [{ name: 'PDF', extensions: ['pdf'] }]
  })
  if (canceled || !filePath) return { ok: false, canceled: true }

  // A data: URL has practical size limits that a long chat (e.g. with a CSV
  // dump inlined) can exceed -- write to a temp file instead, which doesn't.
  const tempHtmlPath = join(tmpdir(), `secondbrain-export-${randomUUID()}.html`)
  await writeFile(tempHtmlPath, html, 'utf-8')

  const pdfWindow = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
  try {
    await pdfWindow.loadFile(tempHtmlPath)
    const buffer = await pdfWindow.webContents.printToPDF({})
    await writeFile(filePath, buffer)
    return { ok: true, path: filePath }
  } finally {
    pdfWindow.destroy()
    await rm(tempHtmlPath, { force: true })
  }
}

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 720,
    show: false,
    autoHideMenuBar: true,
    frame: false,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      webSecurity: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  currentSessionEmail = await getSessionEmail()
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  ipcMain.handle('export-pdf', (_event, html: string) => exportHtmlToPdf(html))
  ipcMain.handle('get-profile', () => getProfile())
  ipcMain.handle('set-profile', (_event, profile: Profile) => setProfile(profile))
  ipcMain.handle('has-app-password', () => hasAppPassword())
  ipcMain.handle('set-app-password', (_event, password: string | null) => setAppPassword(password))
  ipcMain.handle('verify-app-password', (_event, password: string) => verifyAppPassword(password))
  ipcMain.handle('get-chats', () => getChats())
  ipcMain.handle('set-chats', (_event, chats: unknown[]) => setChats(chats))
  ipcMain.handle('login-user', (_event, email, password) => loginUser(email, password))
  ipcMain.handle('logout-user', () => logoutUser())
  ipcMain.handle('register-user', (_event, profile) => registerUser(profile))
  ipcMain.handle('delete-account', () => deleteAccount())
  ipcMain.handle('save-image', (_event, base64: string, mime: string) =>
    saveImageAttachment(base64, mime)
  )

  ipcMain.on('window-minimize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.minimize()
  })
  ipcMain.on('window-maximize', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      if (win.isMaximized()) {
        win.unmaximize()
      } else {
        win.maximize()
      }
    }
  })
  ipcMain.on('window-close', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.close()
  })
  ipcMain.handle('set-fullscreen', (event, flag: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    win?.setFullScreen(flag)
  })

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
