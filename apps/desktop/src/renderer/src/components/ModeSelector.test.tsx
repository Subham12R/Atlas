import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { ModeSelector } from './ModeSelector'

it('offers four labeled modes and reports the selected one', () => {
  const onChange = vi.fn()
  render(<ModeSelector value="auto" onChange={onChange} />)

  const select = screen.getByRole('combobox', { name: 'Execution mode' })
  expect(Array.from(select.querySelectorAll('option'), (option) => option.textContent)).toEqual([
    'Auto',
    'Research',
    'Coding',
    'Documentation'
  ])
  fireEvent.change(select, { target: { value: 'research' } })
  expect(onChange).toHaveBeenCalledWith('research')
})
