import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import LockScreen from './LockScreen'

afterEach(() => vi.unstubAllGlobals())

it('unlocks a signed-in profile with only its app password', async () => {
  const verifyAppPassword = vi.fn(async (password: string) => password === 'open sesame')
  const loginUser = vi.fn()
  vi.stubGlobal('api', {
    getProfile: async () => ({ name: 'Alex', avatarDataUrl: null }),
    verifyAppPassword,
    loginUser
  })
  const onUnlock = vi.fn()
  render(<LockScreen onUnlock={onUnlock} />)

  expect(await screen.findByText('Welcome back, Alex')).toBeTruthy()
  expect(screen.queryByPlaceholderText('Email address')).toBeNull()
  const password = screen.getByLabelText('App password')
  fireEvent.change(password, { target: { value: 'wrong' } })
  fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))
  expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Incorrect password.')
  expect(onUnlock).not.toHaveBeenCalled()

  fireEvent.change(password, { target: { value: 'open sesame' } })
  fireEvent.click(screen.getByRole('button', { name: 'Unlock' }))
  await waitFor(() => expect(onUnlock).toHaveBeenCalledOnce())
  expect(loginUser).not.toHaveBeenCalled()
})

it('keeps email login for an account that signed out', async () => {
  vi.stubGlobal('api', { getProfile: async () => ({ name: '', avatarDataUrl: null }) })
  render(<LockScreen onUnlock={vi.fn()} />)
  expect(await screen.findByPlaceholderText('Email address')).toBeTruthy()
})
