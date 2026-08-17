import assert from 'node:assert/strict'
import test from 'node:test'
import {
  filterReaderAnnotationItems,
  getReaderAnnotationCounts,
  getReaderAnnotationPage,
  READER_ANNOTATION_PAGE_SIZE,
  type ReaderAnnotationPanelItem,
} from '../src/components/ReaderAnnotationsPanel.tsx'

const createItem = (
  id: string,
  kind: ReaderAnnotationPanelItem['kind'],
): ReaderAnnotationPanelItem => ({
  id,
  kind,
  text: `Source ${id}`,
  content: kind === 'highlight' ? undefined : `Content ${id}`,
  locationLabel: 'Part I · Chapter 2 · Section 3',
  createdAt: '2026-08-17T08:00:00.000Z',
})

test('reader annotation panel counts and filters all three independent kinds', () => {
  const items = [
    createItem('translation-1', 'translation'),
    createItem('underline-1', 'highlight'),
    createItem('note-1', 'note'),
    createItem('note-2', 'note'),
  ]

  assert.deepEqual(getReaderAnnotationCounts(items), {
    all: 4,
    translation: 1,
    highlight: 1,
    note: 2,
  })
  assert.deepEqual(
    filterReaderAnnotationItems(items, 'note').map((item) => item.id),
    ['note-1', 'note-2'],
  )
  assert.equal(filterReaderAnnotationItems(items, 'all'), items)
})

test('reader annotation panel paginates large lists without changing item order', () => {
  const items = Array.from({ length: READER_ANNOTATION_PAGE_SIZE + 25 }, (_, index) =>
    createItem(`item-${index}`, index % 2 === 0 ? 'highlight' : 'translation'),
  )

  const firstPage = getReaderAnnotationPage(items, READER_ANNOTATION_PAGE_SIZE)
  const secondPage = getReaderAnnotationPage(items, READER_ANNOTATION_PAGE_SIZE * 2)
  assert.equal(firstPage.length, READER_ANNOTATION_PAGE_SIZE)
  assert.equal(secondPage.length, items.length)
  assert.equal(firstPage[0]?.id, 'item-0')
  assert.equal(firstPage.at(-1)?.id, `item-${READER_ANNOTATION_PAGE_SIZE - 1}`)
})
