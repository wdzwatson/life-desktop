import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('recurring task deletion preserves completed history while removing the selected scope', () => {
  const tasksView = readFileSync(join(process.cwd(), 'src', 'views', 'Tasks.tsx'), 'utf8')

  assert.match(tasksView, /const deleteUnfinishedRecurringTaskTrees/)
  assert.match(tasksView, /parent_id IS NULL/)
  assert.match(tasksView, /is_completed = 0/)
  assert.match(tasksView, /deletionScope === 'end-repeat'/)
  assert.match(tasksView, /deletionScope === 'delete-repeat'/)
  assert.match(tasksView, /tasks\.delete_scope_end_repeat_description/)
  assert.match(tasksView, /tasks\.delete_scope_delete_repeat_description/)
})
