import assert from 'node:assert/strict'
import test from 'node:test'
import { isTrustedRendererUrl } from '../src/main/renderer-origin.mjs'

test('backend token IPC is scoped to the loaded renderer entry, not another page or frame', () => {
  const entry = 'file:///Applications/Atlas.app/Contents/Resources/app.asar/out/renderer/index.html'
  assert.equal(isTrustedRendererUrl(`${entry}#/about`, entry), true)
  assert.equal(isTrustedRendererUrl('https://untrusted.example/', entry), false)
  assert.equal(isTrustedRendererUrl(entry.replace('index.html', 'evil.html'), entry), false)
  assert.equal(isTrustedRendererUrl('not a URL', entry), false)
  assert.equal(isTrustedRendererUrl('http://localhost:5173/#/about', 'http://localhost:5173/'), true)
  assert.equal(isTrustedRendererUrl('https://untrusted.example/', 'http://localhost:5173/'), false)
})
