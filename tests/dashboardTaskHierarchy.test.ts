import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

test('dashboard task toggles refresh recurring parent ancestors', () => {
  const dashboard = readFileSync('src/views/Dashboard.tsx', 'utf8')
  assert.match(dashboard, /buildAggregateTaskMutation\(Number\(parentId\)\)/)
  assert.match(dashboard, /buildCloseTaskTreeMutation\(id\)/)
  assert.match(dashboard, /SELECT parent_id FROM tasks WHERE id = \?/)
})
