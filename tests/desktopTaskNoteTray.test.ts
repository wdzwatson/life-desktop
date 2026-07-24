import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('Electron keeps a tray entry for reopening the main window and desktop note', () => {
  const mainProcess = readFileSync(join(process.cwd(), 'electron', 'main.ts'), 'utf8')

  assert.match(mainProcess, /function createAppTray\(\)/)
  assert.match(
    mainProcess,
    /process\.platform === 'darwin'[\s\S]*sourceIcon\.resize\(\{ width: 18, height: 18, quality: 'best' \}\)/,
  )
  assert.match(mainProcess, /打开 LifeOS/)
  assert.match(mainProcess, /打开今日任务便签/)
  assert.match(mainProcess, /mainWindow\?\.hide\(\)/)
  assert.match(mainProcess, /isQuitting = true/)
})
