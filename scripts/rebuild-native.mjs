import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const electronVersion = require('electron/package.json').version

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(
  'electron-rebuild',
  [
    '-f',
    '-w',
    'better-sqlite3',
    '--version',
    electronVersion,
    '--module-dir',
    '.',
    '--build-from-source',
  ],
  {
    env,
    shell: process.platform === 'win32',
    stdio: 'inherit',
  },
)

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 0)
})

child.on('error', (error) => {
  console.error(error)
  process.exit(1)
})
