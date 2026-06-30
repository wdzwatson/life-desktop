import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getAnchorBlockOffset,
  getActiveTocIndex,
  getPageOfParagraph,
  getParagraphOffsetOfPage,
  getPagesForReadingBlocks,
  isReadingBlockHeading,
  resolveChapterTitleFromHtml,
  resolveReaderTocEntry,
  resolveTocTarget,
  type ReadingBlock,
  type TocEntry,
} from '../src/views/bookReaderUtils.ts'

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
