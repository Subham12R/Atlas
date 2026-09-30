import { createHash, randomUUID } from 'node:crypto'
import { link, lstat, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const MAX_DOCUMENT_BYTES = 1024 * 1024
const DRAFT_ID = /^[a-f0-9]{32}$/

export function validateDraftFilename(filename) {
  if (typeof filename !== 'string' || filename !== filename.trim() || filename.length > 120 ||
      filename === '.' || filename === '..' || /[\\/\u0000-\u001f\u007f:*?"<>|]/.test(filename) ||
      !/\.md$/i.test(filename)) {
    throw new TypeError('invalid Markdown filename')
  }
  return filename
}

export function resolveDestinationSelection(selection) {
  return selection && !selection.canceled && typeof selection.filePath === 'string' && selection.filePath
    ? selection.filePath
    : null
}

export async function saveDocumentAtomically({
  draftId, filename, content, destination, overwrite = false, saved
}) {
  validateDraftFilename(filename)
  if (!DRAFT_ID.test(draftId) || typeof content !== 'string' ||
      Buffer.byteLength(content, 'utf8') > MAX_DOCUMENT_BYTES ||
      typeof destination !== 'string' ||
      path.basename(destination) !== path.basename(destination).trim()) {
    throw new TypeError('invalid document save request')
  }
  validateDraftFilename(path.basename(destination))
  if (!(saved instanceof Map)) throw new TypeError('save state required')

  const hash = createHash('sha256').update(content).digest('hex')
  const previous = saved.get(draftId)
  if (previous) {
    if (previous.path !== destination || previous.hash !== hash) {
      throw new Error('draft was already saved to a different destination or with different content')
    }
    return { status: 'saved', path: destination, duplicate: true }
  }

  if (!overwrite) {
    try {
      await lstat(destination)
      return { status: 'exists', path: destination }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }

  const temporary = path.join(path.dirname(destination), `.${randomUUID()}.atlas-tmp`)
  try {
    await writeFile(temporary, content, { flag: 'wx', mode: 0o600 })
    if (overwrite) {
      await rename(temporary, destination)
    } else {
      await link(temporary, destination)
    }
    saved.set(draftId, { path: destination, hash })
    return { status: 'saved', path: destination, duplicate: false }
  } catch (error) {
    if (error.code === 'EEXIST' && !overwrite) return { status: 'exists', path: destination }
    throw error
  } finally {
    await rm(temporary, { force: true })
  }
}
