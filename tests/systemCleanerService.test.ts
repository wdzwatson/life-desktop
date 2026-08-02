import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { SystemCleanerService, type SystemCleanerCategoryRule } from '../electron/systemCleaner/service.ts'

async function waitForScan(service: SystemCleanerService, taskId: string) {
  for (let index = 0; index < 100; index += 1) {
    const scan = service.getScan(taskId)
    if (scan.state !== 'scanning') return scan
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('scan did not finish')
}

function makeRule(root: string): SystemCleanerCategoryRule {
  return { id: 'npm_cache', risk: 'optional', title: 'Test cache', description: 'Test-only cache.', roots: [root] }
}

test('system cleaner only deletes files from a reviewed immutable plan', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'life-cleaner-'))
  const cache = path.join(root, 'cache')
  const outside = path.join(root, 'outside.txt')
  await fs.mkdir(cache)
  const file = path.join(cache, 'package.tgz')
  await fs.writeFile(file, 'cache')
  await fs.writeFile(outside, 'keep')
  const service = new SystemCleanerService({ rules: () => [makeRule(cache)], disks: async () => [{ path: root, totalBytes: 100, freeBytes: 50 }] })
  try {
    const { taskId } = service.startScan()
    const scan = await waitForScan(service, taskId)
    assert.equal(scan.state, 'completed')
    assert.equal(scan.categories[0].fileCount, 1)
    const preview = await service.previewCleanup({ taskId, categoryIds: ['npm_cache'] })
    const result = await service.executeCleanup({ planHash: preview.planHash })
    assert.equal(result.deletedFiles, 1)
    await assert.rejects(() => fs.access(file))
    assert.equal(await fs.readFile(outside, 'utf8'), 'keep')
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})

test('system cleaner refuses links and skips files changed after preview', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'life-cleaner-'))
  const cache = path.join(root, 'cache')
  const outside = path.join(root, 'outside.txt')
  await fs.mkdir(cache)
  await fs.writeFile(outside, 'keep')
  await fs.symlink(outside, path.join(cache, 'linked'))
  const mutable = path.join(cache, 'mutable.tgz')
  await fs.writeFile(mutable, 'one')
  const service = new SystemCleanerService({ rules: () => [makeRule(cache)] })
  try {
    const { taskId } = service.startScan()
    const scan = await waitForScan(service, taskId)
    assert.equal(scan.categories[0].fileCount, 1)
    const preview = await service.previewCleanup({ taskId, categoryIds: ['npm_cache'] })
    await new Promise((resolve) => setTimeout(resolve, 5))
    await fs.writeFile(mutable, 'changed')
    const result = await service.executeCleanup({ planHash: preview.planHash })
    assert.equal(result.deletedFiles, 0)
    assert.equal(result.skippedFiles, 1)
    assert.equal(await fs.readFile(outside, 'utf8'), 'keep')
    assert.equal(await fs.readFile(mutable, 'utf8'), 'changed')
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
