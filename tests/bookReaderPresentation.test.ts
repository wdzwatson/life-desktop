import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const booksSource = readFileSync(new URL('../src/views/Books.tsx', import.meta.url), 'utf8')
const booksStyles = readFileSync(new URL('../src/views/Books.css', import.meta.url), 'utf8')
const viteConfig = readFileSync(new URL('../vite.config.ts', import.meta.url), 'utf8')

test('book shelf titles support two lines while preserving the full title as a tooltip', () => {
  assert.match(booksSource, /className="book-shelf-card__title"/)
  assert.match(booksSource, /className="book-shelf-card__title"\s+title=\{book\.title\}/)
  assert.match(booksStyles, /\.book-shelf-card__title\s*\{[\s\S]*?-webkit-line-clamp:\s*2/)
})

test('book shelf edit action remains distinct from the card surface on hover', () => {
  assert.match(booksSource, /className="btn sm book-shelf-card__edit-action"/)
  assert.match(booksStyles, /\.book-shelf-card \.book-shelf-card__edit-action\s*\{[\s\S]*?background-color:\s*var\(--color-accent\)/)
  assert.match(booksStyles, /\.book-shelf-card \.book-shelf-card__edit-action:hover:not\(:disabled\)\s*\{[\s\S]*?background-color:\s*var\(--color-accent-hover\)/)
})

test('reader header gives long titles a responsive, non-overlapping layout', () => {
  assert.match(booksSource, /className="book-reader__header"/)
  assert.match(booksSource, /className="book-reader__title"/)
  assert.match(booksSource, /className="book-reader__toolbar"/)
  assert.match(booksStyles, /\.book-reader__title\s*\{[\s\S]*?-webkit-line-clamp:\s*2/)
  assert.match(booksStyles, /@media \(max-width: 1180px\)[\s\S]*?overflow-x:\s*auto/)
})

test('PDF reader provides PDF.js with bundled WASM decoder files through a stable option object', () => {
  assert.match(booksSource, /import\.meta\.env\.DEV/)
  assert.match(booksSource, /\$\{window\.location\.origin\}\/pdfjs\/wasm\//)
  assert.match(booksSource, /new URL\('pdfjs\/wasm\/', document\.baseURI\)/)
  assert.match(booksSource, /const pdfDocumentOptions = useMemo\(\(\) => \(\{ wasmUrl: pdfWasmUrl \}\), \[\]\)/)
  assert.match(booksSource, /options=\{pdfDocumentOptions\}/)
  assert.match(viteConfig, /\['openjpeg\.wasm', 'qcms_bg\.wasm'\]/)
  assert.match(viteConfig, /dist', 'pdfjs', 'wasm'/)
})
