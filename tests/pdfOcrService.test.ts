import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getPdfOcrRegionCacheKey,
  PdfOcrRegionCache,
  type PdfOcrPage,
} from '../src/views/pdfOcrService.ts'

const page = (text: string): PdfOcrPage => ({ text, words: [] })

test('regional OCR cache keys normalize equivalent crop rectangles', () => {
  const left = getPdfOcrRegionCacheKey(
    2,
    { x: 0.03001, y: 0.2, width: 0.94, height: 0.34 },
    'tesseract-v3',
    { width: 1200, height: 1600 },
  )
  const right = getPdfOcrRegionCacheKey(
    2,
    { x: 0.03004, y: 0.20002, width: 0.94, height: 0.34 },
    'tesseract-v3',
    { width: 1200, height: 1600 },
  )
  assert.equal(left, right)
  assert.notEqual(
    left,
    getPdfOcrRegionCacheKey(3, { x: 0.03, y: 0.2, width: 0.94, height: 0.34 }, 'tesseract-v3'),
  )
  assert.notEqual(
    left,
    getPdfOcrRegionCacheKey(2, { x: 0.03, y: 0.2, width: 0.94, height: 0.34 }, 'tesseract-v3', {
      width: 900,
      height: 1200,
    }),
  )
})

test('regional OCR cache evicts the least recently used result', () => {
  const cache = new PdfOcrRegionCache(2)
  cache.set('first', page('one'))
  cache.set('second', page('two'))
  assert.equal(cache.get('first')?.text, 'one')
  cache.set('third', page('three'))
  assert.equal(cache.get('first')?.text, 'one')
  assert.equal(cache.get('second'), undefined)
  assert.equal(cache.size, 2)
  cache.clear()
  assert.equal(cache.size, 0)
})
