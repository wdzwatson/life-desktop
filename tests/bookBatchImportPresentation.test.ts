import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const booksSource = readFileSync(new URL('../src/views/Books.tsx', import.meta.url), 'utf8')
const booksStyles = readFileSync(new URL('../src/views/Books.css', import.meta.url), 'utf8')
const mainSource = readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8')

test('book batch import exposes a queue, a unified shelf, and retryable item states', () => {
  assert.match(booksSource, /isBatchImportOpen/)
  assert.match(booksSource, /handleSelectBatchBooks/)
  assert.match(booksSource, /handleSelectBatchCovers/)
  assert.match(booksSource, /batchImportShelfRows/)
  assert.match(booksSource, /runBatchImport\(true\)/)
  assert.match(booksSource, /book-batch-import__status \$\{item\.status\}/)
  assert.match(booksStyles, /\.book-batch-import__queue\s*\{[\s\S]*?overflow:\s*auto/)
  assert.match(booksStyles, /\.book-batch-import__item\s*\{[\s\S]*?min-height:\s*72px/)
})

test('book picker passes selected paths into the batch queue as book paths', () => {
  assert.match(mainSource, /buildBatchImportItems\(\{ bookPaths: filePaths, existingBookFileNames \}\)/)
})

test('batch import closes when every selected file is already imported', () => {
  assert.match(booksSource, /items\.every\(\(item\) => item\.duplicateReason === 'existing-book'\)/)
  assert.match(booksSource, /showToast\(t\('books\.batch_all_already_imported'\)\)/)
  assert.match(booksSource, /setIsBatchImportOpen\(false\)[\s\S]*?resetBatchImport\(\)/)
})

test('single-book imports use the same managed-cover generation flow', () => {
  assert.match(mainSource, /createManagedBookCover\(\{[\s\S]*?sourcePath,[\s\S]*?filesRoot,/)
  assert.match(booksSource, /const \[importCoverPath, setImportCoverPath\]/)
  assert.match(booksSource, /cover, cover_path, category/)
})
