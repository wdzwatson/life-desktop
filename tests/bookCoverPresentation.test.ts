import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { getBookCoverUrl } from '../src/views/bookCoverUtils.ts'

const booksSource = readFileSync(new URL('../src/views/Books.tsx', import.meta.url), 'utf8')
const dashboardSource = readFileSync(new URL('../src/views/Dashboard.tsx', import.meta.url), 'utf8')

test('book cover URLs are limited to managed flat cover files', () => {
  assert.equal(getBookCoverUrl('/book-covers/example.webp'), 'life-book-cover://cover/example.webp')
  assert.equal(getBookCoverUrl('book-covers/example.png'), 'life-book-cover://cover/example.png')
  assert.equal(getBookCoverUrl('/books/example.epub'), null)
  assert.equal(getBookCoverUrl('/book-covers/nested/example.png'), null)
  assert.equal(getBookCoverUrl(null), null)
})

test('shelf and dashboard render stored cover paths with an image fallback', () => {
  assert.match(booksSource, /className="book-shelf-card__cover"/)
  assert.match(booksSource, /getBookCoverUrl\(book\.cover_path\)/)
  assert.match(dashboardSource, /className="dashboard-book-cover"/)
  assert.match(dashboardSource, /getBookCoverUrl\(currentBook\.cover_path\)/)
  assert.match(booksSource, /event\.currentTarget\.style\.display = 'none'/)
})
