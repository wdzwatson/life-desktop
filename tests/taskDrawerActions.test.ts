import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('drawer distinguishes deleting a task from cancelling future repeats', () => {
  const tasksView = readFileSync(join(process.cwd(), 'src', 'views', 'Tasks.tsx'), 'utf8')
  assert.match(tasksView, /const handleDeleteTask/)
  assert.match(tasksView, /DELETE FROM tasks WHERE id = \?/) 
  assert.match(tasksView, /const handleCancelRepeat/)
  assert.match(tasksView, /DELETE FROM recurring_rules WHERE id = \?/) 
})
