import assert from 'node:assert/strict'
import test from 'node:test'
import { parseReaderBookDeepLink } from '../src/services/readerDeepLink.ts'

test('reader deep links distinguish annotations from legacy chapter targets', () => {
  assert.deepEqual(parseReaderBookDeepLink('book:42#annotation:ann-1'), {
    bookId: 42,
    target: 'annotation',
    annotationId: 'ann-1',
  })
  assert.deepEqual(parseReaderBookDeepLink('book:42#Chapter%202'), {
    bookId: 42,
    target: 'chapter',
    chapter: 'Chapter 2',
  })
  assert.deepEqual(parseReaderBookDeepLink('book:42'), { bookId: 42, target: 'book' })
})

test('reader deep links reject invalid books and empty annotation IDs', () => {
  assert.equal(parseReaderBookDeepLink('book:nope#Chapter'), null)
  assert.equal(parseReaderBookDeepLink('book:0#Chapter'), null)
  assert.equal(parseReaderBookDeepLink('book:2#annotation:'), null)
  assert.equal(parseReaderBookDeepLink('https://example.com'), null)
})
