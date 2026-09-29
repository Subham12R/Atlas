import { act, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { LoadingState } from './LoadingState'

afterEach(() => vi.useRealTimers())

it('shows actual elapsed time without announcing every timer tick', () => {
  vi.useFakeTimers()
  render(<LoadingState />)
  const status = screen.getByRole('status', { name: 'Thinking' })
  expect(status.textContent).toContain('0.0s')
  act(() => vi.advanceTimersByTime(1200))
  expect(status.textContent).toContain('1.2s')
  expect(screen.getByText('1.2s').getAttribute('aria-hidden')).toBe('true')
})
