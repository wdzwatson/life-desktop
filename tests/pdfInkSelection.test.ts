import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createPdfOcrParagraphCropArea,
  detectNearestTextBand,
  doesPdfOcrParagraphTouchCropEdge,
  getPdfInkStrokeBounds,
  isPdfOcrSelectionAvailable,
  joinPdfOcrParagraphWords,
  selectPdfOcrParagraph,
  selectPdfOcrWordsForInk,
} from '../src/views/pdfInkSelection.ts'
import type { PdfOcrWord } from '../src/views/pdfOcrService.ts'

const word = (
  text: string,
  x: number,
  y: number,
  hierarchy: Partial<Pick<PdfOcrWord, 'blockIndex' | 'paragraphIndex' | 'lineIndex' | 'wordIndex'>>,
): PdfOcrWord => ({
  text,
  x,
  y,
  width: Math.max(0.025, text.length * 0.018),
  height: 0.025,
  confidence: 90,
  ...hierarchy,
})

test('ink stroke bounds require a meaningful horizontal gesture', () => {
  assert.equal(
    getPdfInkStrokeBounds([
      { x: 0.2, y: 0.3 },
      { x: 0.205, y: 0.301 },
    ]),
    null,
  )
  assert.deepEqual(
    getPdfInkStrokeBounds([
      { x: 0.2, y: 0.3 },
      { x: 0.6, y: 0.31 },
    ]),
    { x: 0.2, y: 0.3, width: 0.39999999999999997, height: 0.010000000000000009 },
  )
})

test('line detection finds the closest dark text band above an underline', () => {
  const width = 120
  const height = 80
  const data = new Uint8ClampedArray(width * height * 4).fill(255)
  for (let y = 24; y <= 39; y += 1) {
    for (let x = 10; x < 110; x += 3) {
      const offset = (y * width + x) * 4
      data[offset] = 20
      data[offset + 1] = 20
      data[offset + 2] = 20
    }
  }

  const band = detectNearestTextBand({ data, width, height }, 45)
  assert.ok(band)
  assert.ok((band?.top || 0) <= 24)
  assert.ok((band?.bottom || 0) >= 39)
  assert.ok((band?.bottom || 0) < 50)
})

test('ink selection uses symbol boxes for precise Chinese character ranges', () => {
  const selection = selectPdfOcrWordsForInk(
    [
      {
        text: '扫描文字',
        x: 0.1,
        y: 0.2,
        width: 0.4,
        height: 0.04,
        confidence: 90,
        symbols: ['扫', '描', '文', '字'].map((text, index) => ({
          text,
          x: 0.1 + index * 0.1,
          y: 0.2,
          width: 0.08,
          height: 0.04,
          confidence: 90,
        })),
      },
    ],
    { x: 0.19, y: 0.195, width: 0.2, height: 0.05 },
  )

  assert.equal(selection?.text, '描文')
  assert.equal(selection?.areas.length, 1)
  assert.equal(selection?.confidence, 90)
})

test('wrapped Chinese OCR lines join without spaces', () => {
  const words = [
    word('扫描版', 0.1, 0.2, { blockIndex: 0, paragraphIndex: 0, lineIndex: 0, wordIndex: 0 }),
    word('书籍', 0.1, 0.24, { blockIndex: 0, paragraphIndex: 0, lineIndex: 1, wordIndex: 0 }),
  ]
  assert.equal(joinPdfOcrParagraphWords(words), '扫描版书籍')
})

test('wrapped English OCR lines join with spaces', () => {
  const words = [
    word('Scanned', 0.1, 0.2, { blockIndex: 0, paragraphIndex: 0, lineIndex: 0, wordIndex: 0 }),
    word('books', 0.1, 0.24, { blockIndex: 0, paragraphIndex: 0, lineIndex: 1, wordIndex: 0 }),
  ]
  assert.equal(joinPdfOcrParagraphWords(words), 'Scanned books')
})

test('OCR paragraph joining preserves explicit paragraph boundaries', () => {
  const words = [
    word('First', 0.1, 0.2, { blockIndex: 0, paragraphIndex: 0, lineIndex: 0, wordIndex: 0 }),
    word('Second', 0.1, 0.26, { blockIndex: 0, paragraphIndex: 1, lineIndex: 0, wordIndex: 0 }),
  ]
  assert.equal(joinPdfOcrParagraphWords(words), 'First\n\nSecond')
})

test('English soft line-end hyphens join only before lowercase text', () => {
  const lowercaseContinuation = [
    word('exam-', 0.1, 0.2, { blockIndex: 0, paragraphIndex: 0, lineIndex: 0, wordIndex: 0 }),
    word('ple', 0.1, 0.24, { blockIndex: 0, paragraphIndex: 0, lineIndex: 1, wordIndex: 0 }),
  ]
  const uppercaseContinuation = [
    word('Part-', 0.1, 0.2, { blockIndex: 0, paragraphIndex: 0, lineIndex: 0, wordIndex: 0 }),
    word('Two', 0.1, 0.24, { blockIndex: 0, paragraphIndex: 0, lineIndex: 1, wordIndex: 0 }),
  ]
  assert.equal(joinPdfOcrParagraphWords(lowercaseContinuation), 'example')
  assert.equal(joinPdfOcrParagraphWords(uppercaseContinuation), 'Part- Two')
})

test('paragraph expansion excludes adjacent paragraphs and same-height columns', () => {
  const words = [
    word('目标', 0.1, 0.2, { blockIndex: 0, paragraphIndex: 0, lineIndex: 0, wordIndex: 0 }),
    word('段落', 0.1, 0.24, { blockIndex: 0, paragraphIndex: 0, lineIndex: 1, wordIndex: 0 }),
    word('相邻段落', 0.1, 0.3, { blockIndex: 0, paragraphIndex: 1, lineIndex: 0, wordIndex: 0 }),
    word('另一栏', 0.62, 0.2, { blockIndex: 1, paragraphIndex: 0, lineIndex: 0, wordIndex: 0 }),
  ]
  const selection = selectPdfOcrParagraph(words, [{ x: 0.1, y: 0.2, width: 0.05, height: 0.025 }])
  assert.equal(selection?.text, '目标段落')
  assert.equal(selection?.areas.length, 2)
  assert.equal(selection?.lineCount, 2)
})

test('paragraph expansion fails safely when OCR hierarchy is missing or ambiguous', () => {
  const missingHierarchy = [word('orphan', 0.1, 0.2, {})]
  assert.equal(
    selectPdfOcrParagraph(missingHierarchy, [{ x: 0.1, y: 0.2, width: 0.08, height: 0.025 }]),
    null,
  )

  const overlappingParagraphs = [
    word('one', 0.1, 0.2, { blockIndex: 0, paragraphIndex: 0, lineIndex: 0, wordIndex: 0 }),
    word('two', 0.12, 0.2, { blockIndex: 0, paragraphIndex: 1, lineIndex: 0, wordIndex: 0 }),
  ]
  assert.equal(
    selectPdfOcrParagraph(overlappingParagraphs, [{ x: 0.11, y: 0.2, width: 0.05, height: 0.025 }]),
    null,
  )
})

test('paragraph expansion rejects repeated aligned gaps that look like a table', () => {
  const tableWords = [
    word('A', 0.1, 0.2, { blockIndex: 0, paragraphIndex: 0, lineIndex: 0, wordIndex: 0 }),
    word('10', 0.36, 0.2, { blockIndex: 0, paragraphIndex: 0, lineIndex: 0, wordIndex: 1 }),
    word('B', 0.1, 0.24, { blockIndex: 0, paragraphIndex: 0, lineIndex: 1, wordIndex: 0 }),
    word('20', 0.36, 0.24, { blockIndex: 0, paragraphIndex: 0, lineIndex: 1, wordIndex: 1 }),
  ]
  assert.equal(
    selectPdfOcrParagraph(tableWords, [{ x: 0.1, y: 0.2, width: 0.03, height: 0.025 }]),
    null,
  )
})

test('paragraph crop expands once when the detected paragraph touches a crop edge', () => {
  const areas = [{ x: 0.2, y: 0.48, width: 0.2, height: 0.03 }]
  const initial = createPdfOcrParagraphCropArea(areas)
  const expanded = createPdfOcrParagraphCropArea(areas, true)
  assert.ok(initial)
  assert.ok(expanded)
  assert.ok((expanded?.height || 0) > (initial?.height || 0))
  assert.equal(
    doesPdfOcrParagraphTouchCropEdge(
      { x: 0.1, y: initial!.y + 0.002, width: 0.4, height: 0.2 },
      initial!,
    ),
    true,
  )
})

test('OCR correction context is available only for OCR selections', () => {
  assert.equal(
    isPdfOcrSelectionAvailable({
      source: 'ocr',
      pageNumber: 2,
      areas: [{ x: 0.1, y: 0.2, width: 0.2, height: 0.03 }],
    }),
    true,
  )
  assert.equal(
    isPdfOcrSelectionAvailable({
      source: 'pdf',
      pageNumber: 2,
      areas: [{ x: 0.1, y: 0.2, width: 0.2, height: 0.03 }],
    }),
    false,
  )
  assert.equal(isPdfOcrSelectionAvailable(null), false)
})
