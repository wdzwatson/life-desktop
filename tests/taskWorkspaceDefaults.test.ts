import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('task workspace defaults to the list view and normalizes retired tabs', () => {
  const store = readFileSync(join(process.cwd(), 'src', 'store', 'useAppStore.ts'), 'utf8')
  const tasksView = readFileSync(join(process.cwd(), 'src', 'views', 'Tasks.tsx'), 'utf8')

  assert.match(store, /taskTab:\s*'list'/)
  assert.match(tasksView, /\['list', 'kanban', 'calendar'\]\.includes\(taskTab\)/)
})
