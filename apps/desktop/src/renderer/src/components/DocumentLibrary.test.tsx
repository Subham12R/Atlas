import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import DocumentLibrary from './DocumentLibrary'

afterEach(() => vi.unstubAllGlobals())

it('indexes only a selected text file, shows source provenance, and removes its index', async () => {
  vi.stubGlobal('api', { getBackendConnection: async () => ({ url: 'http://127.0.0.1:8000', token: 'fixture-token' }) })
  let indexed = false
  const fetch = vi.fn<typeof globalThis.fetch>(async (url, init) => {
    const path = new URL(String(url)).pathname
    const method = init?.method || 'GET'
    if (path === '/documents' && method === 'POST') {
      indexed = true
      return new Response(JSON.stringify({ source_id: 'source-1' }), { status: 201 })
    }
    if (path === '/documents/source-1' && method === 'DELETE') {
      indexed = false
      return new Response(null, { status: 204 })
    }
    const body =
      path === '/documents/search'
        ? [
            {
              source_id: 'source-1',
              name: 'notes.md',
              chunk_id: 7,
              score: 1,
              text: 'Unique policy'
            }
          ]
        : indexed
          ? [{ source_id: 'source-1', name: 'notes.md', byte_size: 13 }]
          : []
    return new Response(JSON.stringify(body))
  })
  vi.stubGlobal('fetch', fetch)
  render(<DocumentLibrary />)

  const file = new File(['Unique policy'], 'notes.md', { type: 'text/markdown' })
  Object.defineProperty(file, 'arrayBuffer', {
    value: async () => new TextEncoder().encode('Unique policy').buffer
  })
  fireEvent.change(screen.getByLabelText('Select a text document'), { target: { files: [file] } })

  await screen.findByText('notes.md')
  const uploads = fetch.mock.calls.filter(
    ([url, init]) => new URL(String(url)).pathname === '/documents' && init?.method === 'POST'
  )
  expect(uploads).toHaveLength(1)
  expect(JSON.parse(String(uploads[0][1]?.body))).toEqual({
    name: 'notes.md',
    text: 'Unique policy'
  })
  expect(uploads[0][1]?.headers).toMatchObject({ Authorization: 'Bearer fixture-token' })

  fireEvent.change(screen.getByRole('searchbox', { name: 'Search documents' }), {
    target: { value: 'Unique policy' }
  })
  fireEvent.click(screen.getByRole('button', { name: 'Search documents' }))
  expect(await screen.findByText('notes.md · chunk 7')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: 'Remove index for notes.md' }))
  await waitFor(() => expect(screen.queryByText('notes.md')).toBeNull())
})
