import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { ModeSelector } from './ModeSelector'

it('opens like Tools, labels the current mode, and closes after selection', () => {
  const onChange = vi.fn()
  const { rerender } = render(<ModeSelector value="auto" onChange={onChange} />)

  fireEvent.click(screen.getByRole('button', { name: 'Execution mode: Auto' }))
  for (const label of ['Auto', 'Research', 'Coding', 'Documentation']) {
    expect(screen.getByRole('button', { name: label })).toBeTruthy()
  }
  expect(screen.getByRole('button', { name: 'Auto' }).getAttribute('aria-pressed')).toBe('true')
  fireEvent.click(screen.getByRole('button', { name: 'Research' }))
  expect(onChange).toHaveBeenCalledWith('research')
  rerender(<ModeSelector value="research" onChange={onChange} />)
  expect(screen.getByRole('button', { name: 'Execution mode: Research' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Coding' })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: 'Execution mode: Research' }))
  expect(screen.getByRole('button', { name: 'Research' }).getAttribute('aria-pressed')).toBe('true')
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('button', { name: 'Coding' })).toBeNull()
})
