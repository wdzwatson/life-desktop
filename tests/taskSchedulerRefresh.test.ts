import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('scheduler events refresh the visible task data', () => {
  const preload = readFileSync(join(process.cwd(), 'electron', 'preload.ts'), 'utf8')
  const tasksView = readFileSync(join(process.cwd(), 'src', 'views', 'Tasks.tsx'), 'utf8')
  assert.match(preload, /onTaskSchedulerChanged/)
  assert.match(preload, /scheduler:notif/)
  assert.match(tasksView, /api\?\.onTaskSchedulerChanged\?\.\(\(\) =>/)
})
