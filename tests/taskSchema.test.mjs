import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { initializeUserDatabase } from '../electron/db/schema.ts'

test('task schema migrates legacy recurring task columns before creating recurrence index', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lifeos-task-schema-'))
  try {
    const dbPath = path.join(dir, 'tasks.db')
    const db = new Database(dbPath)

    db.exec(`
      CREATE TABLE tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        priority TEXT CHECK(priority IN ('high', 'mid', 'low')) DEFAULT 'mid',
        status TEXT NOT NULL DEFAULT '待收集',
        due_date TEXT,
        recur_rule_id INTEGER,
        parent_id INTEGER,
        progress INTEGER DEFAULT 0,
        associated_note_id INTEGER,
        is_completed INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE recurring_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        frequency TEXT CHECK(frequency IN ('daily', 'weekday', 'weekly', 'monthly', 'yearly', 'custom', 'cron')) DEFAULT 'daily',
        interval INTEGER DEFAULT 1,
        week_days TEXT,
        month_days TEXT,
        cron TEXT,
        end_condition TEXT,
        missed_policy TEXT DEFAULT 'accumulate',
        last_trigger_time TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE translations (
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        locale TEXT NOT NULL,
        translation TEXT NOT NULL,
        PRIMARY KEY (entity_type, entity_id, locale)
      );
    `)
    db.close()

    initializeUserDatabase(dir)

    const migratedDb = new Database(dbPath)
    try {
      const taskColumns = migratedDb
        .prepare('PRAGMA table_info(tasks)')
        .all()
        .map((column) => column.name)
      assert.ok(taskColumns.includes('instance_key'))

      const ruleColumns = migratedDb
        .prepare('PRAGMA table_info(recurring_rules)')
        .all()
        .map((column) => column.name)
      for (const column of ['start_date', 'start_time', 'priority']) {
        assert.ok(ruleColumns.includes(column), `missing ${column}`)
      }

      const stepColumns = migratedDb
        .prepare('PRAGMA table_info(recurring_rule_steps)')
        .all()
        .map((column) => column.name)
      for (const column of ['rule_id', 'title', 'sort_order']) {
        assert.ok(stepColumns.includes(column), `missing ${column}`)
      }

      assert.ok(
        migratedDb
          .prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?")
          .get('tasks_recur_instance_parent_idx'),
      )

      migratedDb
        .prepare(
          `
          INSERT INTO tasks (title, recur_rule_id, instance_key, parent_id)
          VALUES ('Generated task', 1, '2026-07-21T09:00', NULL)
        `,
        )
        .run()
    } finally {
      migratedDb.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('task schema creates template scheduling and step columns on a fresh database', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'life-task-schema-'))
  try {
    initializeUserDatabase(dir)
    const db = new Database(path.join(dir, 'tasks.db'))
    try {
      const taskColumns = db.prepare('PRAGMA table_info(tasks)').all().map((column) => column.name)
      const ruleColumns = db
        .prepare('PRAGMA table_info(recurring_rules)')
        .all()
        .map((column) => column.name)
      const stepColumns = db
        .prepare('PRAGMA table_info(recurring_rule_steps)')
        .all()
        .map((column) => column.name)
      const exceptionTable = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'recurring_rule_occurrence_exceptions'")
        .get()

      assert.ok(taskColumns.includes('instance_key'))
      assert.ok(ruleColumns.includes('start_date'))
      assert.ok(ruleColumns.includes('start_time'))
      assert.ok(ruleColumns.includes('priority'))
      assert.ok(stepColumns.includes('rule_id'))
      assert.ok(stepColumns.includes('sort_order'))
      assert.equal(exceptionTable?.name, 'recurring_rule_occurrence_exceptions')
    } finally {
      db.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('task schema prevents duplicate root instances for the same template occurrence', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'life-task-schema-'))
  try {
    initializeUserDatabase(dir)
    const db = new Database(path.join(dir, 'tasks.db'))
    try {
      db.prepare(
        `
        INSERT INTO tasks (title, recur_rule_id, instance_key, status)
        VALUES ('Daily check', 1, '2026-07-21T09:00', '待处理')
      `,
      ).run()
      assert.throws(() =>
        db
          .prepare(
            `
            INSERT INTO tasks (title, recur_rule_id, instance_key, status)
            VALUES ('Daily check duplicate', 1, '2026-07-21T09:00', '待处理')
          `,
          )
          .run(),
      )
      db.prepare(
        `
        INSERT INTO tasks (title, recur_rule_id, instance_key, parent_id, status)
        VALUES ('Child A', 1, '2026-07-21T09:00', 1, '待处理')
      `,
      ).run()
      db.prepare(
        `
        INSERT INTO tasks (title, recur_rule_id, instance_key, parent_id, status)
        VALUES ('Child B', 1, '2026-07-21T09:00', 1, '待处理')
      `,
      ).run()
      assert.equal(
        db
          .prepare(
            "SELECT COUNT(*) AS count FROM tasks WHERE recur_rule_id = 1 AND instance_key = '2026-07-21T09:00'",
          )
          .get().count,
        3,
      )
    } finally {
      db.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
