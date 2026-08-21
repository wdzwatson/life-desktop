import test from 'node:test'
import assert from 'node:assert/strict'
import { performance } from 'node:perf_hooks'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { ensurePrivateSafeNotesFts } from '../electron/db/notesFts'

function createNotesDatabase() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT DEFAULT '',
      note_type TEXT DEFAULT 'markdown',
      is_private INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE VIRTUAL TABLE notes_fts USING fts5(
      title,
      content,
      content='notes',
      content_rowid='id'
    );
    CREATE TRIGGER notes_ai AFTER INSERT ON notes BEGIN
      INSERT INTO notes_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
    END;
    CREATE TRIGGER notes_ad AFTER DELETE ON notes BEGIN
      INSERT INTO notes_fts(notes_fts, rowid, title, content)
      VALUES('delete', old.id, old.title, old.content);
    END;
    CREATE TRIGGER notes_au AFTER UPDATE ON notes BEGIN
      INSERT INTO notes_fts(notes_fts, rowid, title, content)
      VALUES('delete', old.id, old.title, old.content);
      INSERT INTO notes_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
    END;
  `)
  return db
}

function matchingIds(db: Database.Database, query: string) {
  return (
    db.prepare('SELECT rowid AS id FROM notes_fts WHERE notes_fts MATCH ? ORDER BY rowid').all(query) as Array<{
      id: number
    }>
  ).map((row) => row.id)
}

test('private-safe notes FTS rebuild removes private rows and keeps transitions synchronized', () => {
  const db = createNotesDatabase()
  try {
    db.prepare('INSERT INTO notes (title, content, is_private) VALUES (?, ?, ?)').run(
      'Public planning',
      'shared roadmap',
      0,
    )
    db.prepare('INSERT INTO notes (title, content, is_private) VALUES (?, ?, ?)').run(
      'Classified title',
      'encrypted payload',
      1,
    )
    assert.deepEqual(matchingIds(db, 'Classified'), [2])

    assert.equal(ensurePrivateSafeNotesFts(db), true)
    assert.deepEqual(matchingIds(db, 'Classified'), [])
    assert.deepEqual(matchingIds(db, 'Public'), [1])
    assert.equal(ensurePrivateSafeNotesFts(db), false)

    db.prepare('UPDATE notes SET is_private = 1 WHERE id = 1').run()
    assert.deepEqual(matchingIds(db, 'Public'), [])
    db.prepare('UPDATE notes SET is_private = 0 WHERE id = 2').run()
    assert.deepEqual(matchingIds(db, 'Classified'), [2])

    db.prepare('INSERT INTO notes (title, content, is_private) VALUES (?, ?, 1)').run(
      'Future secret',
      'never index this',
    )
    assert.deepEqual(matchingIds(db, 'Future'), [])
  } finally {
    db.close()
  }
})

test('global search SQL excludes private notes before matching title or content', () => {
  const appSource = readFileSync(join(process.cwd(), 'src', 'App.tsx'), 'utf8')
  assert.match(
    appSource,
    /FROM notes WHERE COALESCE\(is_private, 0\) = 0 AND \(title LIKE \? OR content LIKE \?\)/,
  )
  assert.doesNotMatch(appSource, /title LIKE \? OR \(COALESCE\(is_private/)
})

test('LIKE search baseline stays below 300ms P95 for 10000 local notes', () => {
  const db = createNotesDatabase()
  try {
    const insert = db.prepare('INSERT INTO notes (title, content, is_private) VALUES (?, ?, 0)')
    db.transaction(() => {
      for (let index = 0; index < 10_000; index += 1) {
        insert.run(`Note ${index}`, index % 250 === 0 ? `needle 中文 ${index}` : `content ${index}`)
      }
    })()
    ensurePrivateSafeNotesFts(db)

    const query = db.prepare(
      `SELECT id, title, content, COUNT(*) OVER() AS total_count
       FROM notes
       WHERE COALESCE(is_private, 0) = 0 AND (title LIKE ? OR content LIKE ?)
       LIMIT 4`,
    )
    const durations = Array.from({ length: 20 }, () => {
      const startedAt = performance.now()
      query.all('%needle%', '%needle%')
      return performance.now() - startedAt
    }).sort((left, right) => left - right)
    const p95 = durations[Math.ceil(durations.length * 0.95) - 1]
    assert.ok(p95 < 300, `Expected P95 < 300ms, received ${p95.toFixed(2)}ms`)
  } finally {
    db.close()
  }
})
