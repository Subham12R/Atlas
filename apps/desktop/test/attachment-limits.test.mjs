import { test } from 'node:test'
import assert from 'node:assert/strict'
import { attachmentLimitError } from '../src/renderer/src/lib/attachment-limits.mjs'

test('count and byte limits are checked before FileReader', () => {
  const m = 1024 * 1024
  assert.equal(attachmentLimitError([{ size: 2 * m }]), null)
  assert.match(attachmentLimitError([{ size: 6 * m }]), /5 MiB/)
  assert.match(attachmentLimitError(Array(6).fill({ size: 1 })), /5 text/)
  assert.match(attachmentLimitError([{ size: 5 * m }, { size: 5 * m + 1 }]), /5 MiB/)
  assert.match(attachmentLimitError([{ size: 4 * m }, { size: 4 * m }], [{ size: 4 * m }]), /10 MiB/)
})
