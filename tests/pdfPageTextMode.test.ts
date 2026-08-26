import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { detectPdfPageTextMode } from '../src/services/pdfPageTextMode.ts'

const booksSource = readFileSync(new URL('../src/views/Books.tsx', import.meta.url), 'utf8')

test('PDF page text mode treats empty and whitespace-only content as scanned', () => {
  assert.equal(detectPdfPageTextMode({ items: [] }), 'scanned')
  assert.equal(
    detectPdfPageTextMode({ items: [{ str: '  ' } as never, { str: '\n' } as never] }),
    'scanned',
  )
})

test('PDF page text mode recognizes selectable and hidden OCR text', () => {
  assert.equal(
    detectPdfPageTextMode({ items: [{ str: 'a' } as never, { str: '字' } as never] }),
    'text',
  )
  assert.equal(detectPdfPageTextMode({ items: [{ str: 'OCR text' } as never] }), 'text')
})

test('PDF page text mode ignores marked-content entries without strings', () => {
  assert.equal(
    detectPdfPageTextMode({
      items: [{ type: 'beginMarkedContent', id: 'scan' } as never, { str: 'x' } as never],
    }),
    'scanned',
  )
})

test('PDF page classification reuses the react-pdf text-layer result', () => {
  assert.match(booksSource, /onGetTextSuccess=\{\(textContent\)/)
  assert.match(booksSource, /detectPdfPageTextMode\(textContent\)/)
  assert.doesNotMatch(booksSource, /handlePdfPageTextModeDetected/)
  assert.match(booksSource, /renderTextLayer=\{!listProps\.isAutoPlaying && metadata\.textMode === 'text'\}/)
  assert.match(booksSource, /scheduleTextModeProbe\(\)/)
})
