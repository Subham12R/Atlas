import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import Onboarding from './Onboarding'

afterEach(() => vi.unstubAllGlobals())

it('starts on a full-window Atlas intro and advances to the existing account flow', async () => {
  vi.stubGlobal('matchMedia', () => ({
    matches: true,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  }))
  const { container } = render(<Onboarding onComplete={vi.fn()} />)
  expect(screen.getByRole('img', { name: 'Atlas' })).toBeTruthy()
  expect(screen.getByRole('button', { name: 'Get started' })).toBeTruthy()
  expect(container.firstElementChild?.className).toContain('bg-transparent')

  fireEvent.click(screen.getByRole('button', { name: 'Get started' }))
  const name = await screen.findByPlaceholderText('Your name')
  fireEvent.change(name, { target: { value: 'Alex' } })
  fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
  expect(await screen.findByPlaceholderText('Email address')).toBeTruthy()
  expect(screen.getByPlaceholderText('Password')).toBeTruthy()
})
