import assert from 'node:assert/strict'
import test from 'node:test'
import { marked } from 'marked'
import {
  buildExportAnnotationRecords,
  decorateReaderAnnotationExportHtml,
  getReaderAnnotationsManagedMarkers,
  groupExportAnnotationRecords,
  mergeReaderAnnotationsManagedMarkdown,
  ReaderAnnotationValidationError,
  renderReaderAnnotationsManagedMarkdown,
  type ReaderAnnotationMarkdownOptions,
} from '../src/services/readerAnnotationSerializer.ts'
import type { ReaderAnnotationKind } from '../src/types/readerAnnotation.ts'

const createRow = ({
  id,
  kind = 'underline',
  pageNumber = 1,
  y = 0.1,
  createdAt = '2026-08-17T08:00:00.000Z',
  pathTitles = ['Part I', 'Chapter 1'],
}: {
  id: string
  kind?: ReaderAnnotationKind
  pageNumber?: number
  y?: number
  createdAt?: string
  pathTitles?: string[]
}) => {
  const nodes = pathTitles.map((title, index) => ({
    id: `${id}-node-${index}`,
    title,
    level: index,
    pathKey: pathTitles.slice(0, index + 1).join('>'),
  }))
  return {
    id,
    book_id: 7,
    selection_id: `selection-${id}`,
    kind,
    text: `Source ${id}`,
    annotation: kind === 'underline' ? '' : `Body ${id}`,
    translation_language: kind === 'translation' ? 'en-US' : null,
    anchor: JSON.stringify({
      version: 2,
      source: 'pdf',
      selectedText: `Source ${id}`,
      positions: [{ source: 'pdf', pageNumber, x: 0.2, y }],
      outlinePath: null,
    }),
    outline_path_json: pathTitles.length
      ? JSON.stringify({
          source: 'pdf',
          pathKey: nodes.at(-1)?.pathKey,
          nodes,
        })
      : null,
    location_status: pathTitles.length ? 'resolved' : 'page-only',
    created_at: createdAt,
    updated_at: createdAt,
  }
}

const markdownOptions: ReaderAnnotationMarkdownOptions = {
  bookId: 7,
  title: 'Example Book Notes',
  author: 'Example Author',
  progress: 42,
  syncedAt: '2026-08-17 16:00',
  locale: 'en-US',
  labels: {
    author: 'Author',
    syncTime: 'Last sync',
    progress: 'Reading progress',
    annotationsHeading: 'Annotations',
    unknownChapter: 'Unrecognized chapter',
    fullChapterPath: 'Full chapter path',
    type: 'Type',
    originalText: 'Original text',
    body: 'Content',
    pages: 'Pages',
    createdAt: 'Recorded at',
    deepLink: 'Source link',
    notAvailable: 'Not available',
    empty: 'No annotations',
    kinds: {
      translation: 'Translation',
      underline: 'Highlight',
      note: 'Note',
    },
  },
}

test('database annotation rows build UI-independent records with the stored full path', () => {
  const records = buildExportAnnotationRecords([
    createRow({
      id: 'deep-note',
      kind: 'note',
      pageNumber: 12,
      pathTitles: ['Part I', 'Chapter 2', 'Section 3', 'Topic 4', 'Detail 5', 'Leaf 6'],
    }),
  ])

  assert.equal(records.length, 1)
  assert.equal(records[0]?.kind, 'note')
  assert.equal(records[0]?.body, 'Body deep-note')
  assert.deepEqual(records[0]?.outlinePathTitles, [
    'Part I',
    'Chapter 2',
    'Section 3',
    'Topic 4',
    'Detail 5',
    'Leaf 6',
  ])
  assert.deepEqual(records[0]?.pageNumbers, [12])
  assert.equal(records[0]?.deepLink, 'book:7#annotation:deep-note')
})

test('export records and groups retain document order across chapters and positions', () => {
  const records = buildExportAnnotationRecords([
    createRow({ id: 'later-in-a', pageNumber: 2, y: 0.8, pathTitles: ['Part I', 'A'] }),
    createRow({ id: 'chapter-b', pageNumber: 3, y: 0.1, pathTitles: ['Part I', 'B'] }),
    createRow({
      id: 'same-position-later',
      pageNumber: 2,
      y: 0.2,
      createdAt: '2026-08-17T09:00:00.000Z',
      pathTitles: ['Part I', 'A'],
    }),
    createRow({ id: 'first-in-a', pageNumber: 2, y: 0.2, pathTitles: ['Part I', 'A'] }),
  ])
  assert.deepEqual(
    records.map((record) => record.id),
    ['first-in-a', 'same-position-later', 'later-in-a', 'chapter-b'],
  )
  assert.deepEqual(
    groupExportAnnotationRecords(records).map((group) => ({
      path: group.outlinePathTitles.join(' > '),
      ids: group.records.map((record) => record.id),
    })),
    [
      {
        path: 'Part I > A',
        ids: ['first-in-a', 'same-position-later', 'later-in-a'],
      },
      { path: 'Part I > B', ids: ['chapter-b'] },
    ],
  )
})

test('managed Markdown preserves paths deeper than H6 and page-only locations', () => {
  const records = buildExportAnnotationRecords([
    createRow({
      id: 'deep',
      kind: 'translation',
      pageNumber: 8,
      pathTitles: ['L1', 'L2', 'L3', 'L4', 'L5', 'L6', 'L7', 'L8'],
    }),
    createRow({ id: 'page-only', pageNumber: 21, pathTitles: [] }),
  ])
  const markdown = renderReaderAnnotationsManagedMarkdown(records, markdownOptions)

  assert.match(markdown, /###### L4/)
  assert.doesNotMatch(markdown, /^####### /m)
  assert.match(markdown, /Full chapter path\*\*: L1 &gt; L2 &gt; L3 &gt; L4 &gt; L5 &gt; L6 &gt; L7 &gt; L8/)
  assert.match(markdown, /### Unrecognized chapter/)
  assert.match(markdown, /\*\*Pages\*\*: 21/)
  assert.match(markdown, /\[\[book:7#annotation:deep\]\]/)
  assert.match(markdown, /life-os:reader-annotation:deep:start/)

  const html = decorateReaderAnnotationExportHtml(marked.parse(markdown) as string)
  assert.match(html, /class="reader-export-annotation is-translation"/)
  assert.match(html, /data-reader-annotation-kind="translation"/)
  assert.match(html, /<span class="reader-export-annotation__icon" aria-hidden="true">T<\/span>/)
  assert.match(html, /<li>L5\s*<ul>\s*<li>L6\s*<ul>\s*<li>L7\s*<ul>\s*<li>L8/)
})

test('managed Notes synchronization is repeatable and preserves handwritten regions', () => {
  const initialRecords = buildExportAnnotationRecords([
    createRow({ id: 'keep', kind: 'note' }),
    createRow({ id: 'remove', kind: 'underline', pageNumber: 2 }),
  ])
  const nextRecords = buildExportAnnotationRecords([createRow({ id: 'keep', kind: 'note' })])
  const initialManaged = renderReaderAnnotationsManagedMarkdown(initialRecords, markdownOptions)
  const nextManaged = renderReaderAnnotationsManagedMarkdown(nextRecords, markdownOptions)
  const existing = `Handwritten before\n\n${initialManaged}\n\nHandwritten after`

  const synchronized = mergeReaderAnnotationsManagedMarkdown(existing, nextManaged, 7)
  const repeated = mergeReaderAnnotationsManagedMarkdown(synchronized, nextManaged, 7)
  const markers = getReaderAnnotationsManagedMarkers(7)

  assert.equal(repeated, synchronized)
  assert.equal(synchronized.match(new RegExp(markers.start, 'g'))?.length, 1)
  assert.equal(synchronized.match(new RegExp(markers.end, 'g'))?.length, 1)
  assert.match(synchronized, /^Handwritten before\n\n/)
  assert.match(synchronized, /\n\nHandwritten after$/)
  assert.match(synchronized, /life-os:reader-annotation:keep:start/)
  assert.doesNotMatch(synchronized, /life-os:reader-annotation:remove:start/)
})

test('incomplete managed markers fail without rewriting note content', () => {
  const markers = getReaderAnnotationsManagedMarkers(7)
  assert.throws(
    () => mergeReaderAnnotationsManagedMarkdown(`Manual\n${markers.start}`, 'replacement', 7),
    ReaderAnnotationValidationError,
  )
})
