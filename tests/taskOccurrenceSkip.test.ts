import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('skipping an occurrence persists an exception before removing its task', () => {
  const tasksView = readFileSync(join(process.cwd(), 'src', 'views', 'Tasks.tsx'), 'utf8')
  assert.match(tasksView, /INSERT OR IGNORE INTO recurring_rule_occurrence_exceptions/)
  assert.match(tasksView, /DELETE FROM tasks WHERE parent_id = \?/) 
})
