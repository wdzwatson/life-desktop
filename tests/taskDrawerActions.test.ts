import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('drawer provides scoped deletion for recurring task roots', () => {
  const tasksView = readFileSync(join(process.cwd(), 'src', 'views', 'Tasks.tsx'), 'utf8')
  assert.match(tasksView, /type TaskDeletionScope = 'single' \| 'end-repeat' \| 'delete-repeat'/)
  assert.match(tasksView, /const openTaskDeletionConfirmation/)
  assert.match(tasksView, /isRecurringRootTask\(deletionConfirmationTask\)/)
  assert.match(tasksView, /name="task-delete-scope"/)
  assert.match(tasksView, /recurring_rule_occurrence_exceptions/)
  assert.match(tasksView, /WITH RECURSIVE task_tree/)
  assert.match(tasksView, /is_completed = 0/)
  assert.match(tasksView, /DELETE FROM recurring_rules WHERE id = \?/) 
})
