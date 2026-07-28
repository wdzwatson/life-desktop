import assert from 'node:assert/strict'
import test from 'node:test'
import { getTaskDuePresentation } from '../src/views/taskDuePresentationUtils.ts'

test('end-of-day deadlines retain their execution date without a time', () => {
  assert.deepEqual(getTaskDuePresentation('2026-07-22', '23:59:59'), {
    dateKey: '2026-07-22',
    time: null,
    isEndOfDay: true,
  })
  assert.deepEqual(getTaskDuePresentation('2026-12-31', '23:59:59'), {
    dateKey: '2026-12-31',
    time: null,
    isEndOfDay: true,
  })
})

test('time-specific deadlines retain their original date and minute', () => {
  assert.deepEqual(getTaskDuePresentation('2026-07-22', '18:30:00'), {
    dateKey: '2026-07-22',
    time: '18:30',
    isEndOfDay: false,
  })
})
