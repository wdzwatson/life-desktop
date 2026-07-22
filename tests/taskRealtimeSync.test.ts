import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('task mutations broadcast a shared change event to both task surfaces', () => {
  const mainProcess = readFileSync(join(process.cwd(), 'electron', 'main.ts'), 'utf8')
  const preload = readFileSync(join(process.cwd(), 'electron', 'preload.ts'), 'utf8')
  const tasksView = readFileSync(join(process.cwd(), 'src', 'views', 'Tasks.tsx'), 'utf8')
  const noteView = readFileSync(join(process.cwd(), 'src', 'views', 'DesktopTaskNote.tsx'), 'utf8')

  assert.match(mainProcess, /emitTaskDataChanged\('query'\)/)
  assert.match(mainProcess, /emitTaskDataChanged\('transaction'\)/)
  assert.match(mainProcess, /window\.webContents\.send\('tasks:changed'/)
  assert.match(preload, /onTasksChanged/)
  assert.match(tasksView, /api\?\.onTasksChanged\?\.\(\(\) =>/)
  assert.match(noteView, /api\?\.onTasksChanged\?\.\(\(\) =>/)
})
