import assert from 'node:assert/strict'
import test from 'node:test'
import {
  estimatePdfCanvasBytes,
  PdfPageRenderCache,
} from '../src/services/pdfPageRenderCache.ts'

const createCache = (byteBudget = 800) =>
  new PdfPageRenderCache({
    sessionId: 1,
    renderWidth: 10,
    devicePixelRatio: 1,
    byteBudget,
  })

test('PDF render cache estimates RGBA canvas bytes from rendered pixel dimensions', () => {
  assert.equal(
    estimatePdfCanvasBytes({ renderWidth: 100, aspectRatio: 1.5, devicePixelRatio: 2 }),
    240_000,
  )
})

test('PDF render cache evicts the least recently used unprotected page', () => {
  const cache = createCache()
  cache.recordRenderedPage(1, 1)
  cache.recordRenderedPage(2, 1)
  cache.touchPages([1])
  const snapshot = cache.recordRenderedPage(3, 1)

  assert.deepEqual(snapshot.retainedPageIndexes, [3, 1])
  assert.equal(snapshot.estimatedBytes, 800)
  assert.ok(!snapshot.retainedPageIndexes.includes(2))
})

test('PDF render cache allows explainable overflow only while pages are protected', () => {
  const cache = createCache(400)
  cache.setProtectedPages([1, 2])
  cache.recordRenderedPage(1, 1)
  let snapshot = cache.recordRenderedPage(2, 1)

  assert.equal(snapshot.estimatedBytes, 800)
  assert.equal(snapshot.protectedOverflowBytes, 400)
  assert.deepEqual(snapshot.protectedPageIndexes, [1, 2])

  snapshot = cache.setProtectedPages([2])
  assert.deepEqual(snapshot.retainedPageIndexes, [2])
  assert.equal(snapshot.protectedOverflowBytes, 0)
})

test('PDF render cache invalidates entries for a new session, width, or DPR', () => {
  const cache = createCache()
  cache.recordRenderedPage(1, 1)
  assert.deepEqual(cache.configure({
    sessionId: 1,
    renderWidth: 10,
    devicePixelRatio: 1,
    byteBudget: 400,
  }).retainedPageIndexes, [1])

  for (const config of [
    { sessionId: 2, renderWidth: 10, devicePixelRatio: 1, byteBudget: 800 },
    { sessionId: 2, renderWidth: 20, devicePixelRatio: 1, byteBudget: 800 },
    { sessionId: 2, renderWidth: 20, devicePixelRatio: 2, byteBudget: 800 },
  ]) {
    cache.recordRenderedPage(1, 1)
    assert.deepEqual(cache.configure(config).retainedPageIndexes, [])
  }
})
