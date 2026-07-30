import { spawn } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const electronPath = require('electron')
const testsDir = path.resolve('tests')
const tsxCli = path.resolve('node_modules', 'tsx', 'dist', 'cli.mjs')

const allTests = readdirSync(testsDir)
  .filter((file) => file.endsWith('.test.ts') || file.endsWith('.test.mjs'))
  .sort()
  .map((file) => path.posix.join('tests', file))

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
  'tests/taskSchedulerCore.test.mjs',
  'tests/vaultService.test.mjs',
  'tests/videoSchema.test.mjs',
  'tests/douyinFavorites.test.mjs',
])
for (const testFile of allTests) {
  if (readFileSync(testFile, 'utf8').includes('better-sqlite3')) electronNodeTests.add(testFile)
}
const nodeTests = allTests.filter((file) => !electronNodeTests.has(file))
const nodeTestBatchSize = 12

function run(command, args, options = {}) {
  const { timeoutMs, ...spawnOptions } = options
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: 'inherit',
      ...spawnOptions,
    })
    const timeout = timeoutMs
      ? setTimeout(() => {
          child.kill()
          reject(new Error(`${command} timed out after ${timeoutMs}ms`))
        }, timeoutMs)
      : null

    child.on('exit', (code, signal) => {
      if (timeout) clearTimeout(timeout)
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

for (let start = 0; start < nodeTests.length; start += nodeTestBatchSize) {
  const batch = nodeTests.slice(start, start + nodeTestBatchSize)
  console.log(`Running Node test batch ${start / nodeTestBatchSize + 1}: ${batch[0]} through ${batch.at(-1)}`)
  await run(process.execPath, [tsxCli, '--test', ...batch])
}

for (const testFile of electronNodeTests) {
  if (!allTests.includes(testFile)) continue
  const options = { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeoutMs: 60000 }
  try {
    await run(electronPath, ['--import', 'tsx', '--test', testFile], options)
  } catch (error) {
    if (!String(error).includes('timed out')) throw error
    console.warn(`Retrying timed out Electron test: ${testFile}`)
    await run(electronPath, ['--import', 'tsx', '--test', testFile], options)
  }
}
