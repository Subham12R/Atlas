import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { PromptBox } from './chatgpt-prompt-input'

it('offers one intent selector and keeps it for subsequent turns', () => {
  const onSubmitPrompt = vi.fn()
  render(<PromptBox onSubmitPrompt={onSubmitPrompt} />)

  fireEvent.click(screen.getByRole('button', { name: 'Intent: Auto' }))
  fireEvent.click(screen.getByRole('button', { name: 'Coding' }))
  expect(screen.queryByRole('button', { name: 'Execution mode: Auto' })).toBeNull()
  for (const prompt of ['Write a parser', 'Write tests']) {
    fireEvent.change(screen.getByPlaceholderText('Message Atlas...'), { target: { value: prompt } })
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
  }
  expect(onSubmitPrompt).toHaveBeenNthCalledWith(1, 'Write a parser', null, [], 'coding', 'research_brief')
  expect(onSubmitPrompt).toHaveBeenNthCalledWith(2, 'Write tests', null, [], 'coding', 'research_brief')
  expect(screen.getByRole('button', { name: 'Intent: Coding' })).toBeTruthy()
})

it('safe tools is unavailable for models without native tool calls', () => {
  const onSubmitPrompt = vi.fn()
  render(<PromptBox onSubmitPrompt={onSubmitPrompt} toolCallsAvailable={false} />)
  fireEvent.click(screen.getByRole('button', { name: 'Intent: Auto' }))
  expect(screen.getByRole('button', { name: 'Safe tools' }).hasAttribute('disabled')).toBe(true)
})

it('blocks image generation for providers without an image API', () => {
  const onSubmitPrompt = vi.fn()
  render(<PromptBox onSubmitPrompt={onSubmitPrompt} imageGenerationAvailable={false} />)
  fireEvent.click(screen.getByRole('button', { name: 'Intent: Auto' }))
  expect(screen.getAllByRole('button', { name: 'Generate image' }).every((button) => button.hasAttribute('disabled'))).toBe(true)
  fireEvent.change(screen.getByPlaceholderText('Message Atlas...'), { target: { value: 'An image' } })
  fireEvent.click(screen.getByRole('button', { name: 'Send message' }))
  expect(onSubmitPrompt).toHaveBeenCalledWith('An image', null, [], 'auto', 'research_brief')
})

it('lets the user stop a running reply without discarding the next queued prompt', () => {
  const onStop = vi.fn()
  render(<PromptBox isBusy onStop={onStop} onSubmitPrompt={vi.fn()} />)
  expect(screen.getByRole('button', { name: 'Stop response' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Stop response' }))
  expect(onStop).toHaveBeenCalledOnce()
  expect(screen.getByRole('button', { name: 'Queue message' })).toBeTruthy()
})

it('queues a message with the selected intent', () => {
  const onSubmitPrompt = vi.fn()
  render(<PromptBox isBusy onSubmitPrompt={onSubmitPrompt} />)
  fireEvent.click(screen.getByRole('button', { name: 'Intent: Auto' }))
  fireEvent.click(screen.getByRole('button', { name: 'Documentation' }))
  fireEvent.change(screen.getByPlaceholderText('Message Atlas...'), { target: { value: 'Summarize later' } })
  fireEvent.click(screen.getByRole('button', { name: 'Queue message' }))
  expect(onSubmitPrompt).toHaveBeenCalledWith('Summarize later', null, [], 'documentation', 'research_brief')
})
