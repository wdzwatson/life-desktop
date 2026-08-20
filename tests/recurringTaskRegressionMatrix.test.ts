import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('recurring task regression matrix keeps both task business models explicit', () => {
  const root = process.cwd()
  const semantics = readFileSync(join(root, 'src', 'views', 'taskSemantics.ts'), 'utf8')
  const scheduler = readFileSync(join(root, 'electron', 'taskSchedulerCore.ts'), 'utf8')
  const note = readFileSync(join(root, 'src', 'views', 'DesktopTaskNote.tsx'), 'utf8')
  assert.match(semantics, /getActionableTasks/)
  assert.match(scheduler, /INSERT OR IGNORE INTO recurring_instances/)
  assert.match(scheduler, /recurring_execution/)
  assert.match(scheduler, /recurring_rule_steps/)
  assert.match(note, /getActionableTasks/)
})
