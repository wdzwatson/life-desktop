import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { buildReaderOutlineTree } from '../src/components/ReaderOutlineDrawer.tsx'
import { buildExportAnnotationRecords } from '../src/services/readerAnnotationSerializer.ts'
import { createOutlineIndex } from '../src/services/outlineIndex.ts'

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
    selectionMode: 'text' | 'ocr' | 'mixed' | 'reflow' | 'unavailable'
    expectedStatus: 'resolved' | 'page-only' | 'error'
    fixture: string | null
    description: string
  }>
  contracts: {
    rendererOutlineAnalysis: { blocking: boolean; phase: string }
    selectionWaitsForOutline: { blocking: boolean; phase: string }
    windowResizeWaitsForOutline: { blocking: boolean; phase: string }
    outlineWorker: { blocking: boolean; phase: string }
  }
  budgetsMs: Record<string, number>
}

const manifestUrl = new URL('./fixtures/reader/performance-baseline.json', import.meta.url)
const manifest = JSON.parse(readFileSync(manifestUrl, 'utf8')) as BaselineManifest
const booksSource = readFileSync(new URL('../src/views/Books.tsx', import.meta.url), 'utf8')

test('reader baseline manifest covers every supported document and failure shape', () => {
  assert.equal(manifest.version, 2)

  assert.deepEqual(
    manifest.samples.map((sample) => sample.id),
    [
      'pdf-plain-no-outline',
      'pdf-multicolumn-deep-outline',
      'pdf-scanned',
      'pdf-mixed',
      'pdf-corrupt',
      'epub-deep-outline',
      'pdf-large-synthetic',
    ],
  )
  assert.deepEqual(
    manifest.scenarios.map((scenario) => scenario.id),
    [
      'pdf-first-screen',
      'epub-first-screen',
      'pdf-text-selection',
      'pdf-page-turn',
      'pdf-scroll',
      'pdf-window-resize',
      'pdf-ocr-page',
      'annotation-export',
    ],
  )

  assert.equal(manifest.samples.find((sample) => sample.id === 'pdf-plain-no-outline')?.outline, 'none')
  assert.equal(
    manifest.samples.find((sample) => sample.id === 'pdf-multicolumn-deep-outline')?.outline,
    'native',
  )
  assert.equal(manifest.samples.find((sample) => sample.id === 'pdf-large-synthetic')?.pageCount, 320)
  assert.equal(manifest.samples.find((sample) => sample.id === 'pdf-scanned')?.selectionMode, 'ocr')
  assert.equal(manifest.samples.find((sample) => sample.id === 'pdf-mixed')?.selectionMode, 'mixed')
  assert.equal(manifest.samples.find((sample) => sample.id === 'pdf-corrupt')?.expectedStatus, 'error')
  assert.equal(manifest.samples.find((sample) => sample.id === 'epub-deep-outline')?.format, 'epub')
  manifest.samples.forEach((sample) => {
    if (!sample.fixture) return
    assert.equal(existsSync(new URL(sample.fixture, manifestUrl)), true, `${sample.id} fixture is missing`)
  })

  assert.equal(manifest.contracts.rendererOutlineAnalysis.blocking, false)
  assert.equal(manifest.contracts.selectionWaitsForOutline.blocking, false)
  assert.equal(manifest.contracts.rendererOutlineAnalysis.phase, 'background')
  assert.equal(manifest.contracts.selectionWaitsForOutline.phase, 'immediate')
  assert.equal(manifest.contracts.windowResizeWaitsForOutline.blocking, false)
  assert.equal(manifest.contracts.outlineWorker.phase, 'worker')

  assert.ok(manifest.budgetsMs.pdfFirstScreen > manifest.budgetsMs.selectionAck)
  assert.ok(manifest.budgetsMs.epubFirstScreen > 0)
  assert.ok(manifest.budgetsMs.scrollFrame <= 16)
  assert.ok(manifest.budgetsMs.ocrInlineStatus > manifest.budgetsMs.selectionAck)
})

test('deep outline and large annotation operations stay inside background budgets', () => {
  const outlineNodes = Array.from({ length: 5_000 }, (_, index) => ({
    id: `outline-${index}`,
    title: `Level ${index}`,
    level: index,
    parentId: index === 0 ? null : `outline-${index - 1}`,
    pageStart: index + 1,
    source: 'pdf' as const,
  }))
  const outlineStart = performance.now()
  const outlineIndex = createOutlineIndex(outlineNodes)
  const outlineDuration = performance.now() - outlineStart
  assert.equal(outlineIndex.getPathSnapshot('outline-4999')?.nodes.length, 5_000)
  assert.ok(outlineDuration < manifest.budgetsMs.outlineIndex5000, `outline index took ${outlineDuration}ms`)

  const treeStart = performance.now()
  const tree = buildReaderOutlineTree(outlineNodes)
  const treeDuration = performance.now() - treeStart
  assert.equal(tree.nodes.length, 5_000)
  assert.ok(treeDuration < manifest.budgetsMs.outlineTree5000, `outline tree took ${treeDuration}ms`)

  const annotations = Array.from({ length: 10_000 }, (_, index) => {
    const text = `Annotation ${index}`
    const timestamp = new Date(1_700_000_000_000 + index).toISOString()
    return {
      id: `annotation-${index}`,
      bookId: 1,
      selectionId: `selection-${index}`,
      kind: 'underline' as const,
      text,
      source: 'pdf' as const,
      anchor: {
        version: 2 as const,
        source: 'pdf' as const,
        selectedText: text,
        positions: [
          { source: 'pdf' as const, pageNumber: (index % 320) + 1, y: (index % 100) / 100 },
        ],
        outlinePath: null,
      },
      outlinePath: null,
      locationStatus: 'page-only' as const,
      createdAt: timestamp,
      updatedAt: timestamp,
    }
  })
  const annotationStart = performance.now()
  const records = buildExportAnnotationRecords(annotations)
  const annotationDuration = performance.now() - annotationStart
  assert.equal(records.length, 10_000)
  assert.ok(
    annotationDuration < manifest.budgetsMs.annotationSort10000,
    `annotation normalization and sort took ${annotationDuration}ms`,
  )
})

test('reader selection, page turning, scroll, and OCR remain direct UI actions', () => {
  assert.match(booksSource, /onMouseUp=\{handleTextSelection\}/)
  assert.match(booksSource, /handleNextPage\(\)/)
  assert.match(booksSource, /handlePrevPage\(\)/)
  assert.match(booksSource, /requestPdfOcrForCurrentPage\(\)/)
  assert.doesNotMatch(booksSource, /\bgetOutline\s*\(/)
})
