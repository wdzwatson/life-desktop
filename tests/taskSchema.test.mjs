import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { initializeUserDatabase } from '../electron/db/schema.ts'

test('book category schema adds parent ids without losing legacy shelves', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lifeos-book-category-schema-'))
  try {
    const dbPath = path.join(dir, 'books.db')
    const db = new Database(dbPath)
    db.exec(`
      CREATE TABLE categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        sort_order INTEGER DEFAULT 0
      );
      INSERT INTO categories (name, sort_order) VALUES ('技术', 1);
    `)
    db.close()

    initializeUserDatabase(dir)

    const migratedDb = new Database(dbPath)
    try {
      const categoryColumns = migratedDb
        .prepare('PRAGMA table_info(categories)')
        .all()
        .map((column) => column.name)
      assert.ok(categoryColumns.includes('parent_id'))
      const bookColumns = migratedDb
        .prepare('PRAGMA table_info(books)')
        .all()
        .map((column) => column.name)
      assert.ok(bookColumns.includes('cover_path'))
      assert.deepEqual(
        migratedDb.prepare('SELECT id, name, parent_id FROM categories').all(),
        [{ id: 1, name: '技术', parent_id: null }],
      )
    } finally {
      migratedDb.close()
    }
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 })
    } catch {
      // Windows may keep SQLite WAL handles briefly after Electron closes a test database.
    }
  }
})

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
      assert.ok(taskColumns.includes('closed_from_status'))
      assert.ok(taskColumns.includes('requires_review'))
      assert.ok(taskColumns.includes('start_date'))
      assert.ok(taskColumns.includes('start_time'))

      const ruleColumns = migratedDb
        .prepare('PRAGMA table_info(recurring_rules)')
        .all()
        .map((column) => column.name)
      for (const column of [
        'start_date',
        'start_time',
        'end_date',
        'schedule_mode',
        'excluded_week_days',
        'excluded_month_days',
        'priority',
        'requires_review',
      ]) {
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
      assert.ok(
        migratedDb
          .prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?")
          .get('tasks_parent_id_idx'),
      )
      assert.ok(
        migratedDb
          .prepare("SELECT 1 FROM sqlite_master WHERE type = 'trigger' AND name = ?")
          .get('tasks_parent_no_cycle'),
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
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 })
    } catch {
      // Windows may keep SQLite WAL handles briefly after Electron closes a test database.
    }
  }
})

test('task schema rejects self and descendant parent bindings', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'life-task-hierarchy-schema-'))
  try {
    initializeUserDatabase(dir)
    const db = new Database(path.join(dir, 'tasks.db'))
    try {
      db.prepare("INSERT INTO tasks (title) VALUES ('Root')").run()
      db.prepare("INSERT INTO tasks (title, parent_id) VALUES ('Child', 1)").run()
      db.prepare("INSERT INTO tasks (title, parent_id) VALUES ('Grandchild', 2)").run()

      assert.throws(
        () => db.prepare('UPDATE tasks SET parent_id = ? WHERE id = ?').run(1, 1),
        /own parent/i,
      )
      assert.throws(
        () => db.prepare('UPDATE tasks SET parent_id = ? WHERE id = ?').run(3, 1),
        /descendants/i,
      )
      assert.doesNotThrow(() => db.prepare('UPDATE tasks SET parent_id = ? WHERE id = ?').run(1, 3))
    } finally {
      db.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('task schema keeps peer links between tasks at the same level only', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'life-task-peer-schema-'))
  try {
    initializeUserDatabase(dir)
    const db = new Database(path.join(dir, 'tasks.db'))
    try {
      db.prepare("INSERT INTO tasks (title) VALUES ('Parent')").run()
      db.prepare("INSERT INTO tasks (title, parent_id) VALUES ('Peer A', 1)").run()
      db.prepare("INSERT INTO tasks (title, parent_id) VALUES ('Peer B', 1)").run()
      assert.doesNotThrow(() =>
        db.prepare('INSERT INTO task_peer_links (task_id, peer_task_id) VALUES (?, ?)').run(2, 3),
      )
      assert.throws(
        () =>
          db.prepare('INSERT INTO task_peer_links (task_id, peer_task_id) VALUES (?, ?)').run(1, 2),
        /same parent/i,
      )

      db.prepare('UPDATE tasks SET parent_id = NULL WHERE id = ?').run(3)
      assert.equal(db.prepare('SELECT COUNT(*) AS count FROM task_peer_links').get().count, 0)
    } finally {
      db.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('task schema rejects a recurring rule that ends before its first generation date', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'life-task-rule-range-schema-'))
  try {
    initializeUserDatabase(dir)
    const db = new Database(path.join(dir, 'tasks.db'))
    try {
      assert.throws(
        () =>
          db
            .prepare(
              "INSERT INTO recurring_rules (title, frequency, start_date, end_date) VALUES ('Invalid range', 'daily', '2026-07-28', '2026-07-27')",
            )
            .run(),
        /last generation date/i,
      )
    } finally {
      db.close()
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
      const taskColumns = db
        .prepare('PRAGMA table_info(tasks)')
        .all()
        .map((column) => column.name)
      const ruleColumns = db
        .prepare('PRAGMA table_info(recurring_rules)')
        .all()
        .map((column) => column.name)
      const stepColumns = db
        .prepare('PRAGMA table_info(recurring_rule_steps)')
        .all()
        .map((column) => column.name)
      const exceptionTable = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'recurring_rule_occurrence_exceptions'",
        )
        .get()
      const recurringInstanceColumns = db
        .prepare('PRAGMA table_info(recurring_instances)')
        .all()
        .map((column) => column.name)

      assert.ok(taskColumns.includes('instance_key'))
      assert.ok(taskColumns.includes('closed_from_status'))
      assert.ok(taskColumns.includes('due_time'))
      assert.ok(taskColumns.includes('requires_review'))
      assert.ok(taskColumns.includes('start_date'))
      assert.ok(taskColumns.includes('start_time'))
      assert.ok(ruleColumns.includes('start_date'))
      assert.ok(ruleColumns.includes('start_time'))
      assert.ok(ruleColumns.includes('end_date'))
      assert.ok(ruleColumns.includes('schedule_mode'))
      assert.ok(ruleColumns.includes('excluded_week_days'))
      assert.ok(ruleColumns.includes('excluded_month_days'))
      assert.ok(ruleColumns.includes('priority'))
      assert.ok(ruleColumns.includes('requires_review'))
      assert.ok(stepColumns.includes('rule_id'))
      assert.ok(stepColumns.includes('sort_order'))
      assert.equal(exceptionTable?.name, 'recurring_rule_occurrence_exceptions')
      assert.deepEqual(recurringInstanceColumns.slice(0, 3), ['id', 'recur_rule_id', 'date_key'])
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
        INSERT INTO tasks (title, recur_rule_id, instance_key, recur_instance_root, status)
        VALUES ('Daily check', 1, '2026-07-21T09:00', 1, '待处理')
      `,
      ).run()
      assert.throws(() =>
        db
          .prepare(
            `
            INSERT INTO tasks (title, recur_rule_id, instance_key, recur_instance_root, status)
            VALUES ('Daily check duplicate', 1, '2026-07-21T09:00', 1, '待处理')
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

test('task schema migrates same-day legacy time roots into one recurring parent', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'life-task-schema-legacy-recurring-'))
  try {
    const dbPath = path.join(dir, 'tasks.db')
    const db = new Database(dbPath)
    db.exec(`
      CREATE TABLE tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        priority TEXT DEFAULT 'mid',
        status TEXT NOT NULL DEFAULT '待处理',
        due_date TEXT,
        due_time TEXT,
        recur_rule_id INTEGER,
        instance_key TEXT,
        recur_instance_root INTEGER NOT NULL DEFAULT 0,
        parent_id INTEGER,
        progress INTEGER DEFAULT 0,
        associated_note_id INTEGER,
        is_completed INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE recurring_rules (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, frequency TEXT DEFAULT 'daily', start_date TEXT, start_time TEXT DEFAULT '09:00', end_condition TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP);
      CREATE TABLE translations (entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, locale TEXT NOT NULL, translation TEXT NOT NULL, PRIMARY KEY (entity_type, entity_id, locale));
      INSERT INTO recurring_rules (title, frequency, start_date, start_time) VALUES ('刷牙', 'daily', '2026-08-18', '09:00');
      INSERT INTO tasks (title, status, due_date, due_time, recur_rule_id, instance_key, recur_instance_root, is_completed) VALUES
        ('刷牙', '已关闭', '2026-08-18', '09:00:00', 1, '2026-08-18T09:00', 1, 1),
        ('刷牙', '已逾期', '2026-08-18', '23:59:59', 1, '2026-08-18T23:59', 1, 0);
    `)
    db.close()

    initializeUserDatabase(dir)
    const migratedDb = new Database(dbPath)
    try {
      assert.equal(migratedDb.prepare('SELECT COUNT(*) AS count FROM recurring_instances').get().count, 1)
      assert.equal(migratedDb.prepare('SELECT COUNT(*) AS count FROM tasks WHERE recur_instance_root = 1').get().count, 1)
      assert.deepEqual(
        migratedDb
          .prepare('SELECT instance_key, parent_id FROM tasks WHERE recur_instance_root = 0 ORDER BY instance_key')
          .all(),
        [
          { instance_key: '2026-08-18T09:00', parent_id: 3 },
          { instance_key: '2026-08-18T23:59', parent_id: 3 },
        ],
      )
    } finally {
      migratedDb.close()
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
