import assert from 'node:assert/strict'
import test from 'node:test'
import { isExternalWebUrl } from '../src/main/external-url.mjs'

test('only HTTP(S) URLs without credentials may leave the Electron renderer', () => {
  assert.equal(isExternalWebUrl('https://example.org/source'), true)
  assert.equal(isExternalWebUrl('http://example.org/source'), true)
  for (const url of [
    'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,hello',
    'mailto:someone@example.org', 'https://user:pass@example.org/',
    'https://example.org/\n', 'not a URL'
  ]) assert.equal(isExternalWebUrl(url), false, url)
})
