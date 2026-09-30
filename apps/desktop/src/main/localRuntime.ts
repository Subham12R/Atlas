import { homedir } from 'node:os'
import type { LocalRuntimeId, LocalRuntimeStatus } from '../shared/localRuntime'
export type { LocalRuntimeId, LocalRuntimeStatus } from '../shared/localRuntime'

export interface RuntimeChild {
  once(event: 'error', listener: (error: NodeJS.ErrnoException) => void): this
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this
  kill(signal?: NodeJS.Signals): boolean
}

export interface RuntimeLaunchOptions {
  env: NodeJS.ProcessEnv
  shell: false
  stdio: 'ignore'
}

interface LocalRuntimeDependencies {
  platform: string
  arch: string
  launch: (command: string, args: string[], options: RuntimeLaunchOptions) => RuntimeChild
  healthCheck: () => Promise<boolean>
  delay: (ms: number) => Promise<void>
  now: () => number
  startupTimeoutMs?: number
  pollIntervalMs?: number
}

const OLLAMA_URL = 'http://127.0.0.1:11434/api/tags'
const STARTUP_TIMEOUT_MS = 15_000
const POLL_INTERVAL_MS = 250

function isOllama(runtimeId: string): runtimeId is LocalRuntimeId {
  return runtimeId === 'ollama'
}

function runtimeEnvironment(): NodeJS.ProcessEnv {
  return {
    HOME: process.env.HOME ?? homedir(),
    TMPDIR: process.env.TMPDIR ?? '/tmp',
    // ponytail: standard macOS install paths only; add custom-path support when officially supported.
    PATH: '/opt/homebrew/bin:/usr/local/bin:/Applications/Ollama.app/Contents/Resources:/usr/bin:/bin',
    OLLAMA_HOST: '127.0.0.1:11434',
    // Ollama's default context is 2-4k tokens; the /v1 API cannot raise it per request, so web
    // evidence, memory and instructions would be silently truncated. Keep in sync with server/budget.py.
    OLLAMA_CONTEXT_LENGTH: '8192'
  }
}

export function createLocalRuntimeManager(dependencies: LocalRuntimeDependencies): {
  start(runtimeId: string): Promise<LocalRuntimeStatus>
  status(runtimeId: string): Promise<LocalRuntimeStatus>
  stop(runtimeId: string): Promise<LocalRuntimeStatus>
  shutdown(): Promise<boolean>
} {
  const startupTimeoutMs = dependencies.startupTimeoutMs ?? STARTUP_TIMEOUT_MS
  const pollIntervalMs = dependencies.pollIntervalMs ?? POLL_INTERVAL_MS
  let child: RuntimeChild | null = null
  let starting: Promise<LocalRuntimeStatus> | null = null

  const assertRuntime = (runtimeId: string): LocalRuntimeId => {
    if (!isOllama(runtimeId)) throw new Error(`Unsupported runtime: ${runtimeId}`)
    return runtimeId
  }

  const isSupported = (): boolean =>
    dependencies.platform === 'darwin' && dependencies.arch === 'arm64'

  const statusUnavailable = (runtimeId: LocalRuntimeId): LocalRuntimeStatus => ({
    runtimeId,
    state: 'unavailable',
    managed: false,
    supported: true,
    message: 'Ollama is not running.'
  })

  const unsupportedStatus = (runtimeId: LocalRuntimeId): LocalRuntimeStatus => ({
    runtimeId,
    state: 'unavailable',
    managed: false,
    supported: false,
    message: 'Runtime management is supported only on macOS ARM64.'
  })

  const isHealthy = async (): Promise<boolean> => {
    try {
      return await dependencies.healthCheck()
    } catch {
      return false
    }
  }

  const waitForExit = (ownedChild: RuntimeChild, timeoutMs: number): Promise<boolean> =>
    new Promise((resolve) => {
      const timeout = setTimeout(() => resolve(false), timeoutMs)
      ownedChild.once('exit', () => {
        clearTimeout(timeout)
        resolve(true)
      })
    })

  const terminateOwnedChild = async (ownedChild: RuntimeChild): Promise<boolean> => {
    const gracefulExit = waitForExit(ownedChild, 1_000)
    ownedChild.kill('SIGTERM')
    if (await gracefulExit) return true

    const forcedExit = waitForExit(ownedChild, 1_000)
    ownedChild.kill('SIGKILL')
    return forcedExit
  }

  const status = async (runtimeId: string): Promise<LocalRuntimeStatus> => {
    const id = assertRuntime(runtimeId)
    if (!isSupported()) return unsupportedStatus(id)
    if (await isHealthy()) {
      return {
        runtimeId: id,
        state: 'ready',
        managed: child !== null,
        supported: true,
        message: child ? 'Ollama is running.' : 'Ollama is already running outside Atlas.'
      }
    }
    if (child) {
      return {
        runtimeId: id,
        state: 'starting',
        managed: true,
        supported: true,
        message: 'Ollama is starting.'
      }
    }
    return statusUnavailable(id)
  }

  const waitUntilReady = async (
    runtimeId: LocalRuntimeId,
    ownedChild: RuntimeChild
  ): Promise<LocalRuntimeStatus> => {
    const deadline = dependencies.now() + startupTimeoutMs
    const processState: {
      exited: boolean
      exitCode: number | null
      startupError: NodeJS.ErrnoException | null
    } = { exited: false, exitCode: null, startupError: null }
    ownedChild.once('error', (error) => {
      processState.startupError = error
      if (child === ownedChild) child = null
    })
    ownedChild.once('exit', (code) => {
      processState.exited = true
      processState.exitCode = code
      if (child === ownedChild) child = null
    })

    while (true) {
      if (await isHealthy()) {
        return {
          runtimeId,
          state: 'ready',
          managed: child === ownedChild,
          supported: true,
          message:
            child === ownedChild ? 'Ollama is running.' : 'Ollama is already running outside Atlas.'
        }
      }
      if (processState.startupError) {
        return {
          runtimeId,
          state: processState.startupError.code === 'ENOENT' ? 'unavailable' : 'failed',
          managed: false,
          supported: true,
          message:
            processState.startupError.code === 'ENOENT'
              ? 'Ollama is not installed or is not available in the supported install locations.'
              : `Ollama could not start: ${processState.startupError.message}`
        }
      }
      if (processState.exited) {
        return {
          runtimeId,
          state: 'failed',
          managed: false,
          supported: true,
          message: `Ollama exited before its local API became ready${processState.exitCode === null ? '.' : ` (code ${processState.exitCode}).`}`
        }
      }
      const remaining = deadline - dependencies.now()
      if (remaining <= 0) {
        await terminateOwnedChild(ownedChild)
        return {
          runtimeId,
          state: 'failed',
          managed: child === ownedChild,
          supported: true,
          message: 'Ollama did not become ready before the startup timeout.'
        }
      }
      await dependencies.delay(Math.min(pollIntervalMs, remaining))
    }
  }

  const startInternal = async (runtimeId: LocalRuntimeId): Promise<LocalRuntimeStatus> => {
    if (!isSupported()) return unsupportedStatus(runtimeId)
    if (await isHealthy()) {
      return {
        runtimeId,
        state: 'ready',
        managed: child !== null,
        supported: true,
        message: child ? 'Ollama is running.' : 'Ollama is already running outside Atlas.'
      }
    }
    if (child) return waitUntilReady(runtimeId, child)

    let ownedChild: RuntimeChild
    try {
      ownedChild = dependencies.launch('ollama', ['serve'], {
        shell: false,
        stdio: 'ignore',
        env: runtimeEnvironment()
      })
    } catch (error) {
      const launchError = error as NodeJS.ErrnoException
      return {
        runtimeId,
        state: launchError.code === 'ENOENT' ? 'unavailable' : 'failed',
        managed: false,
        supported: true,
        message:
          launchError.code === 'ENOENT'
            ? 'Ollama is not installed or is not available in the supported install locations.'
            : `Ollama could not start: ${launchError.message}`
      }
    }
    child = ownedChild
    return waitUntilReady(runtimeId, ownedChild)
  }

  const start = async (runtimeId: string): Promise<LocalRuntimeStatus> => {
    const id = assertRuntime(runtimeId)
    if (starting) return starting
    const operation = startInternal(id)
    starting = operation
    try {
      return await operation
    } finally {
      if (starting === operation) starting = null
    }
  }

  const shutdown = async (): Promise<boolean> => (child ? terminateOwnedChild(child) : true)

  const stop = async (runtimeId: string): Promise<LocalRuntimeStatus> => {
    const id = assertRuntime(runtimeId)
    if (!isSupported()) return unsupportedStatus(id)
    if (!child) return status(id)

    const ownedChild = child
    if (!(await terminateOwnedChild(ownedChild))) {
      return {
        runtimeId: id,
        state: 'failed',
        managed: child === ownedChild,
        supported: true,
        message: 'Ollama did not stop after termination was requested.'
      }
    }
    if (await isHealthy()) {
      return {
        runtimeId: id,
        state: 'ready',
        managed: false,
        supported: true,
        message: 'Ollama is running outside Atlas.'
      }
    }
    return {
      runtimeId: id,
      state: 'unavailable',
      managed: false,
      supported: true,
      message: 'Atlas stopped Ollama.'
    }
  }

  return { start, status, stop, shutdown }
}

export async function checkOllamaHealth(): Promise<boolean> {
  try {
    const response = await fetch(OLLAMA_URL, { signal: AbortSignal.timeout(1_000) })
    return response.ok
  } catch {
    return false
  }
}
