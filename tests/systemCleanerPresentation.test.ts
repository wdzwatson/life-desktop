import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

test('system cleaner exposes only reviewed IPC methods and visible progress UI', () => {
  const preload = readFileSync(path.resolve('electron/preload.ts'), 'utf8')
  const cleaner = readFileSync(path.resolve('src/views/SystemCleaner.tsx'), 'utf8')
  assert.match(preload, /startSystemCleanerScan/)
  assert.match(preload, /previewSystemCleaner/)
  assert.match(preload, /executeSystemCleaner/)
  assert.doesNotMatch(preload, /systemCleaner:deletePath|systemCleaner:runCommand/)
  assert.match(cleaner, /onSystemCleanerProgress/)
  assert.match(cleaner, /system-cleaner__progress/)
  assert.match(cleaner, /await confirm\(\{/)
})

test('system cleaner localization stays aligned', () => {
  const zh = JSON.parse(readFileSync(path.resolve('src/locales/zh-CN.json'), 'utf8'))
  const en = JSON.parse(readFileSync(path.resolve('src/locales/en-US.json'), 'utf8'))
  assert.equal(zh.toolbox.tab_cleaner, '系统清理')
  assert.equal(en.toolbox.tab_cleaner, 'System Cleaner')
  assert.deepEqual(Object.keys(zh.toolbox.cleaner).sort(), Object.keys(en.toolbox.cleaner).sort())
})
