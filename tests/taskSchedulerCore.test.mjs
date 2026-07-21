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
    db.prepare("INSERT INTO recurring_rules (title, frequency, start_date, start_time) VALUES ('Daily review', 'daily', '2026-07-21', '09:00')").run()
    db.prepare("INSERT INTO recurring_rule_steps (rule_id, title, sort_order) VALUES (1, 'Write notes', 1)").run()
    const result = runTaskSchedulerCore(db, new Date(2026, 6, 22, 0, 1))
    assert.equal(result.generatedTasks.length, 1)
    assert.deepEqual(db.prepare('SELECT due_date, instance_key FROM tasks WHERE parent_id IS NULL').all(), [{ due_date: '2026-07-22', instance_key: '2026-07-22T09:00' }])
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM tasks WHERE parent_id IS NOT NULL').get().count, 1)
    db.close()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('scheduler creates today task when the app starts after midnight', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'life-task-scheduler-'))
  try {
    initializeUserDatabase(dir)
    const db = new Database(path.join(dir, 'tasks.db'))
    db.prepare("INSERT INTO recurring_rules (title, frequency, start_date, start_time) VALUES ('Daily review', 'daily', '2026-07-21', '09:00')").run()
    const result = runTaskSchedulerCore(db, new Date(2026, 6, 22, 8, 0))
    assert.equal(result.generatedTasks.length, 1)
    assert.deepEqual(
      db.prepare('SELECT due_date, instance_key FROM tasks WHERE parent_id IS NULL').all(),
      [{ due_date: '2026-07-22', instance_key: '2026-07-22T09:00' }],
    )
    db.close()
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
