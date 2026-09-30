import { afterEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { LocalRuntimeControl } from './Profile'

const status = (
  state: 'ready' | 'unavailable' | 'starting',
  managed: boolean,
  message: string
): {
  runtimeId: 'ollama'
  state: 'ready' | 'unavailable' | 'starting'
  managed: boolean
  supported: boolean
  message: string
} => ({
  runtimeId: 'ollama' as const,
  state,
  managed,
  supported: true,
  message
})

afterEach(() => vi.unstubAllGlobals())

it('starts and stops only the Ollama process Atlas manages', async () => {
  const getLocalRuntimeStatus = vi
    .fn()
    .mockResolvedValue(status('unavailable', false, 'Ollama is not running.'))
  const startLocalRuntime = vi.fn().mockResolvedValue(status('ready', true, 'Ollama is running.'))
  const stopLocalRuntime = vi
    .fn()
    .mockResolvedValue(status('unavailable', false, 'Atlas stopped Ollama.'))
  vi.stubGlobal('api', { getLocalRuntimeStatus, startLocalRuntime, stopLocalRuntime })

  render(<LocalRuntimeControl />)
  fireEvent.click(await screen.findByRole('button', { name: 'Start Ollama' }))
  expect(await screen.findByText('Ollama is running.')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Stop Ollama' }))
  expect(await screen.findByText('Atlas stopped Ollama.')).toBeTruthy()
  expect(startLocalRuntime).toHaveBeenCalledWith('ollama')
  expect(stopLocalRuntime).toHaveBeenCalledWith('ollama')
})

it('allows stopping an Atlas-owned server that is still starting', async () => {
  const stopLocalRuntime = vi
    .fn()
    .mockResolvedValue(status('unavailable', false, 'Atlas stopped Ollama.'))
  vi.stubGlobal('api', {
    getLocalRuntimeStatus: vi
      .fn()
      .mockResolvedValue(status('starting', true, 'Ollama is starting.')),
    startLocalRuntime: vi.fn(),
    stopLocalRuntime
  })

  render(<LocalRuntimeControl />)
  fireEvent.click(await screen.findByRole('button', { name: 'Stop Ollama' }))
  expect(await screen.findByText('Atlas stopped Ollama.')).toBeTruthy()
  expect(stopLocalRuntime).toHaveBeenCalledWith('ollama')
})

it('does not offer to stop an Ollama server Atlas does not own', async () => {
  vi.stubGlobal('api', {
    getLocalRuntimeStatus: vi
      .fn()
      .mockResolvedValue(status('ready', false, 'Ollama is already running outside Atlas.')),
    startLocalRuntime: vi.fn(),
    stopLocalRuntime: vi.fn()
  })

  render(<LocalRuntimeControl />)
  expect(await screen.findByText('Ollama is already running outside Atlas.')).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Stop Ollama' })).toBeNull()
  expect(
    screen.getByRole('button', { name: 'Ollama is already running' }).hasAttribute('disabled')
  ).toBe(true)
})
