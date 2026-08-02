import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { registerSystemCleanerIpc, SYSTEM_CLEANER_CHANNELS } from '../electron/systemCleaner/ipc.ts'
import { SystemCleanerService, type SystemCleanerCategoryRule } from '../electron/systemCleaner/service.ts'

test('system cleaner IPC exposes a fixed whitelist and requires native confirmation before a scan', async () => {
  const handlers: Record<string, (event: unknown, payload?: unknown) => Promise<any>> = {}
  let confirmations = 0
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'life-cleaner-ipc-'))
  const rule: SystemCleanerCategoryRule = { id: 'npm_cache', risk: 'optional', title: 'Cache', description: 'Cache', roots: [root] }
  const service = new SystemCleanerService({ rules: () => [rule] })
  try {
    registerSystemCleanerIpc({ handle: (channel, handler) => { handlers[channel] = handler as any } }, {
      service,
      confirm: async () => { confirmations += 1; return { response: 0 } },
    })
    assert.deepEqual(SYSTEM_CLEANER_CHANNELS, [
      'systemCleaner:startScan', 'systemCleaner:getScan', 'systemCleaner:cancelScan', 'systemCleaner:previewCleanup', 'systemCleaner:executeCleanup',
    ])
    const started = await handlers['systemCleaner:startScan']({})
    assert.equal(started.success, true)
    assert.equal(confirmations, 1)
    const invalid = await handlers['systemCleaner:previewCleanup']({}, { taskId: started.data.taskId, categoryIds: ['outside_root'] })
    assert.equal(invalid.success, false)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
