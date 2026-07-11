import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getAnchorBlockOffset,
  getActiveTocIndex,
  getPageOfParagraph,
  getParagraphOffsetOfPage,
  getAnnotationEditorFocusOptions,
  getPagesForReadingBlocks,
  getPdfPageRenderWidth,
  getReadingProgressForLocation,
  getReaderContentGridColumns,
  isReadingBlockHeading,
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
  assert.equal(
    getReaderContentGridColumns(true, true, 260, false, 320),
    '260px minmax(0, 1fr) 0px',
  )
  assert.equal(
    getReaderContentGridColumns(false, true, 260, true, 280),
    '0px minmax(0, 1fr) 280px',
  )
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
  assert.equal(getPdfPageRenderWidth(1200, 'single'), 1040)
  assert.equal(getPdfPageRenderWidth(1200, 'scroll'), 1040)
  assert.equal(getPdfPageRenderWidth(1200, 'simulation'), 1040)
  assert.equal(getPdfPageRenderWidth(1200, 'dual'), 552)
  assert.equal(getPdfPageRenderWidth(640, 'single'), 560)
})

test('annotation editor focus does not scroll the reader', () => {
  assert.deepEqual(getAnnotationEditorFocusOptions(), { preventScroll: true })
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

test('anchor positions on a heading opening tag resolve to that heading block', () => {
  assert.equal(getAnchorBlockOffset(104, [100, 160, 220]), 0)
  assert.equal(getAnchorBlockOffset(180, [100, 160, 220]), 1)
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
