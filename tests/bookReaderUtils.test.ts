import assert from 'node:assert/strict'
import test from 'node:test'
import {
  compareReaderHighlightsByDocumentPosition,
  getAnchorBlockOffset,
  getActiveTocIndex,
  getReaderAnnotationKind,
  getPageOfParagraph,
  getParagraphOffsetOfPage,
  getAnnotationEditorFocusOptions,
  getPagesForReadingBlocks,
  getPdfPageIndexAtOffset,
  getPdfPageRenderWidth,
  getReadingProgressForLocation,
  getReaderContentGridColumns,
  getReaderHighlightPdfPageAreas,
  getReaderTextSegments,
  isReadingBlockHeading,
  mergePdfSelectionAreas,
  decodeHtmlText,
  normalizeTocTitle,
  parseReaderHighlightAnchor,
  resolveChapterTitleFromHtml,
  resolveReaderTocEntry,
  resolveTocTarget,
  shouldCloseReaderDrawersOnContentClick,
  shouldShowEpubToc,
  type ReadingBlock,
  type TocEntry,
} from '../src/views/bookReaderUtils.ts'

test('EPUB TOC drawer is available for EPUB chapters', () => {
  assert.equal(shouldShowEpubToc(false, true, 'single'), true)
  assert.equal(shouldShowEpubToc(false, true, 'scroll'), true)
  assert.equal(shouldShowEpubToc(false, true, 'dual'), true)
  assert.equal(shouldShowEpubToc(true, true, 'single'), false)
  assert.equal(shouldShowEpubToc(false, false, 'single'), false)
})

test('reader content grid reserves space only for open side drawers', () => {
  assert.equal(getReaderContentGridColumns(true), '0px minmax(0, 1fr) 0px')
  assert.equal(getReaderContentGridColumns(false), '0px minmax(0, 1fr) 0px')
  assert.equal(getReaderContentGridColumns(true, true, 260, false, 320), '260px minmax(0, 1fr) 0px')
  assert.equal(getReaderContentGridColumns(false, true, 260, true, 280), '0px minmax(0, 1fr) 280px')
  assert.equal(
    getReaderContentGridColumns(true, true, 240, true, 300),
    '240px minmax(0, 1fr) 300px',
  )
})

test('reader content grid can keep side columns reserved while drawers are closed', () => {
  assert.equal(
    getReaderContentGridColumns(true, false, 260, false, 320, true),
    '260px minmax(0, 1fr) 320px',
  )
  assert.equal(
    getReaderContentGridColumns(false, false, 260, false, 320, true),
    '0px minmax(0, 1fr) 320px',
  )
})

test('reader content grid can enforce a minimum reading column width', () => {
  assert.equal(
    getReaderContentGridColumns(true, false, 260, false, 320, true, 640),
    '260px minmax(640px, 1fr) 320px',
  )
  assert.equal(
    getReaderContentGridColumns(true, true, 260, true, 320, false, 720),
    '260px minmax(720px, 1fr) 320px',
  )
})

test('PDF page render width uses more of the reader column', () => {
  assert.equal(getPdfPageRenderWidth(1600, 'single'), 1280)
  assert.equal(getPdfPageRenderWidth(1600, 'scroll'), 1280)
  assert.equal(getPdfPageRenderWidth(1600, 'dual'), 620)
  assert.equal(getPdfPageRenderWidth(640, 'single'), 528)
})

test('PDF continuous scroll locates the active page with ordered page offsets', () => {
  const pages = [0, 920, 1840, 2760, 3680].map((offsetTop) => ({ offsetTop }))

  assert.equal(getPdfPageIndexAtOffset(pages, -20), 0)
  assert.equal(getPdfPageIndexAtOffset(pages, 0), 0)
  assert.equal(getPdfPageIndexAtOffset(pages, 1839), 1)
  assert.equal(getPdfPageIndexAtOffset(pages, 1840), 2)
  assert.equal(getPdfPageIndexAtOffset(pages, 9999), 4)
  assert.equal(getPdfPageIndexAtOffset([], 100), 0)

  let offsetReads = 0
  const largeDocument = new Proxy({ length: 100_000 } as ArrayLike<{ offsetTop: number }>, {
    get(target, property) {
      if (typeof property === 'string' && /^\d+$/.test(property)) {
        offsetReads += 1
        return { offsetTop: Number(property) * 100 }
      }
      return Reflect.get(target, property)
    },
  })
  assert.equal(getPdfPageIndexAtOffset(largeDocument, 5_432_150), 54_321)
  assert.ok(offsetReads <= 18)
})

test('PDF selection areas merge same-line fragments across spaces and font metrics', () => {
  const merged = mergePdfSelectionAreas([
    { x: 0.1, y: 0.2, width: 0.04, height: 0.03 },
    { x: 0.18, y: 0.195, width: 0.08, height: 0.04 },
    { x: 0.3, y: 0.2, width: 0.05, height: 0.03 },
  ])

  assert.equal(merged.length, 1)
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(merged[0]).map(([key, value]) => [key, Number(value.toFixed(3))]),
    ),
    { x: 0.1, y: 0.195, width: 0.25, height: 0.04 },
  )
})

test('PDF selection area merging preserves separate visual lines', () => {
  const merged = mergePdfSelectionAreas([
    { x: 0.1, y: 0.2, width: 0.2, height: 0.02 },
    { x: 0.1, y: 0.25, width: 0.3, height: 0.02 },
  ])

  assert.equal(merged.length, 2)
  assert.deepEqual(
    merged.map((area) => area.y),
    [0.2, 0.25],
  )
})

test('annotation editor focus does not scroll the reader', () => {
  assert.deepEqual(getAnnotationEditorFocusOptions(), { preventScroll: true })
})

test('reader annotations retain explicit kinds and classify legacy rows safely', () => {
  assert.equal(
    getReaderAnnotationKind({
      id: 'translation',
      text: 'Source',
      annotation: '译文',
      anchor: JSON.stringify({ pageNumber: 1, kind: 'translation' }),
    }),
    'translation',
  )
  assert.equal(getReaderAnnotationKind({ id: 'note', text: 'Source', annotation: 'Note' }), 'note')
  assert.equal(
    getReaderAnnotationKind({ id: 'legacy-empty', text: 'Source', annotation: 'No annotations' }),
    'highlight',
  )
})

test('reader annotations sort by page or chapter block before creation order', () => {
  const pdfRows = [
    {
      id: 'page-two',
      text: 'Page 2',
      anchor: JSON.stringify({
        pageNumber: 2,
        areas: [{ x: 0.1, y: 0.1, width: 0.2, height: 0.05 }],
      }),
    },
    {
      id: 'page-one-lower',
      text: 'Lower',
      anchor: JSON.stringify({
        pageNumber: 1,
        areas: [{ x: 0.1, y: 0.8, width: 0.2, height: 0.05 }],
      }),
    },
    {
      id: 'page-one-upper',
      text: 'Upper',
      anchor: JSON.stringify({
        pageNumber: 1,
        areas: [{ x: 0.1, y: 0.2, width: 0.2, height: 0.05 }],
      }),
    },
  ].sort(compareReaderHighlightsByDocumentPosition)
  assert.deepEqual(
    pdfRows.map((row) => row.id),
    ['page-one-upper', 'page-one-lower', 'page-two'],
  )

  const epubRows = [
    {
      id: 'second-block',
      text: 'Second',
      anchor: JSON.stringify({ chapterIndex: 0, blockOffset: 4 }),
    },
    {
      id: 'next-chapter',
      text: 'Next',
      anchor: JSON.stringify({ chapterIndex: 1, blockOffset: 0 }),
    },
    {
      id: 'first-block',
      text: 'First',
      anchor: JSON.stringify({ chapterIndex: 0, blockOffset: 1 }),
    },
  ].sort(compareReaderHighlightsByDocumentPosition)
  assert.deepEqual(
    epubRows.map((row) => row.id),
    ['first-block', 'second-block', 'next-chapter'],
  )
})

test('reader highlights resolve precise character anchors and legacy text matches', () => {
  const precise = getReaderTextSegments(
    'Alpha beta gamma',
    [
      {
        id: 'precise',
        text: 'beta',
        annotation: 'note',
        anchor: JSON.stringify({ chapterIndex: 0, blockOffset: 2, startOffset: 6, endOffset: 10 }),
      },
    ],
    0,
    2,
    'Chapter',
  )
  assert.deepEqual(
    precise.map((segment) => [segment.text, segment.highlight?.id]),
    [
      ['Alpha ', undefined],
      ['beta', 'precise'],
      [' gamma', undefined],
    ],
  )

  const legacy = getReaderTextSegments(
    'Legacy selection remains visible',
    [{ id: 'legacy', text: 'selection', anchor: JSON.stringify({ chapter: 'Chapter' }) }],
    0,
    0,
    'Chapter',
  )
  assert.equal(legacy.find((segment) => segment.highlight)?.text, 'selection')
})

test('EPUB ranges combine co-located notes and underlines while hiding translations', () => {
  const segments = getReaderTextSegments(
    'Alpha beta gamma',
    [
      {
        id: 'underline',
        text: 'beta',
        anchor: JSON.stringify({
          chapterIndex: 0,
          blockOffset: 2,
          startOffset: 6,
          endOffset: 10,
          kind: 'highlight',
        }),
      },
      {
        id: 'note',
        text: 'beta',
        annotation: 'Note',
        anchor: JSON.stringify({
          chapterIndex: 0,
          blockOffset: 2,
          startOffset: 6,
          endOffset: 10,
          kind: 'note',
        }),
      },
      {
        id: 'translation',
        text: 'beta',
        annotation: '贝塔',
        anchor: JSON.stringify({
          chapterIndex: 0,
          blockOffset: 2,
          startOffset: 6,
          endOffset: 10,
          kind: 'translation',
        }),
      },
    ],
    0,
    2,
    'Chapter',
  )

  const marked = segments.find((segment) => segment.highlight)
  assert.equal(marked?.text, 'beta')
  assert.deepEqual(
    marked?.highlights?.map((highlight) => highlight.id),
    ['underline', 'note'],
  )
  assert.equal(marked?.highlight?.id, 'note')
})

test('PDF highlight anchors are not matched into EPUB paragraphs', () => {
  const segments = getReaderTextSegments(
    'PDF text',
    [
      {
        id: 'pdf',
        text: 'PDF',
        anchor: JSON.stringify({ pageNumber: 2, areas: [{ x: 0, y: 0, width: 1, height: 1 }] }),
      },
    ],
    0,
    0,
    'Chapter',
  )
  assert.deepEqual(segments, [{ text: 'PDF text' }])
})

test('Anchor v2 restores PDF rectangles and EPUB character offsets for presentation', () => {
  assert.deepEqual(
    parseReaderHighlightAnchor(
      JSON.stringify({
        version: 2,
        source: 'pdf',
        positions: [
          { source: 'pdf', pageNumber: 4, x: 0.1, y: 0.2, width: 0.3, height: 0.04 },
        ],
        highlighted: true,
      }),
    ),
    {
      source: 'pdf',
      pageNumber: 4,
      areas: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.04 }],
      highlighted: true,
    },
  )
  assert.deepEqual(
    parseReaderHighlightAnchor({
      version: 2,
      source: 'epub',
      positions: [
        {
          source: 'epub',
          chapterIndex: 2,
          blockOffset: 5,
          charStart: 7,
          charEnd: 12,
        },
      ],
      outlinePath: null,
    } as any),
    { source: 'epub', chapterIndex: 2, blockOffset: 5, startOffset: 7, endOffset: 12 },
  )
})

test('Anchor v2 exposes every PDF page rectangle for cross-page overlays', () => {
  assert.deepEqual(
    getReaderHighlightPdfPageAreas(
      JSON.stringify({
        version: 2,
        source: 'pdf',
        positions: [
          { source: 'pdf', pageNumber: 2, x: 0.2, y: 0.8, width: 0.5, height: 0.04 },
          { source: 'pdf', pageNumber: 3, x: 0.1, y: 0.1, width: 0.4, height: 0.04 },
        ],
      }),
    ),
    [
      { pageNumber: 2, areas: [{ x: 0.2, y: 0.8, width: 0.5, height: 0.04 }] },
      { pageNumber: 3, areas: [{ x: 0.1, y: 0.1, width: 0.4, height: 0.04 }] },
    ],
  )
})

test('content clicks close drawers only when no text is selected', () => {
  assert.equal(shouldCloseReaderDrawersOnContentClick(''), true)
  assert.equal(shouldCloseReaderDrawersOnContentClick('   '), true)
  assert.equal(shouldCloseReaderDrawersOnContentClick('selected text'), false)
})

test('active TOC can distinguish secondary headings on the same rendered page', () => {
  const toc: TocEntry[] = [
    { title: 'Chapter', level: 0, chapterIndex: 0, paragraphOffset: 0 },
    { title: 'Section 1', level: 1, chapterIndex: 0, paragraphOffset: 1 },
    { title: 'Section 2', level: 1, chapterIndex: 0, paragraphOffset: 3 },
  ]

  assert.equal(getActiveTocIndex(toc, 0, 1), 1)
  assert.equal(getActiveTocIndex(toc, 0, 3), 2)
})

test('pagination helpers use heading blocks as addressable reading positions', () => {
  const blocks: ReadingBlock[] = [
    { type: 'heading', level: 1, text: 'Chapter' },
    'Intro paragraph',
    { type: 'heading', level: 2, text: 'Section' },
    'Body paragraph',
  ]

  assert.equal(isReadingBlockHeading(blocks[0]), true)
  assert.equal(getPagesForReadingBlocks(blocks).length, 1)
  assert.equal(getPageOfParagraph(blocks, 2), 0)
  assert.equal(getParagraphOffsetOfPage(blocks, 0), 0)
})

test('reading progress is derived from EPUB chapter and paragraph position', () => {
  const longChapter = Array.from({ length: 7 }, (_, idx) => `paragraph ${idx + 1}`)
  const chapters = [
    { title: 'Chapter 1', paragraphs: longChapter },
    { title: 'Chapter 2', paragraphs: longChapter },
  ]

  assert.equal(getReadingProgressForLocation(chapters, 0, 0), 0)
  assert.equal(getReadingProgressForLocation(chapters, 1, 0), 67)
  assert.equal(getReadingProgressForLocation(chapters, 1, 6), 100)
})

test('reading progress clamps out-of-range chapter and paragraph positions', () => {
  const chapters = [
    { title: 'Chapter 1', paragraphs: ['Intro'] },
    {
      title: 'Chapter 2',
      paragraphs: Array.from({ length: 7 }, (_, idx) => `paragraph ${idx + 1}`),
    },
  ]

  assert.equal(getReadingProgressForLocation(chapters, -4, 0), 0)
  assert.equal(getReadingProgressForLocation(chapters, 99, 99), 100)
})

test('anchor positions on a heading opening tag resolve to that heading block', () => {
  assert.equal(getAnchorBlockOffset(104, [100, 160, 220]), 0)
  assert.equal(getAnchorBlockOffset(180, [100, 160, 220]), 1)
})

test('HTML and TOC text normalization strips markup, entities, spacing, and case', () => {
  assert.equal(normalizeTocTitle('  Go&nbsp;语言 &amp; TypeScript  '), 'go 语言 & typescript')
  assert.equal(
    decodeHtmlText('<span>Go&nbsp;语言</span> &amp; <strong>TypeScript</strong> &#39;notes&#39;'),
    "Go 语言 & TypeScript 'notes'",
  )
})

test('TOC target resolution prefers href over same-title matches in other chapters', () => {
  const target = resolveTocTarget(
    { title: 'Shared section', hrefKey: 'chapter-1.xhtml', frag: 'sec-2' },
    [
      { title: 'Shared section', href: 'preface.xhtml' },
      { title: 'Chapter 1', href: 'chapter-1.xhtml' },
    ],
    { 'preface.xhtml': 0, 'chapter-1.xhtml': 1 },
    { 'chapter-1.xhtml': { 'sec-2': 4 } },
  )

  assert.deepEqual(target, { chapterIndex: 1, paragraphOffset: 4 })
})

test('TOC target resolution can repair split-file child entries with missing fragments', () => {
  const target = resolveTocTarget(
    { title: 'Go语言项目', hrefKey: 'part0004_split_000.html', frag: '' },
    [
      { title: '前言', href: 'part0004_split_000.html' },
      { title: 'Go语言起源', href: 'part0004_split_001.html' },
      { title: 'Go语言项目', href: 'part0004_split_002.html' },
    ],
    {
      'part0004_split_000.html': 0,
      'part0004_split_001.html': 1,
      'part0004_split_002.html': 2,
    },
    {},
  )

  assert.deepEqual(target, { chapterIndex: 2, paragraphOffset: 0 })
})

test('TOC target resolution can locate deeper same-file headings without fragments', () => {
  const target = resolveTocTarget(
    { title: 'Deep Section', hrefKey: 'chapter.xhtml', frag: '', level: 3 },
    [
      {
        title: 'Chapter',
        href: 'chapter.xhtml',
        paragraphs: [
          { type: 'heading', level: 1, text: 'Chapter' },
          'Intro',
          { type: 'heading', level: 2, text: 'Section' },
          'Section body',
          { type: 'heading', level: 3, text: 'Deep Section' },
          'Deep body',
        ],
      },
    ],
    { 'chapter.xhtml': 0 },
    {},
  )

  assert.deepEqual(target, { chapterIndex: 0, paragraphOffset: 4 })
})

test('TOC target resolution can repair stale hrefs to deeper headings in later split files', () => {
  const target = resolveTocTarget(
    { title: '2.3.2. 指针', hrefKey: 'part0006_split_000.html', frag: '', level: 2 },
    [
      {
        title: '第二章 程序结构',
        href: 'part0006_split_000.html',
        paragraphs: [{ type: 'heading', level: 1, text: '第二章 程序结构' }, 'Intro'],
      },
      {
        title: '2.1. 命名',
        href: 'part0006_split_001.html',
        paragraphs: [{ type: 'heading', level: 2, text: '2.1. 命名' }, 'Naming body'],
      },
      {
        title: '2.3. 变量',
        href: 'part0006_split_003.html',
        paragraphs: [
          { type: 'heading', level: 2, text: '2.3. 变量' },
          'Variable body',
          { type: 'heading', level: 3, text: '2.3.1. 简短变量声明' },
          'Short declarations',
          { type: 'heading', level: 3, text: '2.3.2. 指针' },
          'Pointer body',
        ],
      },
    ],
    {
      'part0006_split_000.html': 0,
      'part0006_split_001.html': 1,
      'part0006_split_003.html': 2,
    },
    {},
  )

  assert.deepEqual(target, { chapterIndex: 2, paragraphOffset: 4 })
})

test('reader TOC click repairs stale backend entries that still point at parent chapter', () => {
  const target = resolveReaderTocEntry(
    { title: 'Go语言项目', level: 1, chapterIndex: 0, paragraphOffset: 0 },
    [
      { title: '前言', paragraphs: [] },
      { title: 'Go语言起源', paragraphs: [] },
      { title: 'Go语言项目', paragraphs: [] },
    ],
  )

  assert.deepEqual(target, { title: 'Go语言项目', level: 1, chapterIndex: 2, paragraphOffset: 0 })
})

test('chapter title resolution falls back to the first heading when HTML title is reused', () => {
  const html = `
    <html>
      <head><title>前言</title></head>
      <body>
        <div id="前言">
          <div>
            <h2 class="calibre2">Go语言起源</h2>
            <p>正文</p>
          </div>
        </div>
      </body>
    </html>
  `

  assert.equal(resolveChapterTitleFromHtml(html, '', 'Chapter 2'), 'Go语言起源')
})
