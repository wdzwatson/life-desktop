import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildPdfRenderPriority,
  PdfPageRenderScheduler,
} from '../src/services/pdfPageRenderScheduler.ts'

test('PDF render priority starts at the target and follows reading direction', () => {
  assert.deepEqual(
    buildPdfRenderPriority({ pageCount: 20, targetPageIndex: 10, overscan: 3, direction: 1 }),
    [10, 11, 9, 12, 8, 13, 7],
  )
  assert.deepEqual(
    buildPdfRenderPriority({ pageCount: 20, targetPageIndex: 10, overscan: 2, direction: -1 }),
    [10, 9, 11, 8, 12],
  )
  assert.deepEqual(
    buildPdfRenderPriority({ pageCount: 3, targetPageIndex: 0, overscan: 4 }),
    [0, 1, 2],
  )
  assert.deepEqual(
    buildPdfRenderPriority({
      pageCount: 20,
      targetPageIndex: 10,
      visiblePageIndexes: [8, 10, 30, -1],
      overscan: 3,
    }),
    [10, 8, 11, 9, 12, 13, 7],
  )
})

test('PDF render priority supports an asymmetric forward-reading window', () => {
  assert.deepEqual(
    buildPdfRenderPriority({
      pageCount: 200,
      targetPageIndex: 98,
      overscan: 4,
      overscanBefore: 1,
      overscanAfter: 3,
      direction: 1,
    }),
    [98, 99, 100, 101, 97],
  )
  assert.deepEqual(
    buildPdfRenderPriority({
      pageCount: 5,
      targetPageIndex: 0,
      overscan: 4,
      overscanBefore: 1,
      overscanAfter: 3,
    }),
    [0, 1, 2, 3],
  )
})

test('PDF render scheduler preserves the concurrency cap when the target moves nearby', () => {
  const scheduler = new PdfPageRenderScheduler(2)
  scheduler.moveWindow({ pageCount: 100, targetPageIndex: 10, overscan: 4 })
  scheduler.markPageLoaded(10)

  const schedule = scheduler.moveWindow({
    pageCount: 100,
    targetPageIndex: 12,
    visiblePageIndexes: [11],
    overscan: 4,
    direction: 1,
  })

  assert.ok(schedule.admittedPageIndexes.includes(12))
  assert.ok(schedule.inFlightPageIndexes.includes(12))
  assert.ok(schedule.inFlightPageIndexes.length <= 2)
})

test('PDF render scheduler admits the target before neighbors and caps concurrency', () => {
  const scheduler = new PdfPageRenderScheduler(2)
  let schedule = scheduler.moveWindow({ pageCount: 100, targetPageIndex: 50, overscan: 4 })
  assert.deepEqual(schedule.admittedPageIndexes, [50])
  assert.deepEqual(schedule.inFlightPageIndexes, [50])

  schedule = scheduler.markPageLoaded(50)
  assert.deepEqual(schedule.admittedPageIndexes, [50, 51])
  assert.equal(schedule.inFlightPageIndexes.length, 2)

  schedule = scheduler.markPageFinished(50)
  assert.deepEqual(schedule.admittedPageIndexes, [50, 51, 49])
  assert.equal(schedule.inFlightPageIndexes.length, 2)
  scheduler.markPageFinished(51)
  schedule = scheduler.markPageFinished(49)
  assert.equal(schedule.inFlightPageIndexes.length, 2)
  assert.equal(new Set(schedule.admittedPageIndexes).size, schedule.admittedPageIndexes.length)
})

test('PDF render scheduler drops stale work while retaining completed overlap', () => {
  const scheduler = new PdfPageRenderScheduler(2)
  scheduler.moveWindow({ pageCount: 100, targetPageIndex: 10, overscan: 4 })
  scheduler.markPageLoaded(10)
  scheduler.markPageFinished(10)
  scheduler.markPageFinished(11)

  const nearby = scheduler.moveWindow({
    pageCount: 100,
    targetPageIndex: 11,
    overscan: 4,
    direction: 1,
  })
  assert.ok(nearby.admittedPageIndexes.includes(10))
  assert.ok(nearby.admittedPageIndexes.includes(11))

  const distant = scheduler.moveWindow({
    pageCount: 100,
    targetPageIndex: 80,
    overscan: 4,
    direction: 1,
  })
  assert.deepEqual(distant.admittedPageIndexes, [80])
  assert.deepEqual(distant.inFlightPageIndexes, [80])
  assert.ok(!distant.pendingPageIndexes.includes(10))
})

test('PDF render scheduler releases a failed page without blocking the queue', () => {
  const scheduler = new PdfPageRenderScheduler(2)
  scheduler.moveWindow({ pageCount: 8, targetPageIndex: 4, overscan: 2 })
  scheduler.markPageLoaded(4)
  const schedule = scheduler.markPageFinished(4, false)

  assert.ok(!schedule.admittedPageIndexes.includes(4))
  assert.equal(schedule.inFlightPageIndexes.length, 2)
  assert.ok(schedule.admittedPageIndexes.includes(5))
})

test('PDF render scheduler keeps only completed pages retained by the cache policy', () => {
  const scheduler = new PdfPageRenderScheduler(2)
  scheduler.moveWindow({ pageCount: 100, targetPageIndex: 10, overscan: 1 })
  scheduler.markPageLoaded(10)
  scheduler.markPageFinished(10)
  scheduler.markPageFinished(11)
  scheduler.setRetainedPageIndexes([10, 11])

  let schedule = scheduler.moveWindow({ pageCount: 100, targetPageIndex: 80, overscan: 1 })
  assert.ok(schedule.admittedPageIndexes.includes(10))
  assert.ok(schedule.admittedPageIndexes.includes(11))
  assert.ok(schedule.admittedPageIndexes.includes(80))

  schedule = scheduler.moveWindow({ pageCount: 100, targetPageIndex: 10, overscan: 1 })
  assert.ok(schedule.admittedPageIndexes.includes(10))
  assert.ok(!schedule.inFlightPageIndexes.includes(10))

  schedule = scheduler.setRetainedPageIndexes([11])
  assert.ok(!schedule.admittedPageIndexes.includes(10))
  assert.ok(schedule.admittedPageIndexes.includes(11))
})

test('PDF render scheduler unmounts an evicted neighbor without rerendering it in a loop', () => {
  const scheduler = new PdfPageRenderScheduler(2)
  scheduler.moveWindow({ pageCount: 100, targetPageIndex: 10, overscan: 1 })
  scheduler.markPageLoaded(10)
  scheduler.markPageFinished(10)
  scheduler.markPageFinished(11)

  let schedule = scheduler.setRetainedPageIndexes([10])
  assert.ok(!schedule.admittedPageIndexes.includes(11))
  assert.ok(!schedule.pendingPageIndexes.includes(11))

  schedule = scheduler.moveWindow({
    pageCount: 100,
    targetPageIndex: 11,
    visiblePageIndexes: [11],
    overscan: 1,
  })
  assert.ok(schedule.admittedPageIndexes.includes(11))
  assert.ok(schedule.inFlightPageIndexes.includes(11))
})
