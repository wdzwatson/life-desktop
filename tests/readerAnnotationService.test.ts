import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import test from 'node:test'
import { createReaderAnnotationHandlers } from '../electron/readerAnnotationIpc.ts'
import { ReaderAnnotationService } from '../electron/readerAnnotationService.ts'
import { ensureReaderAnnotationSchema } from '../electron/readerAnnotationStore.ts'

const anchor = {
  version: 2 as const,
  source: 'pdf' as const,
  selectedText: 'Selected text',
  positions: [{ source: 'pdf' as const, pageNumber: 3, x: 0.2, y: 0.4 }],
  outlinePath: null,
}

function createService() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL
    );
    INSERT INTO books (id, title) VALUES (1, 'Sample');
  `)
  ensureReaderAnnotationSchema(db)
  return { db, service: new ReaderAnnotationService({ getDb: () => db }) }
}

test('annotation service keeps three item kinds independent under one selection', () => {
  const { db, service } = createService()
  try {
    const underline = service.saveBookAnnotation({
      bookId: 1,
      selectionId: 'selection-1',
      kind: 'underline',
      text: 'Selected text',
      anchor,
    })
    const firstNote = service.saveBookAnnotation({
      bookId: 1,
      selectionId: underline.selectionId,
      kind: 'note',
      text: 'Selected text',
      body: 'First note',
      anchor,
    })
    const secondNote = service.saveBookAnnotation({
      bookId: 1,
      selectionId: underline.selectionId,
      kind: 'note',
      text: 'Selected text',
      body: 'Second note',
      anchor,
    })
    const chineseTranslation = service.saveBookAnnotation({
      bookId: 1,
      selectionId: underline.selectionId,
      kind: 'translation',
      text: 'Selected text',
      body: '初始翻译',
      translationLanguage: 'zh-CN',
      anchor,
    })
    const updatedChineseTranslation = service.saveBookAnnotation({
      bookId: 1,
      selectionId: underline.selectionId,
      kind: 'translation',
      text: 'Selected text',
      body: '更新后的翻译',
      translationLanguage: 'zh-CN',
      anchor,
    })
    const englishTranslation = service.saveBookAnnotation({
      bookId: 1,
      selectionId: underline.selectionId,
      kind: 'translation',
      text: 'Selected text',
      body: 'Translated text',
      translationLanguage: 'en-US',
      anchor,
    })

    assert.notEqual(firstNote.itemId, secondNote.itemId)
    assert.equal(updatedChineseTranslation.itemId, chineseTranslation.itemId)
    assert.notEqual(englishTranslation.itemId, chineseTranslation.itemId)

    const rows = service.listBookAnnotations(1)
    assert.equal(rows.length, 5)
    assert.deepEqual(rows.map((row) => row.kind).sort(), [
      'note',
      'note',
      'translation',
      'translation',
      'underline',
    ])
    assert.equal(
      rows.find((row) => row.id === chineseTranslation.itemId)?.annotation,
      '更新后的翻译',
    )

    const deletedNote = service.deleteBookAnnotation({ bookId: 1, itemId: firstNote.itemId })
    assert.equal(deletedNote.selectionDeleted, false)
    assert.equal(service.listBookAnnotations(1).length, 4)
    assert.equal(
      (db.prepare('SELECT count(*) AS count FROM reader_selections').get() as { count: number })
        .count,
      1,
    )

    for (const row of service.listBookAnnotations(1).slice(0, -1)) {
      assert.equal(
        service.deleteBookAnnotation({ bookId: 1, itemId: row.id }).selectionDeleted,
        false,
      )
    }
    const lastRow = service.listBookAnnotations(1)[0]
    assert.ok(lastRow)
    assert.equal(
      service.deleteBookAnnotation({ bookId: 1, itemId: lastRow.id }).selectionDeleted,
      true,
    )
    assert.equal(
      (db.prepare('SELECT count(*) AS count FROM reader_selections').get() as { count: number })
        .count,
      0,
    )
  } finally {
    db.close()
  }
})

test('annotation service rejects cross-kind edits and missing kind-specific fields', () => {
  const { db, service } = createService()
  try {
    const note = service.saveBookAnnotation({
      bookId: 1,
      selectionId: 'selection-1',
      kind: 'note',
      text: 'Selected text',
      body: 'A note',
      anchor,
    })

    assert.throws(
      () =>
        service.saveBookAnnotation({
          bookId: 1,
          selectionId: note.selectionId,
          itemId: note.itemId,
          kind: 'translation',
          text: 'Selected text',
          body: '翻译',
          translationLanguage: 'zh-CN',
          anchor,
        }),
      /kind cannot be changed/,
    )
    assert.throws(
      () =>
        service.saveBookAnnotation({
          bookId: 1,
          selectionId: 'another-selection',
          itemId: note.itemId,
          kind: 'note',
          text: 'Selected text',
          body: 'Updated note',
          anchor,
        }),
      /another selection/,
    )
    assert.throws(
      () =>
        service.saveBookAnnotation({
          bookId: 1,
          kind: 'note',
          text: 'Selected text',
          body: '   ',
          anchor,
        }),
      /require body text/,
    )
    assert.throws(
      () =>
        service.saveBookAnnotation({
          bookId: 1,
          kind: 'translation',
          text: 'Selected text',
          body: '翻译',
          anchor,
        }),
      /translationLanguage/,
    )
  } finally {
    db.close()
  }
})

test('annotation IPC rejects unsupported location status before calling the service', async () => {
  let saveCalls = 0
  const handlers = createReaderAnnotationHandlers({
    getService: () =>
      ({
        saveBookAnnotation: () => {
          saveCalls += 1
          throw new Error('should not run')
        },
      }) as ReaderAnnotationService,
  })

  await assert.rejects(
    () =>
      handlers['reader:annotation:save'](
        {},
        {
          bookId: 1,
          kind: 'underline',
          text: 'Selected text',
          anchor,
          locationStatus: 'finished',
        },
      ),
    /Invalid annotation location status/,
  )
  assert.equal(saveCalls, 0)
})
