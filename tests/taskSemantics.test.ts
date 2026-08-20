import assert from 'node:assert/strict'
import test from 'node:test'
import { isManualTask, isRecurringDateInstance, isRecurringExecution, isRecurringStep } from '../src/views/taskSemantics'

test('task semantics distinguishes recurring dates, executions, steps, and manual tasks', () => {
  const date = { task_kind: 'recurring_date_instance', relation_kind: 'root' }
  const execution = { task_kind: 'recurring_execution', relation_kind: 'recurring_occurrence', instance_key: '2026-08-20T09:00' }
  const step = { task_kind: 'normal', relation_kind: 'manual_child', parent_id: 2, instance_key: null, recurring_instance_id: 7 }
  const manual = { task_kind: 'normal', relation_kind: 'manual_child', parent_id: 3, instance_key: null, recurring_instance_id: null }
  assert.equal(isRecurringDateInstance(date), true)
  assert.equal(isRecurringExecution(execution), true)
  assert.equal(isRecurringStep(step), true)
  assert.equal(isManualTask(manual), true)
  assert.equal(isRecurringExecution(step), false)
})
