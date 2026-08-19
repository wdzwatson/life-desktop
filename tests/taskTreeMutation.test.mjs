import assert from 'node:assert/strict'
import test from 'node:test'
import Database from 'better-sqlite3'
import {
  buildCloseTaskTreeMutation,
  buildAggregateTaskMutation,
  buildCompleteTaskTreeMutation,
  buildReopenTaskTreeMutation,
  buildResolveTaskTreeMutation,
} from '../src/taskTreeMutation.ts'

const createTaskTree = () => {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE tasks (
      id INTEGER PRIMARY KEY,
      parent_id INTEGER,
      status TEXT NOT NULL DEFAULT '待处理',
      closed_from_status TEXT,
      requires_review INTEGER NOT NULL DEFAULT 0,
      start_date TEXT,
      start_time TEXT,
      due_date TEXT,
      due_time TEXT,
      progress INTEGER DEFAULT 0,
      is_completed INTEGER DEFAULT 0
    );
    INSERT INTO tasks (id, parent_id, requires_review) VALUES
      (1, NULL, 1),
      (2, 1, 1),
      (3, 1, 0),
      (4, 2, 1),
      (5, NULL, 0);
  `)
  return db
}

const runMutation = (db, mutation) => db.prepare(mutation.sql).run(...mutation.params)

test('completing a parent processes its entire descendant tree once', () => {
  const db = createTaskTree()
  try {
    runMutation(db, buildCompleteTaskTreeMutation(1))
    assert.deepEqual(
      db.prepare('SELECT id, status, is_completed, progress FROM tasks ORDER BY id').all(),
      [
        { id: 1, status: '待审核', is_completed: 1, progress: 100 },
        { id: 2, status: '待审核', is_completed: 1, progress: 100 },
        { id: 3, status: '待审核', is_completed: 1, progress: 100 },
        { id: 4, status: '待审核', is_completed: 1, progress: 100 },
        { id: 5, status: '待处理', is_completed: 0, progress: 0 },
      ],
    )
  } finally {
    db.close()
  }
})

test('a parent without review closes descendants even when a child requires review', () => {
  const db = createTaskTree()
  try {
    db.prepare('UPDATE tasks SET requires_review = 0 WHERE id = 1').run()
    runMutation(db, buildCompleteTaskTreeMutation(1))
    assert.deepEqual(
      db.prepare('SELECT id, status FROM tasks WHERE id <= 4 ORDER BY id').all(),
      [1, 2, 3, 4].map((id) => ({ id, status: '已关闭' })),
    )
  } finally {
    db.close()
  }
})

test('completing a parent leaves already completed descendants unchanged', () => {
  const db = createTaskTree()
  try {
    db.prepare("UPDATE tasks SET status = '已关闭', is_completed = 1, progress = 100 WHERE id = 2").run()
    runMutation(db, buildCompleteTaskTreeMutation(1))
    assert.deepEqual(
      db.prepare('SELECT id, status, is_completed, progress FROM tasks WHERE id <= 4 ORDER BY id').all(),
      [
        { id: 1, status: '待审核', is_completed: 1, progress: 100 },
        { id: 2, status: '已关闭', is_completed: 1, progress: 100 },
        { id: 3, status: '待审核', is_completed: 1, progress: 100 },
        { id: 4, status: '待审核', is_completed: 1, progress: 100 },
      ],
    )
  } finally {
    db.close()
  }
})

test('approving a parent closes every descendant without separate reviews', () => {
  const db = createTaskTree()
  try {
    runMutation(db, buildCompleteTaskTreeMutation(1))
    runMutation(db, buildResolveTaskTreeMutation(1, '已关闭'))
    assert.deepEqual(
      db.prepare('SELECT id, status FROM tasks WHERE id <= 4 ORDER BY id').all(),
      [1, 2, 3, 4].map((id) => ({ id, status: '已关闭' })),
    )
  } finally {
    db.close()
  }
})

test('rejecting or reopening a parent reopens descendants according to their own dates', () => {
  const db = createTaskTree()
  try {
    db.exec(`
      UPDATE tasks SET status = '待审核', is_completed = 1, progress = 100 WHERE id <= 4;
      UPDATE tasks SET start_date = '2026-08-14', start_time = '09:00:00' WHERE id = 2;
      UPDATE tasks SET due_date = '2026-08-12', due_time = '23:59:59' WHERE id = 3;
    `)
    runMutation(db, buildReopenTaskTreeMutation(1, new Date(2026, 7, 13, 12, 0, 0)))
    assert.deepEqual(
      db.prepare('SELECT id, status, is_completed, progress FROM tasks WHERE id <= 4 ORDER BY id').all(),
      [
        { id: 1, status: '进行中', is_completed: 0, progress: 0 },
        { id: 2, status: '待处理', is_completed: 0, progress: 0 },
        { id: 3, status: '已逾期', is_completed: 0, progress: 0 },
        { id: 4, status: '进行中', is_completed: 0, progress: 0 },
      ],
    )
  } finally {
    db.close()
  }
})

test('explicitly closing a parent preserves and closes the complete tree', () => {
  const db = createTaskTree()
  try {
    runMutation(db, buildCloseTaskTreeMutation(1))
    assert.deepEqual(
      db
        .prepare('SELECT id, status, closed_from_status FROM tasks WHERE id <= 4 ORDER BY id')
        .all(),
      [1, 2, 3, 4].map((id) => ({
        id,
        status: '已关闭',
        closed_from_status: '待处理',
      })),
    )
  } finally {
    db.close()
  }
})

test('aggregating the last closed child closes the parent without crossing sibling instances', () => {
  const db = createTaskTree()
  try {
    db.prepare("UPDATE tasks SET status = '已关闭', is_completed = 1, progress = 100 WHERE id IN (2, 3)").run()
    runMutation(db, buildAggregateTaskMutation(1, new Date(2026, 7, 18, 12, 0)))
    assert.deepEqual(db.prepare('SELECT status, is_completed, progress FROM tasks WHERE id = 1').get(), {
      status: '已关闭',
      is_completed: 1,
      progress: 100,
    })
  } finally {
    db.close()
  }
})

test('aggregating completed children keeps a review parent in awaiting review', () => {
  const db = createTaskTree()
  try {
    db.prepare("UPDATE tasks SET status = '已关闭', is_completed = 1, progress = 100 WHERE id = 2").run()
    db.prepare("UPDATE tasks SET status = '待审核', is_completed = 1, progress = 100 WHERE id = 3").run()
    runMutation(db, buildAggregateTaskMutation(1, new Date(2026, 7, 18, 12, 0)))
    assert.deepEqual(db.prepare('SELECT status, is_completed, progress FROM tasks WHERE id = 1').get(), {
      status: '待审核',
      is_completed: 1,
      progress: 100,
    })
  } finally {
    db.close()
  }
})
