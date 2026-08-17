import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import Database from 'better-sqlite3'
import test from 'node:test'
import { createPdfInspectorWorkerSource } from '../electron/worker/pdfInspectorWorker.ts'
import { ensureReaderAnnotationSchema } from '../electron/readerAnnotationStore.ts'
import { ReaderOutlineService } from '../electron/readerOutlineService.ts'

function createDatabase() {
  const db = new Database(':memory:')
  db.pragma('journal_mode = WAL')
  db.exec(`
    CREATE TABLE books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL
    );
  `)
  db.prepare('INSERT INTO books (id, title) VALUES (?, ?)').run(1, 'Outline book')
  ensureReaderAnnotationSchema(db)
  return db
}

function createFakeWorker(bufferText) {
  const worker = new EventEmitter()
  worker.terminated = false
  worker.terminate = async () => {
    worker.terminated = true
    queueMicrotask(() => worker.emit('exit', 0))
    return 0
  }
  queueMicrotask(() => {
    if (worker.terminated) return
    worker.emit('message', {
      type: 'progress',
      data: { phase: 'classifying', progress: 0.2, message: 'classifying' },
    })
    if (bufferText.includes('tagged')) {
      worker.emit('message', {
        type: 'result',
        data: {
          source: 'tagged',
          pageCount: 4,
          entries: [
            {
              id: '1-tagged-part',
              title: 'Part I',
              level: 0,
              pathKey: '1-tagged-part',
              parentPathKey: null,
              pageNumber: 1,
              y: 0.1,
              destination: 'page:1',
              resolved: true,
              childrenCount: 1,
              analysisSource: 'tagged',
            },
            {
              id: '1-tagged-part/1-tagged-chapter',
              title: 'Chapter 1',
              level: 1,
              pathKey: '1-tagged-part/1-tagged-chapter',
              parentPathKey: '1-tagged-part',
              pageNumber: 2,
              y: 0.2,
              destination: 'page:2',
              resolved: true,
              childrenCount: 0,
              analysisSource: 'tagged',
            },
          ],
        },
      })
      return
    }
    if (bufferText.includes('inferred')) {
      worker.emit('message', {
        type: 'result',
        data: {
          source: 'inferred',
          pageCount: 3,
          entries: [
            {
              id: '1-inferred-heading',
              title: 'Inferred Heading',
              level: 0,
              pathKey: '1-inferred-heading',
              parentPathKey: null,
              pageNumber: 1,
              y: 0.3,
              destination: 'page:1',
              resolved: true,
              childrenCount: 0,
              analysisSource: 'inferred',
            },
          ],
        },
      })
      return
    }
    worker.emit('message', {
      type: 'result',
      data: {
        source: 'page-only',
        pageCount: 2,
        entries: [
          {
            id: '1-page-1',
            title: 'Page 1',
            level: 0,
            pathKey: '1-page-1',
            parentPathKey: null,
            pageNumber: 1,
            y: null,
            destination: 'page:1',
            resolved: true,
            childrenCount: 0,
            analysisSource: 'page-only',
          },
          {
            id: '2-page-2',
            title: 'Page 2',
            level: 0,
            pathKey: '2-page-2',
            parentPathKey: null,
            pageNumber: 2,
            y: null,
            destination: 'page:2',
            resolved: true,
            childrenCount: 0,
            analysisSource: 'page-only',
          },
        ],
      },
    })
  })
  return worker
}

function createErrorWorker(message = 'Invalid PDF structure') {
  const worker = new EventEmitter()
  worker.terminate = async () => 0
  queueMicrotask(() => worker.emit('message', { type: 'error', error: message }))
  return worker
}

test('worker source uses pdf-inspector classification and markdown extraction', () => {
  const source = createPdfInspectorWorkerSource()
  assert.match(source, /classifyPdfAsync/)
  assert.match(source, /extractStructureElements/)
  assert.match(source, /extractPagesMarkdownAsync/)
})

test('outline service falls back tagged -> inferred -> page-only and caches completed runs', async () => {
  const db = createDatabase()
  let workerCount = 0
  const service = new ReaderOutlineService({
    getDb: () => db,
    readFile: async (filePath) => Buffer.from(filePath, 'utf8'),
    createWorker: ({ buffer }) => {
      workerCount += 1
      return createFakeWorker(buffer.toString('utf8'))
    },
  })

  try {
    const tagged = await service.analyze({
      bookId: 1,
      source: 'pdf',
      filePath: 'tagged-sample',
      pageCount: 4,
    })
    assert.equal(tagged.status, 'ready')
    assert.equal(tagged.source, 'tagged')
    assert.equal(tagged.entries[0]?.analysisSource, 'tagged')
    assert.equal(workerCount, 1)

    const taggedCached = await service.analyze({
      bookId: 1,
      source: 'pdf',
      filePath: 'tagged-sample',
      pageCount: 4,
    })
    assert.equal(taggedCached.status, 'ready')
    assert.equal(taggedCached.cacheStatus, 'hit')
    assert.equal(taggedCached.source, 'tagged')
    assert.equal(taggedCached.entries[0]?.analysisSource, 'tagged')
    assert.equal(workerCount, 1)

    const inferred = await service.analyze({
      bookId: 1,
      source: 'pdf',
      filePath: 'inferred-sample',
      pageCount: 3,
    })
    assert.equal(inferred.status, 'ready')
    assert.equal(inferred.source, 'inferred')
    assert.equal(inferred.entries[0]?.analysisSource, 'inferred')

    const pageOnly = await service.analyze({
      bookId: 1,
      source: 'pdf',
      filePath: 'page-only-sample',
      pageCount: 2,
    })
    assert.equal(pageOnly.status, 'ready')
    assert.equal(pageOnly.source, 'page-only')
    assert.equal(pageOnly.entries[0]?.analysisSource, 'page-only')
  } finally {
    db.close()
  }
})

test('outline service exposes parser failures, marks pending locations, and allows retry', async () => {
  const db = createDatabase()
  let shouldFail = true
  let markedErrors = 0
  const service = new ReaderOutlineService({
    getDb: () => db,
    readFile: async () => Buffer.from('retryable-pdf', 'utf8'),
    createWorker: () =>
      shouldFail ? createErrorWorker() : createFakeWorker('tagged-retry'),
    markSelectionsError: () => {
      markedErrors += 1
    },
  })

  try {
    const failed = await service.analyze({
      bookId: 1,
      source: 'pdf',
      filePath: 'broken-sample',
      pageCount: 4,
    })
    assert.equal(failed.status, 'error')
    assert.match(failed.error, /Invalid PDF structure/)
    assert.equal(markedErrors, 1)

    shouldFail = false
    const retried = await service.analyze({
      bookId: 1,
      source: 'pdf',
      filePath: 'broken-sample',
      pageCount: 4,
    })
    assert.equal(retried.status, 'ready')
    assert.equal(retried.cacheStatus, 'miss')
    assert.equal(retried.source, 'tagged')
  } finally {
    db.close()
  }
})

test('outline service cancels stale tasks when a new outline request starts for the same book', async () => {
  const db = createDatabase()
  const workers = []
  const service = new ReaderOutlineService({
    getDb: () => db,
    readFile: async (filePath) => Buffer.from(filePath, 'utf8'),
    createWorker: ({ buffer }) => {
      const worker = createFakeWorker(buffer.toString('utf8'))
      workers.push(worker)
      return worker
    },
  })

  try {
    const first = service.analyze({
      bookId: 1,
      source: 'pdf',
      filePath: 'slow-tagged-a',
      pageCount: 4,
    })
    const second = service.analyze({
      bookId: 1,
      source: 'pdf',
      filePath: 'slow-tagged-b',
      pageCount: 4,
    })

    const [firstResult, secondResult] = await Promise.all([first, second])
    assert.equal(firstResult.status, 'cancelled')
    assert.equal(secondResult.status, 'ready')
    assert.equal(secondResult.source, 'tagged')
    assert.equal(workers[0]?.terminated, true)
    assert.equal(workers[1]?.terminated, false)
  } finally {
    db.close()
  }
})
