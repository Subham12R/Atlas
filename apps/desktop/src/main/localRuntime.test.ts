// @vitest-environment node
import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
import {
  createLocalRuntimeManager,
  type RuntimeChild,
  type RuntimeLaunchOptions
} from './localRuntime'

class FakeChild extends EventEmitter implements RuntimeChild {
  kill = vi.fn((signal?: NodeJS.Signals) => {
    this.emit('exit', 0, signal ?? null)
    return true
  })
}

function setup(overrides: Record<string, unknown> = {}): {
  manager: ReturnType<typeof createLocalRuntimeManager>
  child: FakeChild
  healthCheck: ReturnType<typeof vi.fn>
  launch: ReturnType<typeof vi.fn>
} {
  let now = 0
  const child = new FakeChild()
  const healthCheck = vi.fn<() => Promise<boolean>>(async () => false)
  const launch = vi.fn(
    (command: string, args: string[], options: RuntimeLaunchOptions): FakeChild => {
      expect(command).toBe('ollama')
      expect(args).toEqual(['serve'])
      expect(options.shell).toBe(false)
      return child
    }
  )
  const manager = createLocalRuntimeManager({
    platform: 'darwin',
    arch: 'arm64',
    launch,
    healthCheck,
    now: () => now,
    delay: async (ms: number) => {
      now += ms
    },
    startupTimeoutMs: 300,
    pollIntervalMs: 100,
    ...overrides
  })
  return { manager, child, healthCheck, launch }
}

it('starts only the registered Ollama command with fixed args, no shell, and a minimal environment', async () => {
  const { manager, launch, healthCheck } = setup()
  healthCheck.mockResolvedValueOnce(false).mockResolvedValueOnce(true)

  const result = await manager.start('ollama')

  expect(result).toMatchObject({ runtimeId: 'ollama', state: 'ready', managed: true })
  expect(launch).toHaveBeenCalledOnce()
  expect(launch).toHaveBeenCalledWith(
    'ollama',
    ['serve'],
    expect.objectContaining({ shell: false })
  )
  const options = launch.mock.calls[0]?.[2]
  expect(options).toBeDefined()
  expect(options.stdio).toBe('ignore')
  expect(options.env.OLLAMA_HOST).toBe('127.0.0.1:11434')
  expect(options.env.OLLAMA_CONTEXT_LENGTH).toBe('8192')
  expect(options.env.ATLAS_API_TOKEN).toBeUndefined()
})

it('rejects unknown runtime IDs instead of turning them into commands', async () => {
  const { manager, launch } = setup()

  await expect(manager.start('ollama --version')).rejects.toThrow('Unsupported runtime')
  expect(launch).not.toHaveBeenCalled()
})

it('does not start a second process when Ollama is already managed and ready', async () => {
  const { manager, launch, healthCheck } = setup()
  healthCheck.mockResolvedValueOnce(false).mockResolvedValueOnce(true).mockResolvedValue(true)

  await manager.start('ollama')
  const second = await manager.start('ollama')

  expect(second).toMatchObject({ state: 'ready', managed: true })
  expect(launch).toHaveBeenCalledOnce()
})

it('does not probe or launch Ollama on shutdown when Atlas owns no process', async () => {
  const { manager, launch, healthCheck } = setup()

  await manager.shutdown()

  expect(launch).not.toHaveBeenCalled()
  expect(healthCheck).not.toHaveBeenCalled()
})

it('stops only the manager-owned process during app shutdown', async () => {
  const { manager, child, healthCheck } = setup()
  healthCheck.mockResolvedValueOnce(false).mockResolvedValueOnce(true)

  await manager.start('ollama')
  expect(await manager.shutdown()).toBe(true)
  expect(child.kill).toHaveBeenCalledWith('SIGTERM')
})

it('reports an external Ollama server as ready and never stops it', async () => {
  const { manager, launch, healthCheck } = setup()
  healthCheck.mockResolvedValue(true)

  expect(await manager.status('ollama')).toMatchObject({ state: 'ready', managed: false })
  expect(await manager.stop('ollama')).toMatchObject({ state: 'ready', managed: false })
  expect(launch).not.toHaveBeenCalled()
})

it('refuses to start outside the approved macOS ARM64 allowlist', async () => {
  const { manager, launch } = setup({ platform: 'darwin', arch: 'x64' })

  expect(await manager.start('ollama')).toMatchObject({ state: 'unavailable', managed: false })
  expect(launch).not.toHaveBeenCalled()
})

it('reports a missing Ollama executable as unavailable', async () => {
  const { manager } = setup({
    launch: () => {
      const child = new FakeChild()
      queueMicrotask(() =>
        child.emit('error', Object.assign(new Error('missing'), { code: 'ENOENT' }))
      )
      return child
    }
  })

  expect(await manager.start('ollama')).toMatchObject({ state: 'unavailable', managed: false })
})

it('reports an early process exit as failed without taking over another server', async () => {
  const healthCheck = vi.fn<() => Promise<boolean>>(async () => false)
  const { manager } = setup({
    healthCheck,
    launch: () => {
      const child = new FakeChild()
      queueMicrotask(() => child.emit('exit', 1, null))
      return child
    }
  })

  expect(await manager.start('ollama')).toMatchObject({ state: 'failed', managed: false })
})

it('bounds readiness polling and terminates only its own unready process', async () => {
  const { manager, child, healthCheck } = setup()
  healthCheck.mockResolvedValue(false)

  expect(await manager.start('ollama')).toMatchObject({ state: 'failed', managed: false })
  expect(healthCheck.mock.calls.length).toBeLessThanOrEqual(5)
  expect(child.kill).toHaveBeenCalledWith('SIGTERM')
})

it('stops a managed process but leaves an externally started process alone', async () => {
  const { manager, child, healthCheck } = setup()
  healthCheck.mockResolvedValueOnce(false).mockResolvedValueOnce(true)

  await manager.start('ollama')
  expect(await manager.stop('ollama')).toMatchObject({ state: 'unavailable', managed: false })
  expect(child.kill).toHaveBeenCalledWith('SIGTERM')
})
