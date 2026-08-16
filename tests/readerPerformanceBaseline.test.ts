import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

type BaselineManifest = {
  version: number
  scenarios: Array<{
    id: string
    format: 'pdf' | 'epub'
    interaction: string
    blocking: boolean
  }>
  samples: Array<{
    id: string
    format: 'pdf' | 'epub'
    outline: 'none' | 'native' | 'tagged' | 'inferred'
    pageCount: number
    selectionMode: 'text' | 'ocr' | 'reflow'
    description: string
  }>
  contracts: {
    rendererOutlineAnalysis: { blocking: boolean; phase: string }
    selectionWaitsForOutline: { blocking: boolean; phase: string }
  }
  budgetsMs: Record<string, number>
}

const manifest = JSON.parse(
  readFileSync(new URL('./fixtures/reader/performance-baseline.json', import.meta.url), 'utf8'),
) as BaselineManifest
const booksSource = readFileSync(new URL('../src/views/Books.tsx', import.meta.url), 'utf8')

test('reader baseline manifest keeps the current coverage small and explicit', () => {
  assert.equal(manifest.version, 1)

  assert.deepEqual(
    manifest.samples.map((sample) => sample.id),
    ['pdf-no-outline', 'pdf-with-outline', 'pdf-large', 'pdf-scanned'],
  )
  assert.deepEqual(
    manifest.scenarios.map((scenario) => scenario.id),
    [
      'pdf-first-screen',
      'epub-first-screen',
      'pdf-text-selection',
      'pdf-page-turn',
      'pdf-scroll',
      'pdf-ocr-page',
    ],
  )

  assert.equal(manifest.samples.find((sample) => sample.id === 'pdf-no-outline')?.outline, 'none')
  assert.equal(
    manifest.samples.find((sample) => sample.id === 'pdf-with-outline')?.outline,
    'native',
  )
  assert.equal(manifest.samples.find((sample) => sample.id === 'pdf-large')?.pageCount, 320)
  assert.equal(manifest.samples.find((sample) => sample.id === 'pdf-scanned')?.selectionMode, 'ocr')

  assert.equal(manifest.contracts.rendererOutlineAnalysis.blocking, false)
  assert.equal(manifest.contracts.selectionWaitsForOutline.blocking, false)
  assert.equal(manifest.contracts.rendererOutlineAnalysis.phase, 'background')
  assert.equal(manifest.contracts.selectionWaitsForOutline.phase, 'immediate')

  assert.ok(manifest.budgetsMs.pdfFirstScreen > manifest.budgetsMs.selectionAck)
  assert.ok(manifest.budgetsMs.epubFirstScreen > 0)
  assert.ok(manifest.budgetsMs.scrollFrame <= 16)
  assert.ok(manifest.budgetsMs.ocrInlineStatus > manifest.budgetsMs.selectionAck)
})

test('reader selection, page turning, scroll, and OCR remain direct UI actions', () => {
  assert.match(booksSource, /onMouseUp=\{handleTextSelection\}/)
  assert.match(booksSource, /handleNextPage\(\)/)
  assert.match(booksSource, /handlePrevPage\(\)/)
  assert.match(booksSource, /requestPdfOcrForCurrentPage\(\)/)
  assert.doesNotMatch(booksSource, /\bgetOutline\s*\(/)
})
