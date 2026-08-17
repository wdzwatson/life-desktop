import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const booksSource = readFileSync(new URL('../src/views/Books.tsx', import.meta.url), 'utf8')
const notesSource = readFileSync(new URL('../src/views/Notes.tsx', import.meta.url), 'utf8')
const mainSource = readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8')

test('Notes dispatches annotation deep links and Books opens the full reader before locating', () => {
  assert.match(notesSource, /parseReaderBookDeepLink\(link\)/)
  assert.match(notesSource, /annotationId:/)
  assert.match(notesSource, /href="\$\{safeLink\}"/)
  assert.match(booksSource, /readerOpenForDeepLinkRef\.current\(book\)/)
  assert.match(booksSource, /pending\.annotationId/)
  assert.match(booksSource, /readerAnnotationPanelActionsRef\.current\.locate\(highlight\)/)
  assert.match(booksSource, /normalizeTocTitle\(pending\.chapter\)/)
})

test('HTML, DOCX, and PDF exports share semantic annotation styling', () => {
  assert.match(notesSource, /decorateReaderAnnotationExportHtml/)
  assert.match(notesSource, /handleExportNote\('docx'\)/)
  assert.match(mainSource, /buildNoteExportHtml/)
  assert.match(mainSource, /await import\('\.\/noteDocxExport'\)/)
  assert.match(mainSource, /buildNoteExportDocx\(String\(title \|\| ''\), styledHtml\)/)
  assert.match(mainSource, /format === 'doc' \|\| format === 'docx'/)
  assert.match(mainSource, /finally \{\s*if \(!win\.isDestroyed\(\)\) win\.destroy\(\)/)
})
