import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const booksSource = readFileSync(new URL('../src/views/Books.tsx', import.meta.url), 'utf8')

test('full-screen book reader renders through the viewport portal', () => {
  const readerStart = booksSource.indexOf('{/* FULLSCREEN E-BOOK READER MOCK DIALOG */}')
  const importDialogStart = booksSource.indexOf('{/* Premium Import Book Modal */}')

  assert.notEqual(readerStart, -1)
  assert.notEqual(importDialogStart, -1)

  const readerSource = booksSource.slice(readerStart, importDialogStart)
  assert.match(readerSource, /\{readingBook && \(\s*<ViewportPortal>/)
  assert.match(readerSource, /className="book-reader-overlay"/)

  const readerFrameSource = readerSource.slice(0, readerSource.indexOf('{/* Reader Header */}'))
  assert.doesNotMatch(readerFrameSource, /animation:\s*'enter/)
})
