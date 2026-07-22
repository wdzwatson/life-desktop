import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getDesktopTaskDateState,
  getDesktopTasksForDate,
  getUserDateKey,
  moveDesktopTaskId,
  sortDesktopTasksByOrder,
} from '../src/views/taskDesktopUtils'

test('uses the requested user timezone when deriving the natural-day key', () => {
  const date = new Date('2026-07-22T00:30:00.000Z')

  assert.equal(getUserDateKey(date, 'Asia/Shanghai'), '2026-07-22')
  assert.equal(getUserDateKey(date, 'America/Los_Angeles'), '2026-07-21')
})

test('a task is active when today is inside its inclusive task period', () => {
  const state = getDesktopTaskDateState(
    { start_date: '2026-07-20', end_date: '2026-07-22', status: '待处理' },
    '2026-07-22',
  )

  assert.equal(state.isActiveToday, true)
  assert.equal(state.isOverdue, false)
  assert.equal(state.isVisible, true)
})

test('a task whose period ended before today is overdue and visible', () => {
  const state = getDesktopTaskDateState(
    { start_date: '2026-07-20', end_date: '2026-07-21', status: '已逾期' },
    '2026-07-22',
  )

  assert.equal(state.isActiveToday, false)
  assert.equal(state.isOverdue, true)
  assert.equal(state.isVisible, true)
})

test('legacy due_date-only tasks use due_date as their period end', () => {
  assert.equal(
    getDesktopTaskDateState({ due_date: '2026-07-23', status: '待处理' }, '2026-07-22').isVisible,
    true,
  )
  assert.equal(
    getDesktopTaskDateState({ due_date: '2026-07-21', status: '已逾期' }, '2026-07-22').isOverdue,
    true,
  )
})

test('completed tasks remain visible when their period is active or overdue', () => {
  const tasks = [
    { id: 1, start_date: '2026-07-22', end_date: '2026-07-22', is_completed: 1 },
    { id: 2, due_date: '2026-07-21', is_completed: 1, status: '已逾期' },
    { id: 3, due_date: '2026-07-22', status: '已关闭', is_completed: 1 },
  ]

  assert.deepEqual(
    getDesktopTasksForDate(tasks, '2026-07-22').map((task) => task.id),
    [1, 2],
  )
})

test('desktop task order is local and can move one task before another', () => {
  assert.deepEqual(moveDesktopTaskId([1, 2, 3], 3, 1), [3, 1, 2])
  assert.deepEqual(moveDesktopTaskId([1, 2, 3], 1, 3), [2, 1, 3])
  assert.deepEqual(moveDesktopTaskId([1, 2, 3], 2, 2), [1, 2, 3])
})

test('tasks missing from a saved order are appended after ordered tasks', () => {
  const tasks = [{ id: 3 }, { id: 1 }, { id: 2 }]

  assert.deepEqual(
    sortDesktopTasksByOrder(tasks, [2, 1]).map((task) => task.id),
    [2, 1, 3],
  )
})
