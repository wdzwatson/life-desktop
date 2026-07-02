export type ReadingBlock =
  | string
  | {
      type?: 'paragraph' | 'heading'
      text: string
      level?: number
    }

export type TocEntry = {
  title: string
  level: number
  chapterIndex: number
  paragraphOffset?: number
}

export type EpubLayoutMode = 'single' | 'dual' | 'scroll'
export type PdfLayoutMode = 'single' | 'dual' | 'scroll' | 'simulation'

export const shouldShowEpubToc = (
  isPdf: boolean,
  hasChapters: boolean,
  epubLayoutMode: EpubLayoutMode,
) => {
  void epubLayoutMode
  return !isPdf && hasChapters
}

export const getReaderContentGridColumns = (showEpubToc: boolean) => {
  void showEpubToc
  return 'minmax(0, 1fr)'
}

export const getPdfPageRenderWidth = (readerWidth: number, pdfLayoutMode: PdfLayoutMode) => {
  if (readerWidth <= 0) return 0

  if (pdfLayoutMode === 'dual') {
    return Math.round(Math.max(280, Math.min(560, (readerWidth - 96) / 2)))
  }

  return Math.round(Math.max(420, Math.min(1040, readerWidth - 80)))
}

export const getAnnotationEditorFocusOptions = () => ({ preventScroll: true })

export const shouldCloseReaderDrawersOnContentClick = (selectedText: string) => {
  return selectedText.trim().length === 0
}

export type TocSourceEntry = {
  title: string
  hrefKey: string
  frag?: string
  level?: number
}

export type TocResolutionChapter = {
  title: string
  href: string
  paragraphs?: ReadingBlock[]
}

export type ReaderTocChapter = {
  title: string
  paragraphs?: ReadingBlock[]
}

export const getReadingBlockText = (block: ReadingBlock) =>
  typeof block === 'string' ? block : block.text

export const isReadingBlockHeading = (block: ReadingBlock | undefined) =>
  typeof block === 'object' && block?.type === 'heading'

export const getPagesForReadingBlocks = (blocks: ReadingBlock[]) => {
  const pages: ReadingBlock[][] = []
  let currentPage: ReadingBlock[] = []
  let currentLength = 0

  blocks.forEach((block) => {
    const text = getReadingBlockText(block)
    currentPage.push(block)
    currentLength += text.length
    if (currentLength >= 1000 || currentPage.length >= 6) {
      pages.push(currentPage)
      currentPage = []
      currentLength = 0
    }
  })

  if (currentPage.length > 0) {
    pages.push(currentPage)
  }
  return pages.length > 0 ? pages : [[]]
}

export const getPageOfParagraph = (blocks: ReadingBlock[], paraIdx: number) => {
  let page = 0
  let currentCount = 0
  let currentLength = 0

  for (let i = 0; i < blocks.length; i++) {
    if (i === paraIdx) return page
    currentCount++
    currentLength += getReadingBlockText(blocks[i]).length
    if (currentLength >= 1000 || currentCount >= 6) {
      page++
      currentCount = 0
      currentLength = 0
    }
  }
  return page
}

export const getParagraphOffsetOfPage = (blocks: ReadingBlock[], pageIdx: number) => {
  let page = 0
  let currentCount = 0
  let currentLength = 0

  for (let i = 0; i < blocks.length; i++) {
    if (page === pageIdx) return i
    currentCount++
    currentLength += getReadingBlockText(blocks[i]).length
    if (currentLength >= 1000 || currentCount >= 6) {
      page++
      currentCount = 0
      currentLength = 0
    }
  }

  return Math.max(0, blocks.length - 1)
}

export const getReadingProgressForLocation = (
  chapters: ReaderTocChapter[],
  chapterIndex: number,
  paragraphOffset: number,
) => {
  if (chapters.length === 0) return 0

  const pageCounts = chapters.map((chapter) =>
    getPagesForReadingBlocks(chapter.paragraphs || []).length,
  )
  const totalPages = pageCounts.reduce((sum, count) => sum + count, 0)
  if (totalPages <= 1) return 100

  const safeChapterIndex = Math.max(0, Math.min(chapterIndex, chapters.length - 1))
  const previousPages = pageCounts
    .slice(0, safeChapterIndex)
    .reduce((sum, count) => sum + count, 0)
  const chapterBlocks = chapters[safeChapterIndex].paragraphs || []
  const localPageIndex = getPageOfParagraph(chapterBlocks, paragraphOffset)
  const safeLocalPageIndex = Math.max(
    0,
    Math.min(localPageIndex, Math.max(0, pageCounts[safeChapterIndex] - 1)),
  )

  return Math.round(((previousPages + safeLocalPageIndex) / (totalPages - 1)) * 100)
}

export const getActiveTocIndex = (
  tocList: TocEntry[],
  currentChapterIndex: number,
  currentParagraphOffset: number,
) => {
  let activeIdx = 0

  for (let i = 0; i < tocList.length; i++) {
    const entry = tocList[i]
    if (
      entry.chapterIndex < currentChapterIndex ||
      (entry.chapterIndex === currentChapterIndex &&
        (entry.paragraphOffset || 0) <= currentParagraphOffset)
    ) {
      activeIdx = i
    } else if (entry.chapterIndex > currentChapterIndex) {
      break
    }
  }

  return activeIdx
}

export const resolveReaderTocEntry = <T extends TocEntry>(
  entry: T,
  chapters: ReaderTocChapter[],
) => {
  const entryTitle = normalizeTocTitle(entry.title)
  const currentTitle = normalizeTocTitle(chapters[entry.chapterIndex]?.title || '')

  if (entry.level > 0 && (entry.paragraphOffset || 0) === 0 && currentTitle !== entryTitle) {
    const repairedIndex = chapters.findIndex(
      (chapter, index) => index >= entry.chapterIndex && normalizeTocTitle(chapter.title) === entryTitle,
    )
    if (repairedIndex >= 0) {
      return {
        ...entry,
        chapterIndex: repairedIndex,
        paragraphOffset: 0,
      }
    }
  }

  return entry
}

export const getAnchorBlockOffset = (anchorPosition: number, blockOffsets: number[]) => {
  if (blockOffsets.length === 0) return 0
  if (anchorPosition <= blockOffsets[0]) return 0

  for (let i = 0; i < blockOffsets.length; i++) {
    const current = blockOffsets[i]
    const next = blockOffsets[i + 1]
    if (anchorPosition >= current && (next === undefined || anchorPosition < next)) {
      return i
    }
  }

  return blockOffsets.length - 1
}

export const normalizeTocTitle = (title: string) => {
  return title
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim()
}

export const decodeHtmlText = (raw: string) =>
  raw
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .trim()

export const resolveChapterTitleFromHtml = (
  htmlContent: string,
  tocTitle: string | undefined,
  fallbackTitle: string,
) => {
  if (tocTitle?.trim()) return decodeHtmlText(tocTitle)

  const headingMatch = htmlContent.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i)
  if (headingMatch) {
    const headingTitle = decodeHtmlText(headingMatch[1])
    if (headingTitle) return headingTitle
  }

  const titleMatch = htmlContent.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (titleMatch) {
    const htmlTitle = decodeHtmlText(titleMatch[1])
    if (htmlTitle) return htmlTitle
  }

  return fallbackTitle
}

const findHeadingTarget = (
  chapters: TocResolutionChapter[],
  title: string,
  startIndex: number,
) => {
  const normTitle = normalizeTocTitle(title)

  for (let chapterIndex = Math.max(0, startIndex); chapterIndex < chapters.length; chapterIndex++) {
    const headingIndex = chapters[chapterIndex].paragraphs?.findIndex(
      (block) => isReadingBlockHeading(block) && normalizeTocTitle(getReadingBlockText(block)) === normTitle,
    )
    if (headingIndex !== undefined && headingIndex >= 0) {
      return {
        chapterIndex,
        paragraphOffset: headingIndex,
        hrefKey: chapters[chapterIndex].href,
      }
    }
  }

  return null
}

export const resolveTocTarget = (
  entry: TocSourceEntry,
  chapters: TocResolutionChapter[],
  chapterIndexByHref: Record<string, number>,
  anchorParaByHref: Record<string, Record<string, number>>,
) => {
  const hrefIndex = chapterIndexByHref[entry.hrefKey]
  let chapterIndex = hrefIndex
  let resolvedHrefKey = entry.hrefKey
  const normTocTitle = normalizeTocTitle(entry.title)

  if (typeof hrefIndex === 'number' && !entry.frag) {
    const hrefTitle = normalizeTocTitle(chapters[hrefIndex]?.title || '')
    if (hrefTitle !== normTocTitle) {
      const headingTarget = findHeadingTarget(chapters, entry.title, hrefIndex)
      if (headingTarget) {
        return {
          chapterIndex: headingTarget.chapterIndex,
          paragraphOffset: headingTarget.paragraphOffset,
        }
      }

      const laterMatchIndex = chapters.findIndex(
        (chapter, index) => index >= hrefIndex && normalizeTocTitle(chapter.title) === normTocTitle,
      )
      if (laterMatchIndex >= 0) {
        chapterIndex = laterMatchIndex
        resolvedHrefKey = chapters[laterMatchIndex]?.href || resolvedHrefKey
      }
    }
  }

  if (typeof chapterIndex !== 'number') {
    const matchingIndices = chapters
      .map((chapter, index) => ({ chapter, index }))
      .filter(({ chapter }) => normalizeTocTitle(chapter.title) === normTocTitle)
      .map(({ index }) => index)

    if (matchingIndices.length === 1) {
      chapterIndex = matchingIndices[0]
      resolvedHrefKey = chapters[chapterIndex]?.href || resolvedHrefKey
    }
  }

  const anchors = anchorParaByHref[resolvedHrefKey] || {}
  let paragraphOffset = entry.frag && anchors[entry.frag] !== undefined ? anchors[entry.frag] : 0

  if (!entry.frag && typeof chapterIndex === 'number' && paragraphOffset === 0) {
    const headingTarget = findHeadingTarget(chapters, entry.title, chapterIndex)
    if (headingTarget && headingTarget.chapterIndex === chapterIndex && headingTarget.paragraphOffset > 0) {
      paragraphOffset = headingTarget.paragraphOffset
    }
  }

  return {
    chapterIndex,
    paragraphOffset,
  }
}
