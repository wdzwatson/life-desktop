import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('deleting one recurring occurrence persists an exception before removing its task tree', () => {
  const tasksView = readFileSync(join(process.cwd(), 'src', 'views', 'Tasks.tsx'), 'utf8')
  assert.match(tasksView, /INSERT OR IGNORE INTO recurring_rule_occurrence_exceptions/)
  assert.match(tasksView, /WITH RECURSIVE task_tree/)
})
