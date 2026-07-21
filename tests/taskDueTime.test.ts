import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('task instances persist and display an optional due time', () => {
  const schema = readFileSync(join(process.cwd(), 'electron', 'db', 'schema.ts'), 'utf8')
  const scheduler = readFileSync(join(process.cwd(), 'electron', 'taskSchedulerCore.ts'), 'utf8')
  const tasksView = readFileSync(join(process.cwd(), 'src', 'views', 'Tasks.tsx'), 'utf8')
  assert.match(schema, /due_time TEXT/)
  assert.match(scheduler, /due_date, due_time, recur_rule_id/)
  assert.match(tasksView, /const formatDue/)
  assert.match(tasksView, /overdue_due_datetime/)
})
