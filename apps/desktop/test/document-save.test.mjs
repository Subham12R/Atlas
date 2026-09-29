import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { resolveDestinationSelection, saveDocumentAtomically, validateDraftFilename } from '../src/main/document-save.mjs'

const draftId = 'a'.repeat(32)

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'atlas-document-'))
  try { await fn(dir) } finally { await rm(dir, { recursive: true, force: true }) }
}

test('cancelled destination selection creates no capability', () => {
  assert.equal(resolveDestinationSelection({ canceled: true, filePath: '' }), null)
  assert.equal(resolveDestinationSelection({ canceled: false, filePath: '' }), null)
})

test('filename validation rejects path traversal', () => {
  assert.throws(() => validateDraftFilename('../outside.md'))
  assert.throws(() => validateDraftFilename('..\\outside.md'))
})

test('save refuses overwrite unless confirmed and writes atomically', async () => {
  await withTempDir(async (dir) => {
    const destination = path.join(dir, 'draft.md')
    const saved = new Map()
    const first = await saveDocumentAtomically({ draftId, filename: 'draft.md', content: '# First', destination, saved })
    assert.equal(first.status, 'saved')
    assert.equal(await readFile(destination, 'utf8'), '# First')
    assert.deepEqual(await readdir(dir), ['draft.md'])

    const refused = await saveDocumentAtomically({ draftId: 'b'.repeat(32), filename: 'draft.md', content: '# Second', destination, saved })
    assert.equal(refused.status, 'exists')
    assert.equal(await readFile(destination, 'utf8'), '# First')

    const replaced = await saveDocumentAtomically({ draftId: 'b'.repeat(32), filename: 'draft.md', content: '# Second', destination, overwrite: true, saved })
    assert.equal(replaced.status, 'saved')
    assert.equal(await readFile(destination, 'utf8'), '# Second')
  })
})

test('duplicate draft save is idempotent and changed retries are rejected', async () => {
  await withTempDir(async (dir) => {
    const destination = path.join(dir, 'draft.md')
    const saved = new Map()
    const request = { draftId, filename: 'draft.md', content: '# Draft', destination, saved }
    await saveDocumentAtomically(request)
    assert.deepEqual(await saveDocumentAtomically(request), { status: 'saved', path: destination, duplicate: true })
    await assert.rejects(saveDocumentAtomically({ ...request, content: '# Changed' }))
  })
})
