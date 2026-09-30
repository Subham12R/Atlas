import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Python that builds the embedded server: $PYTHON, else the active virtualenv, else
 * server/.venv, else the system interpreter. A bare system python usually lacks the
 * server's requirements (PyInstaller, sqlite-vec), so the project venv comes first. */
export function resolvePython(env, platform, serverRoot, exists = existsSync) {
  if (env.PYTHON) return { command: env.PYTHON, args: [] }
  const windows = platform === 'win32'
  const inVenv = (root) => (windows ? join(root, 'Scripts', 'python.exe') : join(root, 'bin', 'python'))
  if (env.VIRTUAL_ENV) return { command: inVenv(env.VIRTUAL_ENV), args: [] }
  const projectVenv = inVenv(join(serverRoot, '.venv'))
  if (exists(projectVenv)) return { command: projectVenv, args: [] }
  return windows ? { command: 'py', args: ['-3'] } : { command: 'python3', args: [] }
}

function main() {
  const serverRoot = resolve(process.cwd(), '../../server')
  const { command, args } = resolvePython(process.env, process.platform, serverRoot)
  const check = spawnSync(command, [...args, '-c', 'import PyInstaller'], { stdio: 'ignore' })
  if (check.error || check.status !== 0) {
    console.error(
      `PyInstaller is not available for ${command}.\n` +
        `Install the server requirements into that Python, e.g.:\n` +
        `  ${command} ${args.join(' ')} -m pip install -r ${join(serverRoot, 'requirements.txt')}\n` +
        'or point PYTHON at an interpreter that has them.'
    )
    process.exit(1)
  }
  console.log(`Building embedded server with ${command}`)
  const result = spawnSync(command, [...args, join(serverRoot, 'build_embedded.py')], {
    stdio: 'inherit'
  })
  if (result.error) {
    console.error(result.error.message)
    process.exit(1)
  }
  process.exit(result.status ?? 1)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
