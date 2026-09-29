import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import test from 'node:test'

import { getFreeLoopbackPort } from '../src/main/loopback-port.mjs'

test('returns an available IPv4 loopback port', async () => {
  const port = await getFreeLoopbackPort()
  assert.ok(port > 0)
  assert.notEqual(port, 8000)

  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
})
