import assert from 'node:assert/strict'
import test from 'node:test'

import { resolvePython } from '../scripts/build-server.mjs'

const serverRoot = '/repo/server'
const none = () => false

test('an explicit PYTHON always wins', () => {
  assert.deepEqual(
    resolvePython({ PYTHON: '/custom/python', VIRTUAL_ENV: '/venv' }, 'darwin', serverRoot, () => true),
    { command: '/custom/python', args: [] }
  )
})

test('uses the active virtualenv, then the server .venv, before a bare system python', () => {
  assert.equal(resolvePython({ VIRTUAL_ENV: '/venv' }, 'darwin', serverRoot, none).command, '/venv/bin/python')
  assert.equal(
    resolvePython({}, 'darwin', serverRoot, (p) => p === '/repo/server/.venv/bin/python').command,
    '/repo/server/.venv/bin/python'
  )
  assert.deepEqual(resolvePython({}, 'darwin', serverRoot, none), { command: 'python3', args: [] })
})

test('Windows uses Scripts\\python.exe and falls back to the py launcher', () => {
  assert.equal(
    resolvePython({ VIRTUAL_ENV: 'C:\\venv' }, 'win32', serverRoot, none).command.replaceAll('\\', '/'),
    'C:/venv/Scripts/python.exe'
  )
  assert.deepEqual(resolvePython({}, 'win32', serverRoot, none), { command: 'py', args: ['-3'] })
})
