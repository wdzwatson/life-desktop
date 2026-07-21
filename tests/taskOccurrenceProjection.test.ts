import assert from 'node:assert/strict'
import test from 'node:test'
import { projectCalendarOccurrences } from '../src/views/taskOccurrenceProjection'

test('calendar projects future repeated occurrences while real tasks win', () => {
  const projected = projectCalendarOccurrences(
    [{ id: 7, title: 'Real', priority: 'mid', status: '待处理', due_date: '2026-07-22', recur_rule_id: 1, instance_key: '2026-07-22T09:00' }],
    [{ id: 1, title: 'Review', frequency: 'daily', start_date: '2026-07-21', start_time: '09:00' }],
    new Date(2026, 6, 21), new Date(2026, 6, 23),
  )
  assert.equal(projected.filter((item) => item.due_date === '2026-07-22').length, 1)
  assert.deepEqual(projected.filter((item) => item.is_virtual).map((item) => item.due_date), ['2026-07-21', '2026-07-23'])
})

test('calendar omits a skipped recurring occurrence', () => {
  const projected = projectCalendarOccurrences(
    [],
    [{ id: 1, title: 'Review', frequency: 'daily', start_date: '2026-07-21', start_time: '09:00' }],
    new Date(2026, 6, 21), new Date(2026, 6, 23),
    new Set(['1:2026-07-22T09:00']),
  )
  assert.deepEqual(projected.map((item) => item.due_date), ['2026-07-21', '2026-07-23'])
})

test('calendar includes a future one-time task before it is materialized', () => {
  const projected = projectCalendarOccurrences(
    [],
    [{ id: 9, title: 'Submit form', frequency: 'custom', start_date: '2026-07-23', start_time: '09:00' }],
    new Date(2026, 6, 21), new Date(2026, 6, 24),
  )
  assert.deepEqual(projected.map((item) => item.due_date), ['2026-07-23'])
})
