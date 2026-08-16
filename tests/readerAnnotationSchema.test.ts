import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import test from 'node:test'
import {
  ensureReaderAnnotationSchema,
  listReaderAnnotationItemsByBook,
  listReaderSelectionsByBook,
  replaceOutlineNodesForRun,
  saveReaderAnnotationItem,
  saveReaderSelection,
  upsertOutlineRun,
} from '../electron/readerAnnotationStore.ts'

function createDatabase() {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL
    );
  `)
  db.prepare('INSERT INTO books (id, title) VALUES (?, ?)').run(1, 'Sample')
  ensureReaderAnnotationSchema(db)
  ensureReaderAnnotationSchema(db)
  return db
}

test('reader annotation schema is idempotent and creates indexed tables', () => {
  const db = createDatabase()
  try {
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND (name LIKE 'book_outline_%' OR name LIKE 'reader_%') ORDER BY name",
      )
      .all() as Array<{ name: string }>
    assert.deepEqual(tables.map((row) => row.name), [
      'book_outline_nodes',
      'book_outline_runs',
      'reader_annotation_items',
      'reader_selections',
    ])

    const indexes = db.prepare("PRAGMA index_list('reader_selections')").all() as Array<{ name: string }>
    assert.ok(indexes.some((row) => row.name === 'reader_selections_book_status_path_idx'))
  } finally {
    db.close()
  }
})

test('outline runs keep one record and outline nodes preserve deep parent chains', () => {
  const db = createDatabase()
  try {
    const firstRunId = upsertOutlineRun(db, {
      id: 'run-1',
      bookId: 1,
      source: 'pdf',
      parserVersion: 'pdfjs-1',
      contentHash: 'hash-1',
      pageCount: 12,
      state: 'running',
      progress: 0.4,
      startedAt: '2026-08-17T10:00:00.000Z',
    })
    const secondRunId = upsertOutlineRun(db, {
      id: 'run-2',
      bookId: 1,
      source: 'pdf',
      parserVersion: 'pdfjs-1',
      contentHash: 'hash-1',
      pageCount: 12,
      state: 'completed',
      progress: 1,
      completedAt: '2026-08-17T10:01:00.000Z',
    })

    assert.equal(firstRunId, 'run-1')
    assert.equal(secondRunId, 'run-1')
    const runRows = db.prepare('SELECT id, state, progress FROM book_outline_runs').all() as Array<{
      id: string
      state: string
      progress: number
    }>
    assert.deepEqual(runRows, [{ id: 'run-1', state: 'completed', progress: 1 }])

    replaceOutlineNodesForRun(db, 'run-1', [
      {
        id: 'node-1',
        bookId: 1,
        runId: 'run-1',
        source: 'pdf',
        title: 'Part I',
        level: 0,
        pathKey: 'part-i',
        sortOrder: 0,
        pageStart: 1,
        pageEnd: 10,
        yStart: 0.1,
        yEnd: 0.9,
      },
      {
        id: 'node-2',
        bookId: 1,
        runId: 'run-1',
        source: 'pdf',
        parentId: 'node-1',
        title: 'Chapter 1',
        level: 1,
        pathKey: 'part-i>chapter-1',
        sortOrder: 0,
        pageStart: 2,
        pageEnd: 4,
        yStart: 0.2,
        yEnd: 0.8,
      },
      {
        id: 'node-3',
        bookId: 1,
        runId: 'run-1',
        source: 'pdf',
        parentId: 'node-2',
        title: 'Section 1.1',
        level: 2,
        pathKey: 'part-i>chapter-1>section-1-1',
        sortOrder: 0,
        pageStart: 3,
        pageEnd: 3,
        yStart: 0.3,
        yEnd: 0.6,
      },
    ])

    const nodeRows = db
      .prepare('SELECT id, parent_id, level, path_key FROM book_outline_nodes ORDER BY level, id')
      .all() as Array<{ id: string; parent_id: string | null; level: number; path_key: string }>
    assert.deepEqual(nodeRows, [
      { id: 'node-1', parent_id: null, level: 0, path_key: 'part-i' },
      { id: 'node-2', parent_id: 'node-1', level: 1, path_key: 'part-i>chapter-1' },
      { id: 'node-3', parent_id: 'node-2', level: 2, path_key: 'part-i>chapter-1>section-1-1' },
    ])

    db.prepare('DELETE FROM books WHERE id = ?').run(1)
    assert.equal((db.prepare('SELECT count(*) AS count FROM book_outline_runs').get() as { count: number }).count, 0)
    assert.equal((db.prepare('SELECT count(*) AS count FROM book_outline_nodes').get() as { count: number }).count, 0)
  } finally {
    db.close()
  }
})

test('reader selections can hold translation, underline, and note items under one selection', () => {
  const db = createDatabase()
  try {
    const selection = saveReaderSelection(db, {
      id: 'sel-1',
      bookId: 1,
      source: 'pdf',
      selectedText: 'Chapter text',
      anchor: {
        version: 2,
        source: 'pdf',
        selectedText: 'Chapter text',
        positions: [
          { source: 'pdf', pageNumber: 2, x: 0.2, y: 0.3 },
          { source: 'pdf', pageNumber: 2, x: 0.4, y: 0.5 },
        ],
        outlinePath: {
          source: 'pdf',
          pathKey: 'part-i>chapter-1',
          nodes: [
            { id: 'part-i', title: 'Part I', level: 0, pathKey: 'part-i' },
            { id: 'chapter-1', title: 'Chapter 1', level: 1, pathKey: 'part-i>chapter-1' },
          ],
        },
      },
      locationStatus: 'resolved',
      createdAt: '2026-08-17T10:00:00.000Z',
      updatedAt: '2026-08-17T10:00:00.000Z',
    })

    saveReaderAnnotationItem(db, {
      id: 'ann-translation',
      bookId: 1,
      selectionId: selection.id,
      kind: 'translation',
      text: 'Chapter text',
      body: '章节文本',
      translationLanguage: 'zh-CN',
      anchor: selection.anchor,
      locationStatus: 'resolved',
      createdAt: '2026-08-17T10:00:01.000Z',
      updatedAt: '2026-08-17T10:00:01.000Z',
    })
    saveReaderAnnotationItem(db, {
      id: 'ann-underline',
      bookId: 1,
      selectionId: selection.id,
      kind: 'underline',
      text: 'Chapter text',
      anchor: selection.anchor,
      locationStatus: 'resolved',
      createdAt: '2026-08-17T10:00:02.000Z',
      updatedAt: '2026-08-17T10:00:02.000Z',
    })
    saveReaderAnnotationItem(db, {
      id: 'ann-note',
      bookId: 1,
      selectionId: selection.id,
      kind: 'note',
      text: 'Chapter text',
      body: '这里是批注',
      anchor: selection.anchor,
      locationStatus: 'resolved',
      createdAt: '2026-08-17T10:00:03.000Z',
      updatedAt: '2026-08-17T10:00:03.000Z',
    })

    const selections = listReaderSelectionsByBook(db, 1, {
      locationStatus: 'resolved',
      pathKey: 'part-i>chapter-1',
    })
    assert.equal(selections.length, 1)
    assert.equal(selections[0]?.outlinePath?.pathKey, 'part-i>chapter-1')

    const items = listReaderAnnotationItemsByBook(db, 1)
    assert.deepEqual(
      items.map((row) => ({ id: row.id, kind: row.kind, styleToken: row.style_token })),
      [
        { id: 'ann-translation', kind: 'translation', styleToken: 'reader.annotation.translation' },
        { id: 'ann-underline', kind: 'underline', styleToken: 'reader.annotation.underline' },
        { id: 'ann-note', kind: 'note', styleToken: 'reader.annotation.note' },
      ],
    )
  } finally {
    db.close()
  }
})
