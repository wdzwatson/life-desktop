import assert from 'node:assert/strict'
import test from 'node:test'
import { getActionableTasks } from '../src/views/taskSemantics'

test('actionable task projection hides recurring containers and steps', () => {
  const result = getActionableTasks([
    { id: 1, task_kind: 'recurring_date_instance' },
    { id: 2, task_kind: 'recurring_execution' },
    { id: 3, task_kind: 'normal', relation_kind: 'manual_child', recurring_instance_id: 8 },
    { id: 4, task_kind: 'normal', relation_kind: 'root' },
    { id: 5, task_kind: 'normal', relation_kind: 'manual_child' },
  ])
  assert.deepEqual(result.map((task) => task.id), [2, 4, 5])
})
