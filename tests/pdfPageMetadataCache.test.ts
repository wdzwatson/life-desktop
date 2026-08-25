import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { PdfPageMetadataCache } from '../src/services/pdfPageMetadataCache.ts'

const booksSource = readFileSync(new URL('../src/views/Books.tsx', import.meta.url), 'utf8')

test('PDF page metadata cache publishes only the changed page', () => {
  const cache = new PdfPageMetadataCache()
  const sessionId = cache.beginSession()
  let pageOneUpdates = 0
  let pageTwoUpdates = 0
  cache.subscribe(1, () => pageOneUpdates++)
  cache.subscribe(2, () => pageTwoUpdates++)

  assert.equal(cache.setAspectRatio(sessionId, 1, 1.4), true)
  assert.equal(cache.setTextMode(sessionId, 1, 'scanned'), true)
  assert.equal(cache.setTextMode(sessionId, 1, 'scanned'), false)

  assert.deepEqual(cache.getSnapshot(1), { aspectRatio: 1.4, textMode: 'scanned' })
  assert.deepEqual(cache.getSnapshot(2), { textMode: 'unknown' })
  assert.equal(pageOneUpdates, 2)
  assert.equal(pageTwoUpdates, 0)
})

test('PDF page metadata cache rejects callbacks from an earlier book session', () => {
  const cache = new PdfPageMetadataCache()
  const firstSession = cache.beginSession()
  cache.setTextMode(firstSession, 8, 'text')
  const secondSession = cache.beginSession()

  assert.equal(cache.getSnapshot(8).textMode, 'unknown')
  assert.equal(cache.setAspectRatio(firstSession, 8, 2), false)
  assert.equal(cache.setTextMode(firstSession, 8, 'scanned'), false)
  assert.equal(cache.setTextMode(secondSession, 8, 'scanned'), true)
  assert.equal(cache.getSnapshot(8).textMode, 'scanned')
})

test('PDF page metadata cache keeps snapshots stable for no-op updates', () => {
  const cache = new PdfPageMetadataCache()
  const sessionId = cache.beginSession()
  cache.setAspectRatio(sessionId, 3, 1.414)
  const snapshot = cache.getSnapshot(3)

  assert.equal(cache.setAspectRatio(sessionId, 3, 1.4144), false)
  assert.equal(cache.getSnapshot(3), snapshot)
  assert.equal(cache.setAspectRatio(sessionId, 0, 1.2), false)
  assert.equal(cache.setAspectRatio(sessionId, 3, Number.NaN), false)
})

test('PDF continuous page slots subscribe to page-local metadata', () => {
  assert.match(booksSource, /const PdfContinuousPageSlot = React\.memo/)
  assert.match(booksSource, /useSyncExternalStore\(subscribe, getSnapshot, getSnapshot\)/)
  assert.doesNotMatch(booksSource, /setPdfPageAspectRatios/)
  assert.doesNotMatch(booksSource, /pdfPageAspectRatios=/)
})
