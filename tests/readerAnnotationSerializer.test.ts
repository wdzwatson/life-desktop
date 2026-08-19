import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildExportAnnotationRecord,
  compareReaderAnnotationItems,
  convertLegacyReaderAnchorToV2,
  deserializeReaderAnnotationItem,
  normalizeReaderAnnotationItem,
  normalizeReaderAnchorV2,
  serializeReaderAnnotationItem,
  type ReaderAnnotationItem,
} from '../src/services/readerAnnotationSerializer.ts'

const baseItem: ReaderAnnotationItem = normalizeReaderAnnotationItem({
  id: 'ann-1',
  bookId: 42,
  selectionId: 'sel-1',
  kind: 'translation',
  text: 'Selected source text',
  body: '译文',
  translationLanguage: 'zh-CN',
  anchor: {
    version: 2,
    source: 'pdf',
    selectedText: 'Selected source text',
    positions: [
      { source: 'pdf', pageNumber: 12, x: 0.2, y: 0.4 },
      { source: 'pdf', pageNumber: 13, x: 0.1, y: 0.2 },
    ],
    outlinePath: {
      source: 'pdf',
      pathKey: 'part-1>chapter-2>section-3',
      nodes: [
        { id: 'part-1', title: 'Part I', level: 0, pathKey: 'part-1' },
        { id: 'chapter-2', title: 'Chapter 2', level: 1, pathKey: 'part-1>chapter-2' },
        { id: 'section-3', title: 'Section 3', level: 2, pathKey: 'part-1>chapter-2>section-3' },
      ],
    },
  },
  outlinePath: {
    source: 'pdf',
    pathKey: 'part-1>chapter-2>section-3',
    nodes: [
      { id: 'part-1', title: 'Part I', level: 0, pathKey: 'part-1' },
      { id: 'chapter-2', title: 'Chapter 2', level: 1, pathKey: 'part-1>chapter-2' },
      { id: 'section-3', title: 'Section 3', level: 2, pathKey: 'part-1>chapter-2>section-3' },
    ],
  },
  locationStatus: 'resolved',
  createdAt: '2026-08-17T10:00:00.000Z',
  updatedAt: '2026-08-17T10:05:00.000Z',
})

test('annotation items require the right body fields by kind', () => {
  assert.throws(() =>
    normalizeReaderAnnotationItem({
      id: 'bad-kind',
      bookId: 1,
      selectionId: 'sel-1',
      kind: 'bad',
      text: 'Text',
      anchor: {
        version: 2,
        source: 'pdf',
        selectedText: 'Text',
        positions: [{ source: 'pdf', pageNumber: 1 }],
        outlinePath: null,
      },
      locationStatus: 'pending',
      createdAt: '2026-08-17T00:00:00.000Z',
      updatedAt: '2026-08-17T00:00:00.000Z',
    }),
  )

  assert.throws(() =>
    normalizeReaderAnnotationItem({
      id: 'missing-language',
      bookId: 1,
      selectionId: 'sel-1',
      kind: 'translation',
      text: 'Text',
      body: '译文',
      anchor: {
        version: 2,
        source: 'pdf',
        selectedText: 'Text',
        positions: [{ source: 'pdf', pageNumber: 1 }],
        outlinePath: null,
      },
      locationStatus: 'pending',
      createdAt: '2026-08-17T00:00:00.000Z',
      updatedAt: '2026-08-17T00:00:00.000Z',
    }),
  )

  assert.throws(() =>
    normalizeReaderAnnotationItem({
      id: 'empty-note',
      bookId: 1,
      selectionId: 'sel-1',
      kind: 'note',
      text: 'Text',
      body: '   ',
      anchor: {
        version: 2,
        source: 'epub',
        selectedText: 'Text',
        positions: [{ source: 'epub', chapterIndex: 1, blockOffset: 2 }],
        outlinePath: null,
      },
      locationStatus: 'pending',
      createdAt: '2026-08-17T00:00:00.000Z',
      updatedAt: '2026-08-17T00:00:00.000Z',
    }),
  )

  assert.throws(() =>
    normalizeReaderAnnotationItem({
      id: 'underline-body',
      bookId: 1,
      selectionId: 'sel-1',
      kind: 'underline',
      text: 'Text',
      body: 'not allowed',
      anchor: {
        version: 2,
        source: 'pdf',
        selectedText: 'Text',
        positions: [{ source: 'pdf', pageNumber: 1 }],
        outlinePath: null,
      },
      locationStatus: 'pending',
      createdAt: '2026-08-17T00:00:00.000Z',
      updatedAt: '2026-08-17T00:00:00.000Z',
    }),
  )
})

test('visual OCR underlines may persist while recognition text is unavailable', () => {
  const item = normalizeReaderAnnotationItem({
    id: 'visual-ocr',
    bookId: 1,
    selectionId: 'visual-selection',
    kind: 'underline',
    text: '',
    anchor: {
      version: 2,
      source: 'ocr',
      selectedText: '',
      positions: [{ source: 'ocr', pageNumber: 2, x: 0.2, y: 0.3, width: 0.4, height: 0.03 }],
      outlinePath: null,
      recognition: { status: 'error', engineVersion: 'tesseract-v3' },
    },
    locationStatus: 'page-only',
    createdAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:00.000Z',
  })

  assert.equal(item.text, '')
  assert.equal(item.anchor.recognition?.status, 'error')
  assert.throws(() =>
    normalizeReaderAnnotationItem({
      ...item,
      kind: 'translation',
      body: 'translation',
      translationLanguage: 'en-US',
    }),
  )
})

test('anchors round-trip single-page, cross-page, epub, and page-only positions', () => {
  const pdfAnchor = normalizeReaderAnchorV2({
    version: 2,
    source: 'pdf',
    selectedText: 'A PDF selection',
    positions: [
      { source: 'pdf', pageNumber: 3, x: 0.1, y: 0.2 },
      { source: 'pdf', pageNumber: 4, x: 0.3, y: 0.4 },
    ],
    outlinePath: null,
  })
  assert.equal(pdfAnchor.positions.length, 2)
  assert.deepEqual(
    pdfAnchor.positions.map((position) => position.pageNumber),
    [3, 4],
  )

  const epubAnchor = normalizeReaderAnchorV2({
    chapterIndex: 7,
    blockOffset: 2,
    startOffset: 11,
    endOffset: 21,
    text: 'EPUB selection',
    outlinePath: {
      source: 'epub',
      pathKey: 'ch-7>sec-2',
      nodes: [
        { id: 'ch-7', title: 'Chapter 7', level: 0, pathKey: 'ch-7' },
        { id: 'sec-2', title: 'Section 2', level: 1, pathKey: 'ch-7>sec-2' },
      ],
    },
  })
  assert.equal(epubAnchor.positions[0].chapterIndex, 7)
  assert.equal(epubAnchor.positions[0].blockOffset, 2)
  assert.equal(epubAnchor.positions[0].charStart, 11)
  assert.equal(epubAnchor.positions[0].charEnd, 21)

  const pageOnlyAnchor = convertLegacyReaderAnchorToV2({
    pageNumber: 9,
    text: 'Page only',
    areas: [{ x: 0.2, y: 0.3, width: 0.1, height: 0.05 }],
  })
  assert.equal(pageOnlyAnchor.positions[0].pageNumber, 9)
  assert.equal(pageOnlyAnchor.positions[0].x, 0.2)
  assert.equal(pageOnlyAnchor.positions[0].y, 0.3)
  assert.equal(pageOnlyAnchor.positions[0].width, 0.1)
  assert.equal(pageOnlyAnchor.positions[0].height, 0.05)

  const roundTrip = deserializeReaderAnnotationItem(serializeReaderAnnotationItem(baseItem))
  assert.deepEqual(
    roundTrip.anchor.positions.map((position) => position.pageNumber),
    [12, 13],
  )
  assert.equal(roundTrip.anchor.outlinePath?.pathKey, 'part-1>chapter-2>section-3')
})

test('export records preserve full outline paths and deep links', () => {
  const exportRecord = buildExportAnnotationRecord(baseItem)

  assert.equal(exportRecord.bookId, 42)
  assert.deepEqual(exportRecord.outlinePathTitles, ['Part I', 'Chapter 2', 'Section 3'])
  assert.equal(exportRecord.outlinePathKey, 'part-1>chapter-2>section-3')
  assert.deepEqual(exportRecord.pageNumbers, [12, 13])
  assert.equal(exportRecord.deepLink, 'book:42#annotation:ann-1')
})

test('annotation ordering prefers the earliest document position', () => {
  const first = normalizeReaderAnnotationItem({
    id: 'first',
    bookId: 1,
    selectionId: 'sel-a',
    kind: 'underline',
    text: 'First',
    anchor: {
      version: 2,
      source: 'pdf',
      selectedText: 'First',
      positions: [{ source: 'pdf', pageNumber: 1, y: 0.1, x: 0.2 }],
      outlinePath: null,
    },
    locationStatus: 'resolved',
    createdAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:00.000Z',
  })
  const second = normalizeReaderAnnotationItem({
    id: 'second',
    bookId: 1,
    selectionId: 'sel-b',
    kind: 'underline',
    text: 'Second',
    anchor: {
      version: 2,
      source: 'pdf',
      selectedText: 'Second',
      positions: [{ source: 'pdf', pageNumber: 2, y: 0.1, x: 0.2 }],
      outlinePath: null,
    },
    locationStatus: 'resolved',
    createdAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:00.000Z',
  })

  assert.equal(compareReaderAnnotationItems(first, second) < 0, true)
})
