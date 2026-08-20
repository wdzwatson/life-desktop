import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('materializing a virtual occurrence copies its configured subtasks', () => {
  const tasksView = readFileSync(join(process.cwd(), 'src', 'views', 'Tasks.tsx'), 'utf8')
  assert.match(tasksView, /SELECT \* FROM recurring_rule_steps WHERE rule_id = \?/)
  assert.match(tasksView, /parent_id, task_kind, relation_kind, progress\)/)
  assert.match(tasksView, /'recurring_date_instance'/)
  assert.match(tasksView, /'recurring_execution'/)
  assert.match(tasksView, /'normal', 'manual_child'/)
})

test('new recurring plans persist their selected calendar conditions', () => {
  const tasksView = readFileSync(join(process.cwd(), 'src', 'views', 'Tasks.tsx'), 'utf8')
  assert.match(tasksView, /ruleScheduleMode === 'rules' \? ruleWeekDays\.join\(','\) : ''/)
  assert.match(tasksView, /ruleScheduleMode === 'rules' \? ruleMonthDays\.join\(','\) : ''/)
})
