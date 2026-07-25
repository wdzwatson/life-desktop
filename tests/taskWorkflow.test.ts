import assert from 'node:assert/strict'
import test from 'node:test'
import { getAutomaticTaskStatus, getReopenedTaskStatus, TASK_STATUS } from '../src/taskWorkflow'

const taskWindow = {
  start_date: '2026-07-25',
  start_time: '09:00:00',
  due_date: '2026-07-25',
  due_time: '18:00:00',
}

test('derives pending, in-progress, and overdue from the inclusive task window', () => {
  assert.equal(
    getAutomaticTaskStatus(taskWindow, new Date(2026, 6, 25, 8, 59, 59)),
    TASK_STATUS.pending,
  )
  assert.equal(
    getAutomaticTaskStatus(taskWindow, new Date(2026, 6, 25, 9, 0, 0)),
    TASK_STATUS.inProgress,
  )
  assert.equal(
    getAutomaticTaskStatus(taskWindow, new Date(2026, 6, 25, 18, 0, 0)),
    TASK_STATUS.inProgress,
  )
  assert.equal(
    getAutomaticTaskStatus(taskWindow, new Date(2026, 6, 25, 18, 0, 1)),
    TASK_STATUS.overdue,
  )
})

test('does not let time automation overwrite review or closed decisions', () => {
  assert.equal(
    getAutomaticTaskStatus(
      { ...taskWindow, status: TASK_STATUS.review, is_completed: 1 },
      new Date(2026, 6, 26),
    ),
    TASK_STATUS.review,
  )
  assert.equal(
    getAutomaticTaskStatus(
      { ...taskWindow, status: TASK_STATUS.closed, is_completed: 1 },
      new Date(2026, 6, 26),
    ),
    TASK_STATUS.closed,
  )
})

test('reopening a task re-enters the currently applicable automatic state', () => {
  assert.equal(getReopenedTaskStatus(taskWindow, new Date(2026, 6, 25, 12)), TASK_STATUS.inProgress)
  assert.equal(getReopenedTaskStatus(taskWindow, new Date(2026, 6, 26, 12)), TASK_STATUS.overdue)
})
