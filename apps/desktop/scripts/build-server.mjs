import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const windows = process.platform === 'win32'
const useWindowsLauncher = windows && !process.env.PYTHON && !process.env.VIRTUAL_ENV
const python = process.env.PYTHON || (useWindowsLauncher ? 'py' : windows ? 'python' : 'python3')
const args = [
  ...(useWindowsLauncher ? ['-3'] : []),
  resolve(process.cwd(), '../../server/build_embedded.py')
]
const result = spawnSync(python, args, { stdio: 'inherit' })

if (result.error) {
  console.error(result.error.message)
  process.exit(1)
}
process.exit(result.status ?? 1)
