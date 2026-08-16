import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import test from 'node:test'
import {
  ensureLegacyHighlightCompatibility,
  migrateLegacyHighlights,
  readLegacyHighlightsCompat,
} from '../electron/readerAnnotationMigration.ts'
import { ensureReaderAnnotationSchema } from '../electron/readerAnnotationStore.ts'

function createDatabase() {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL
    );

    CREATE TABLE highlights (
      id TEXT PRIMARY KEY,
      book_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      annotation TEXT,
      anchor TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
    );
  `)
  db.prepare('INSERT INTO books (id, title) VALUES (?, ?)').run(1, 'Legacy book')
  ensureReaderAnnotationSchema(db)
  ensureLegacyHighlightCompatibility(db)
  return db
}

test('legacy highlights migrate into selections and remain idempotent', () => {
  const db = createDatabase()
  try {
    db.prepare(
      'INSERT INTO highlights (id, book_id, text, annotation, anchor, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(
      'hl-note',
      1,
      'Legacy note text',
      'Legacy note body',
      JSON.stringify({ chapterIndex: 2, blockOffset: 1, startOffset: 4, endOffset: 12 }),
      '2026-08-17T08:00:00.000Z',
    )
    db.prepare(
      'INSERT INTO highlights (id, book_id, text, annotation, anchor, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(
      'hl-highlight',
      1,
      'Legacy highlight text',
      '',
      JSON.stringify({ pageNumber: 3, areas: [{ x: 0.2, y: 0.4, width: 0.1, height: 0.02 }] }),
      '2026-08-17T08:01:00.000Z',
    )
    db.prepare(
      'INSERT INTO highlights (id, book_id, text, annotation, anchor, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(
      'hl-bad',
      1,
      'Broken anchor text',
      'Broken anchor body',
      'not-json',
      '2026-08-17T08:02:00.000Z',
    )

    migrateLegacyHighlights(db)
    migrateLegacyHighlights(db)

    const selectionRows = db
      .prepare('SELECT id, location_status, path_key FROM reader_selections ORDER BY id')
      .all() as Array<{ id: string; location_status: string; path_key: string | null }>
    assert.deepEqual(selectionRows, [
      { id: 'hl-bad', location_status: 'error', path_key: null },
      { id: 'hl-highlight', location_status: 'page-only', path_key: null },
      { id: 'hl-note', location_status: 'resolved', path_key: null },
    ])

    const itemRows = db
      .prepare('SELECT id, kind, body, style_token FROM reader_annotation_items ORDER BY id')
      .all() as Array<{ id: string; kind: string; body: string | null; style_token: string }>
    assert.deepEqual(itemRows, [
      { id: 'hl-bad', kind: 'note', body: 'Broken anchor body', style_token: 'reader.annotation.note' },
      { id: 'hl-highlight', kind: 'underline', body: null, style_token: 'reader.annotation.underline' },
      { id: 'hl-note', kind: 'note', body: 'Legacy note body', style_token: 'reader.annotation.note' },
    ])

    const compatRows = readLegacyHighlightsCompat(db, 1) as Array<{
      id: string
      text: string
      annotation: string
      anchor: string
    }>
    assert.equal(compatRows.length, 3)
    assert.equal(compatRows[0]?.id, 'hl-note')
    assert.equal(compatRows[0]?.annotation, 'Legacy note body')
    assert.equal(compatRows[1]?.id, 'hl-bad')
    assert.equal(compatRows[2]?.id, 'hl-highlight')
  } finally {
    db.close()
  }
})

test('legacy highlights remain readable through the compatibility view and old writes stay mirrored', () => {
  const db = createDatabase()
  try {
    db.prepare(
      'INSERT INTO highlights (id, book_id, text, annotation, anchor, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(
      'hl-sync',
      1,
      'Synced highlight',
      '',
      JSON.stringify({ pageNumber: 5, areas: [{ x: 0.1, y: 0.5, width: 0.2, height: 0.03 }] }),
      '2026-08-17T09:00:00.000Z',
    )

    const compatRows = db
      .prepare('SELECT id, text, annotation, anchor, created_at FROM reader_highlights_compat ORDER BY id')
      .all() as Array<{ id: string; text: string; annotation: string; anchor: string; created_at: string }>
    assert.deepEqual(compatRows, [
      {
        id: 'hl-sync',
        text: 'Synced highlight',
        annotation: '',
        anchor: JSON.stringify({ pageNumber: 5, areas: [{ x: 0.1, y: 0.5, width: 0.2, height: 0.03 }] }),
        created_at: '2026-08-17T09:00:00.000Z',
      },
    ])

    db.prepare('UPDATE highlights SET annotation = ?, anchor = ? WHERE id = ? AND book_id = ?').run(
      'Updated note',
      JSON.stringify({ chapterIndex: 7, blockOffset: 3, startOffset: 2, endOffset: 9 }),
      'hl-sync',
      1,
    )

    const mirroredItem = db
      .prepare('SELECT kind, body, style_token FROM reader_annotation_items WHERE id = ?')
      .get('hl-sync') as { kind: string; body: string | null; style_token: string }
    assert.deepEqual(mirroredItem, {
      kind: 'note',
      body: 'Updated note',
      style_token: 'reader.annotation.note',
    })

    db.prepare('DELETE FROM highlights WHERE id = ? AND book_id = ?').run('hl-sync', 1)
    assert.equal(
      (db.prepare('SELECT count(*) AS count FROM reader_selections').get() as { count: number }).count,
      0,
    )
    assert.equal(
      (db.prepare('SELECT count(*) AS count FROM reader_annotation_items').get() as { count: number }).count,
      0,
    )
  } finally {
    db.close()
  }
})
