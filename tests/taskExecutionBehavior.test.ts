import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('scheduler creates a task on its scheduled date without waiting for display time', () => {
  const main = readFileSync(join(process.cwd(), 'electron', 'main.ts'), 'utf8')
  assert.match(main, /getDueTemplateOccurrence\(rule, now, \{ ignoreStartTime: true \}\)/)
  assert.match(main, /recurring_rule_occurrence_exceptions WHERE recur_rule_id = \? AND instance_key = \?/)
})

test('task rows do not expose an unexplained trailing subtask icon action', () => {
  const tasksView = readFileSync(join(process.cwd(), 'src', 'views', 'Tasks.tsx'), 'utf8')
  const listSection = tasksView.slice(tasksView.indexOf('{/* TAB: LIST'), tasksView.indexOf('{/* TAB: CALENDAR'))
  assert.doesNotMatch(listSection, /task-row__subtask-action/)
})
