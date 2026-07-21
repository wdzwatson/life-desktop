import { spawn } from 'node:child_process'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const testsDir = path.resolve('tests')
const tsxBin = path.resolve(
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'tsx.cmd' : 'tsx',
)

const allTests = readdirSync(testsDir)
  .filter((file) => file.endsWith('.test.ts') || file.endsWith('.test.mjs'))
  .sort()
  .map((file) => path.join('tests', file))

const electronNodeTests = new Set([
  'tests/aiSchema.test.mjs',
  'tests/aiModelService.test.mjs',
  'tests/aiProviderService.test.mjs',
  'tests/aiAgentService.test.mjs',
  'tests/aiMcpConfigService.test.mjs',
  'tests/aiMcpManager.test.mjs',
  'tests/aiMediaSecurity.test.mjs',
  'tests/aiMediaProtocol.test.mjs',
  'tests/aiVideoGeneration.test.mjs',
  'tests/aiVideoAssetService.test.mjs',
  'tests/aiStorageService.test.mjs',
  'tests/aiRecovery.test.mjs',
  'tests/aiConversationService.test.mjs',
  'tests/aiConversationIpc.test.mjs',
  'tests/aiChatRoundTrip.test.mjs',
  'tests/dbTransaction.test.mjs',
  'tests/taskSchema.test.mjs',
  'tests/vaultService.test.mjs',
  'tests/videoSchema.test.mjs',
])
const nodeTests = allTests.filter((file) => !electronNodeTests.has(file))

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: process.platform === 'win32',
      ...options,
    })

    child.on('exit', (code, signal) => {
      if (signal) {
        reject(new Error(`${command} was terminated by ${signal}`))
        return
      }
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`${command} exited with code ${code}`))
    })

    child.on('error', reject)
  })
}

if (nodeTests.length > 0) {
  await run(tsxBin, ['--test', ...nodeTests])
}

for (const testFile of electronNodeTests) {
  if (!allTests.includes(testFile)) continue
  await run(electronPath, ['--import', 'tsx', '--test', testFile], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
    },
  })
}
