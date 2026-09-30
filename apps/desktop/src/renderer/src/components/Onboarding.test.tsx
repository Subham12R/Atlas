import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import Onboarding from './Onboarding'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it('starts on a full-window Atlas intro and advances to the existing account flow', async () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  }))
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null)
  const { container } = render(<Onboarding onComplete={vi.fn()} />)
  expect(screen.getByRole('img', { name: 'Atlas' })).toBeTruthy()
  expect(container.querySelector('canvas')).toBeNull() // intro stays clear of the shader

  // The wordmark is background-clipped text: its box must out-pad the negative tracking or the
  // last letter is sliced flat.
  const wordmark = screen.getByRole('img', { name: 'Atlas' }).querySelector('span') as HTMLElement
  expect(wordmark.style.paddingInline).toBe('0.12em')
  expect(wordmark.style.marginInline).toBe('-0.12em')
  expect(screen.getByRole('button', { name: 'Get started' })).toBeTruthy()
  expect(container.firstElementChild?.className).toContain('bg-transparent')

  fireEvent.click(screen.getByRole('button', { name: 'Get started' }))
  const name = await screen.findByPlaceholderText('Your name')
  expect(container.querySelector('canvas')).not.toBeNull() // shader replaces the old blue glow
  fireEvent.change(name, { target: { value: 'Alex' } })
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  expect(await screen.findByPlaceholderText('Email address')).toBeTruthy()
  expect(screen.getByPlaceholderText('Password')).toBeTruthy()
})
