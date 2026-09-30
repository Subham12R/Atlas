import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import TitleBar from './TitleBar'

afterEach(() => vi.unstubAllGlobals())

it('keeps the mac-style controls on the left and dispatches each window action', () => {
  const api = { closeWindow: vi.fn(), minimizeWindow: vi.fn(), maximizeWindow: vi.fn() }
  vi.stubGlobal('api', api)
  render(<TitleBar transparent />)
  const controls = screen.getAllByRole('button')
  expect(controls.map((control) => control.getAttribute('aria-label'))).toEqual([
    'Close',
    'Minimize',
    'Maximize'
  ])
  expect(controls.slice(0, 2).every((control) => control.className.includes('-mr-2'))).toBe(true)
  controls.forEach((control) => fireEvent.click(control))
  expect(api.closeWindow).toHaveBeenCalledOnce()
  expect(api.minimizeWindow).toHaveBeenCalledOnce()
  expect(api.maximizeWindow).toHaveBeenCalledOnce()
})
