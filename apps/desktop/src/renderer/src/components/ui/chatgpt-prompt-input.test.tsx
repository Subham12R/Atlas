import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { PromptBox } from './chatgpt-prompt-input'

it('submits the chosen mode with the prompt, then resets for the next turn', () => {
  const onSubmitPrompt = vi.fn()
  render(<PromptBox onSubmitPrompt={onSubmitPrompt} />)

  fireEvent.click(screen.getByRole('button', { name: 'Execution mode: Auto' }))
  fireEvent.click(screen.getByRole('button', { name: 'Coding' }))
  fireEvent.change(screen.getByPlaceholderText('Message Atlas...'), {
    target: { value: 'Write a parser' }
  })
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }))

  expect(onSubmitPrompt).toHaveBeenCalledWith('Write a parser', null, [], 'coding')
  expect(screen.getByRole('button', { name: 'Execution mode: Auto' })).toBeTruthy()
})

it('keeps the chosen mode when submitting while another reply is busy', () => {
  const onSubmitPrompt = vi.fn()
  render(<PromptBox isBusy onSubmitPrompt={onSubmitPrompt} />)

  fireEvent.click(screen.getByRole('button', { name: 'Execution mode: Auto' }))
  fireEvent.click(screen.getByRole('button', { name: 'Documentation' }))
  fireEvent.change(screen.getByPlaceholderText('Message Atlas...'), {
    target: { value: 'Summarize later' }
  })
  fireEvent.click(screen.getByRole('button', { name: 'Queue message' }))

  expect(onSubmitPrompt).toHaveBeenCalledWith('Summarize later', null, [], 'documentation')
})
