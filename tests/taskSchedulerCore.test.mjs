import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { initializeUserDatabase } from '../electron/db/schema.ts'
import { runTaskSchedulerCore } from '../electron/taskSchedulerCore.ts'

test('scheduler writes the next day recurring task and its subtasks at midnight', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'life-task-scheduler-'))
  try {
    initializeUserDatabase(dir)
    const db = new Database(path.join(dir, 'tasks.db'))
    db.prepare(
      "INSERT INTO recurring_rules (title, frequency, start_date, start_time, time_slots) VALUES ('Daily review', 'daily', '2026-07-21', '09:00', '09:00,23:59')",
    ).run()
    db.prepare(
      "INSERT INTO recurring_rule_steps (rule_id, title, sort_order) VALUES (1, 'Write notes', 1)",
    ).run()
    const result = runTaskSchedulerCore(db, new Date(2026, 6, 22, 0, 1))
    assert.equal(result.generatedTasks.length, 1)
    assert.deepEqual(
      db
        .prepare(
          'SELECT start_date, start_time, due_date, due_time, instance_key, recurring_instance_id, recur_instance_root FROM tasks WHERE parent_id IS NULL',
        )
        .all(),
      [
        {
          start_date: '2026-07-22',
          start_time: '00:00:00',
          due_date: '2026-07-22',
          due_time: '23:59:59',
          instance_key: null,
          recurring_instance_id: 1,
          recur_instance_root: 1,
        },
      ],
    )
    assert.equal(
      db.prepare('SELECT COUNT(*) AS count FROM tasks WHERE parent_id IS NOT NULL').get().count,
      4,
    )
    db.close()
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
})

test('scheduler creates today task when the app starts after midnight', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'life-task-scheduler-'))
  try {
    initializeUserDatabase(dir)
    const db = new Database(path.join(dir, 'tasks.db'))
    db.prepare(
      "INSERT INTO recurring_rules (title, frequency, start_date, start_time, time_slots) VALUES ('Daily review', 'daily', '2026-07-21', '09:00', '09:00,23:59')",
    ).run()
    const result = runTaskSchedulerCore(db, new Date(2026, 6, 22, 8, 0))
    assert.equal(result.generatedTasks.length, 1)
    assert.deepEqual(
      db
        .prepare(
          'SELECT start_date, start_time, due_date, due_time, instance_key, recurring_instance_id, recur_instance_root FROM tasks WHERE parent_id IS NULL',
        )
        .all(),
      [
        {
          start_date: '2026-07-22',
          start_time: '00:00:00',
          due_date: '2026-07-22',
          due_time: '23:59:59',
          instance_key: null,
          recurring_instance_id: 1,
          recur_instance_root: 1,
        },
      ],
    )
    db.close()
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
})

test('scheduler preserves a recurring rule parent binding on generated instances', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'life-task-scheduler-'))
  try {
    initializeUserDatabase(dir)
    const db = new Database(path.join(dir, 'tasks.db'))
    db.prepare("INSERT INTO tasks (title) VALUES ('Health plan')").run()
    db.prepare(
      "INSERT INTO recurring_rules (title, frequency, start_date, start_time, parent_id) VALUES ('Run', 'daily', '2026-07-21', '09:00', 1)",
    ).run()

    runTaskSchedulerCore(db, new Date(2026, 6, 22, 8, 0))
    assert.deepEqual(
      db.prepare('SELECT parent_id, recur_instance_root, instance_key FROM tasks WHERE recur_rule_id = 1 AND recur_instance_root = 1').get(),
      { parent_id: 1, recur_instance_root: 1, instance_key: null },
    )
    db.close()
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
})

test('scheduler derives task status from start and due timestamps without changing review or closed tasks', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'life-task-scheduler-'))
  try {
    initializeUserDatabase(dir)
    const db = new Database(path.join(dir, 'tasks.db'))
    db.prepare(
      `INSERT INTO tasks (title, status, start_date, start_time, due_date, due_time) VALUES
      ('Later', '进行中', '2026-07-22', '10:00:00', '2026-07-22', '18:00:00'),
      ('Current', '待处理', '2026-07-22', '08:00:00', '2026-07-22', '18:00:00'),
      ('Late', '进行中', '2026-07-21', '08:00:00', '2026-07-21', '18:00:00'),
      ('Review', '待审核', '2026-07-21', '08:00:00', '2026-07-21', '18:00:00'),
      ('Closed', '已关闭', '2026-07-21', '08:00:00', '2026-07-21', '18:00:00')`,
    ).run()

    const result = runTaskSchedulerCore(db, new Date(2026, 6, 22, 9, 0))
    assert.equal(result.overdueTasks.length, 1)
    assert.deepEqual(db.prepare('SELECT title, status FROM tasks ORDER BY id').all(), [
      { title: 'Later', status: '待处理' },
      { title: 'Current', status: '进行中' },
      { title: 'Late', status: '已逾期' },
      { title: 'Review', status: '待审核' },
      { title: 'Closed', status: '已关闭' },
    ])
    db.close()
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
})

test('scheduler keeps time children isolated and remains idempotent for one date', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'life-task-scheduler-'))
  try {
    initializeUserDatabase(dir)
    const db = new Database(path.join(dir, 'tasks.db'))
    db.prepare(
      "INSERT INTO recurring_rules (title, frequency, start_date, start_time, time_slots) VALUES ('Brush teeth', 'daily', '2026-08-18', '09:00', '09:00,23:59')",
    ).run()
    runTaskSchedulerCore(db, new Date(2026, 7, 18, 8, 0))
    runTaskSchedulerCore(db, new Date(2026, 7, 18, 12, 0))
    const children = db
      .prepare(
        "SELECT id, parent_id, instance_key, status FROM tasks WHERE recur_instance_root = 0 AND parent_id IN (SELECT id FROM tasks WHERE recur_instance_root = 1) ORDER BY instance_key",
      )
      .all()
    assert.equal(children.length, 2)
    assert.deepEqual(children.map((task) => task.instance_key), [
      '2026-08-18T09:00',
      '2026-08-18T23:59',
    ])
    db.prepare("UPDATE tasks SET status = '已关闭', is_completed = 1, progress = 100 WHERE instance_key = '2026-08-18T09:00'").run()
    assert.equal(db.prepare("SELECT status FROM tasks WHERE instance_key = '2026-08-18T23:59'").get().status, '待处理')
    db.close()
  } finally {
    rmSync(dir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 })
  }
})
