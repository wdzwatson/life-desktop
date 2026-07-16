import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getCalendarMonthDays,
  getCalendarWeekDays,
  groupTasksByDueDate,
  normalizeTaskDueDate,
  shiftCalendarDate,
  toCalendarDateKey,
} from '../src/views/taskCalendarUtils'

test('calendar date helpers produce stable local date keys', () => {
  assert.equal(toCalendarDateKey(new Date(2026, 6, 16)), '2026-07-16')
  assert.equal(normalizeTaskDueDate('2026-07-16'), '2026-07-16')
  assert.equal(normalizeTaskDueDate('2026-07-16T09:00:00'), '2026-07-16')
  assert.equal(normalizeTaskDueDate('2026-02-30'), null)
  assert.equal(normalizeTaskDueDate(''), null)
})

test('calendar week runs from Monday through Sunday', () => {
  const week = getCalendarWeekDays(new Date(2026, 6, 16)).map(toCalendarDateKey)
  assert.deepEqual(week, [
    '2026-07-13',
    '2026-07-14',
    '2026-07-15',
    '2026-07-16',
    '2026-07-17',
    '2026-07-18',
    '2026-07-19',
  ])
})

test('calendar month grid contains six complete weeks', () => {
  const month = getCalendarMonthDays(new Date(2026, 6, 16)).map(toCalendarDateKey)
  assert.equal(month.length, 42)
  assert.equal(month[0], '2026-06-29')
  assert.equal(month[41], '2026-08-09')
})

test('calendar period shifting keeps dates navigable across month boundaries', () => {
  assert.equal(toCalendarDateKey(shiftCalendarDate(new Date(2026, 6, 16), 'day', 1)), '2026-07-17')
  assert.equal(
    toCalendarDateKey(shiftCalendarDate(new Date(2026, 6, 16), 'week', -1)),
    '2026-07-09',
  )
  assert.equal(
    toCalendarDateKey(shiftCalendarDate(new Date(2026, 0, 31), 'month', 1)),
    '2026-02-28',
  )
})

test('calendar task grouping ignores missing and invalid due dates', () => {
  const tasks = [
    { id: 1, due_date: '2026-07-16' },
    { id: 2, due_date: '2026-07-16T14:00:00' },
    { id: 3, due_date: null },
    { id: 4, due_date: 'invalid' },
  ]
  const grouped = groupTasksByDueDate(tasks)

  assert.deepEqual(
    grouped.get('2026-07-16')?.map((task) => task.id),
    [1, 2],
  )
  assert.equal(grouped.size, 1)
})
