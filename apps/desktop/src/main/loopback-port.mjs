import { createServer } from 'node:net'

// The adjacent .d.mts provides this module's TypeScript contract.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export async function getFreeLoopbackPort() {
  const server = createServer()
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  try {
    // ponytail: release before spawn; retry with an inherited socket if port races appear.
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Could not determine the embedded server port')
    }
    return address.port
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()))
    })
  }
}
