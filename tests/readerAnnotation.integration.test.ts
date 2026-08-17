import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import test from 'node:test'
import AdmZip from 'adm-zip'
import { marked } from 'marked'
import { buildNoteExportDocx } from '../electron/noteDocxExport.ts'
import { buildNoteExportHtml } from '../electron/noteExport.ts'
import {
  ensureLegacyHighlightCompatibility,
  migrateLegacyHighlights,
} from '../electron/readerAnnotationMigration.ts'
import { ReaderAnnotationService } from '../electron/readerAnnotationService.ts'
import {
  ensureReaderAnnotationSchema,
  replaceOutlineNodesForRun,
  upsertOutlineRun,
} from '../electron/readerAnnotationStore.ts'
import { ReaderSelectionService } from '../electron/readerSelectionService.ts'
import {
  buildExportAnnotationRecords,
  decorateReaderAnnotationExportHtml,
  mergeReaderAnnotationsManagedMarkdown,
  renderReaderAnnotationsManagedMarkdown,
  type ReaderAnnotationMarkdownOptions,
} from '../src/services/readerAnnotationSerializer.ts'

const timestamp = '2026-08-17T08:00:00.000Z'
const markdownOptions: ReaderAnnotationMarkdownOptions = {
  bookId: 1,
  title: 'AT-15 Reader Notes',
  author: 'Acceptance Suite',
  progress: 64,
  syncedAt: timestamp,
  locale: 'en-US',
  labels: {
    author: 'Author',
    syncTime: 'Last sync',
    progress: 'Progress',
    annotationsHeading: 'Annotations',
    unknownChapter: 'Unrecognized chapter',
    fullChapterPath: 'Full chapter path',
    type: 'Type',
    originalText: 'Original text',
    body: 'Content',
    pages: 'Pages',
    createdAt: 'Created',
    deepLink: 'Source',
    notAvailable: 'Not available',
    empty: 'No annotations',
    kinds: { translation: 'Translation', underline: 'Underline', note: 'Note' },
  },
}

function createDatabase() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE books (id INTEGER PRIMARY KEY, title TEXT NOT NULL);
    CREATE TABLE highlights (
      id TEXT PRIMARY KEY,
      book_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      annotation TEXT,
      anchor TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
    );
    INSERT INTO books (id, title) VALUES (1, 'AT-15 Book');
  `)
  ensureReaderAnnotationSchema(db)
  ensureLegacyHighlightCompatibility(db)
  return db
}

const crossPageAnchor = {
  version: 2 as const,
  source: 'pdf' as const,
  selectedText: 'Cross-page source text',
  positions: [
    { source: 'pdf' as const, pageNumber: 8, x: 0.1, y: 0.2, width: 0.7, height: 0.04 },
    { source: 'pdf' as const, pageNumber: 9, x: 0.1, y: 0.05, width: 0.4, height: 0.04 },
  ],
  outlinePath: null,
}

test('legacy migration remains count-stable and idempotent with new reader tables', () => {
  const db = createDatabase()
  try {
    const insert = db.prepare(
      'INSERT INTO highlights (id, book_id, text, annotation, anchor, created_at) VALUES (?, 1, ?, ?, ?, ?)',
    )
    insert.run(
      'legacy-underline',
      'Legacy underline',
      '',
      JSON.stringify({ pageNumber: 2, areas: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.02 }] }),
      timestamp,
    )
    insert.run(
      'legacy-note',
      'Legacy note source',
      'Legacy handwritten note',
      JSON.stringify({ chapterIndex: 3, blockOffset: 1, startOffset: 2, endOffset: 8 }),
      timestamp,
    )

    migrateLegacyHighlights(db)
    migrateLegacyHighlights(db)
    const counts = db.prepare(`
      SELECT
        (SELECT count(*) FROM highlights) AS legacy_count,
        (SELECT count(*) FROM reader_selections) AS selection_count,
        (SELECT count(*) FROM reader_annotation_items) AS item_count
    `).get() as { legacy_count: number; selection_count: number; item_count: number }
    assert.deepEqual(counts, { legacy_count: 2, selection_count: 2, item_count: 2 })
    assert.deepEqual(
      db.prepare('SELECT kind FROM reader_annotation_items ORDER BY id').all(),
      [{ kind: 'note' }, { kind: 'underline' }],
    )
  } finally {
    db.close()
  }
})

test('an eight-level outline resolves a pending cross-page selection to its full source path', () => {
  const db = createDatabase()
  try {
    const annotations = new ReaderAnnotationService({ getDb: () => db })
    annotations.saveBookAnnotation({
      bookId: 1,
      itemId: 'deep-underline',
      selectionId: 'deep-selection',
      kind: 'underline',
      text: crossPageAnchor.selectedText,
      anchor: crossPageAnchor,
      locationStatus: 'pending',
    })
    upsertOutlineRun(db, {
      id: 'deep-run',
      bookId: 1,
      source: 'pdf',
      parserVersion: 'at15',
      contentHash: 'deep-hash',
      pageCount: 9,
      state: 'completed',
      progress: 1,
      completedAt: timestamp,
    })
    replaceOutlineNodesForRun(
      db,
      'deep-run',
      Array.from({ length: 8 }, (_, index) => ({
        id: `deep-${index + 1}`,
        bookId: 1,
        runId: 'deep-run',
        source: 'pdf' as const,
        parentId: index === 0 ? null : `deep-${index}`,
        title: `Level ${index + 1}`,
        level: index,
        pathKey: Array.from({ length: index + 1 }, (__, part) => `level-${part + 1}`).join('/'),
        sortOrder: index,
        pageStart: index + 1,
        pageEnd: index + 1,
        yStart: 0.1,
        yEnd: 0.9,
        locator: { analysisSource: 'native' },
        confidence: 1,
      })),
    )

    const result = new ReaderSelectionService({ getDb: () => db }).reconcileBookSelections(1, 'pdf')
    assert.deepEqual(result, { bookId: 1, resolved: 1, pageOnly: 0, error: 0, skipped: 0 })
    const row = annotations.listBookAnnotations(1)[0]
    assert.ok(row)
    assert.equal(row.location_status, 'resolved')
    assert.deepEqual(buildExportAnnotationRecords([row])[0]?.outlinePathTitles, [
      'Level 1',
      'Level 2',
      'Level 3',
      'Level 4',
      'Level 5',
      'Level 6',
      'Level 7',
      'Level 8',
    ])
    assert.deepEqual(buildExportAnnotationRecords([row])[0]?.pageNumbers, [8, 9])
  } finally {
    db.close()
  }
})

test('fallback locations stay editable and all three kinds survive Markdown, HTML, DOCX, and Notes sync', async () => {
  const db = createDatabase()
  try {
    const service = new ReaderAnnotationService({ getDb: () => db })
    const common = {
      bookId: 1,
      selectionId: 'fallback-selection',
      text: crossPageAnchor.selectedText,
      anchor: crossPageAnchor,
      locationStatus: 'page-only' as const,
    }
    service.saveBookAnnotation({ ...common, itemId: 'export-underline', kind: 'underline' })
    service.saveBookAnnotation({
      ...common,
      itemId: 'export-translation',
      kind: 'translation',
      body: 'Translated cross-page text',
      translationLanguage: 'en-US',
    })
    service.saveBookAnnotation({
      bookId: 1,
      selectionId: 'error-selection',
      itemId: 'export-note',
      kind: 'note',
      text: 'Recoverable source',
      body: 'Initial note',
      anchor: { ...crossPageAnchor, selectedText: 'Recoverable source' },
      locationStatus: 'error',
    })
    service.saveBookAnnotation({
      bookId: 1,
      selectionId: 'error-selection',
      itemId: 'export-note',
      kind: 'note',
      text: 'Recoverable source',
      body: 'Edited after parser failure',
      anchor: { ...crossPageAnchor, selectedText: 'Recoverable source' },
    })

    const rows = service.listBookAnnotations(1)
    assert.deepEqual(new Set(rows.map((row) => row.location_status)), new Set(['page-only', 'error']))
    assert.equal(rows.find((row) => row.id === 'export-note')?.annotation, 'Edited after parser failure')
    const records = buildExportAnnotationRecords(rows)
    const markdown = renderReaderAnnotationsManagedMarkdown(records, markdownOptions)
    assert.match(markdown, /Translation/)
    assert.match(markdown, /Underline/)
    assert.match(markdown, /Edited after parser failure/)
    assert.match(markdown, /Pages\*\*: 8, 9/)

    const decoratedHtml = decorateReaderAnnotationExportHtml(marked.parse(markdown) as string)
    const html = buildNoteExportHtml(markdownOptions.title, decoratedHtml)
    for (const kind of ['translation', 'underline', 'note']) {
      assert.match(html, new RegExp(`data-reader-annotation-kind="${kind}"`))
      assert.match(html, new RegExp(`is-${kind}`))
    }

    const docx = new AdmZip(await buildNoteExportDocx(markdownOptions.title, html))
    const documentXml = docx.readAsText('word/document.xml')
    assert.match(documentXml, /T Translation/)
    assert.match(documentXml, /U Underline/)
    assert.match(documentXml, /N Note/)
    assert.match(documentXml, /Edited after parser failure/)

    const initialNotes = `Manual before\n\n${markdown}\n\nManual after`
    service.deleteBookAnnotation({ bookId: 1, itemId: 'export-underline' })
    const nextManaged = renderReaderAnnotationsManagedMarkdown(
      buildExportAnnotationRecords(service.listBookAnnotations(1)),
      markdownOptions,
    )
    const synchronized = mergeReaderAnnotationsManagedMarkdown(initialNotes, nextManaged, 1)
    assert.equal(mergeReaderAnnotationsManagedMarkdown(synchronized, nextManaged, 1), synchronized)
    assert.match(synchronized, /^Manual before/)
    assert.match(synchronized, /Manual after$/)
    assert.doesNotMatch(synchronized, /life-os:reader-annotation:export-underline:start/)
    assert.match(synchronized, /life-os:reader-annotation:export-note:start/)
  } finally {
    db.close()
  }
})
