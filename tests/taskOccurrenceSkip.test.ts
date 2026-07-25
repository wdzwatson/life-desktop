import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('deleting one recurring occurrence persists and reloads its exception before projecting tasks', () => {
  const tasksView = readFileSync(join(process.cwd(), 'src', 'views', 'Tasks.tsx'), 'utf8')
  assert.match(tasksView, /INSERT OR IGNORE INTO recurring_rule_occurrence_exceptions/)
  assert.match(tasksView, /WITH RECURSIVE task_tree/)
  assert.match(
    tasksView,
    /const skippedRes = await api\.dbQuery\([\s\S]*SELECT recur_rule_id, instance_key FROM recurring_rule_occurrence_exceptions/,
  )
  assert.match(tasksView, /setSkippedOccurrences\([\s\S]*item\.instance_key/)
})
