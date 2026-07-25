import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

test('review decisions use compact, labelled icon buttons', () => {
  const tasksView = readFileSync(join(process.cwd(), 'src', 'views', 'Tasks.tsx'), 'utf8')

  assert.match(tasksView, /btn sm btn-icon task-review-action task-review-action--reject/)
  assert.match(tasksView, /btn sm btn-icon primary task-review-action task-review-action--approve/)
  assert.match(tasksView, /title=\{t\('tasks\.review_reject_action'\)\}/)
  assert.match(tasksView, /title=\{t\('tasks\.review_approve_action'\)\}/)
  assert.match(tasksView, /<Undo2 aria-hidden="true" \/>/)
})
