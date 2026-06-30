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

export type TocSourceEntry = {
  title: string
  hrefKey: string
  frag?: string
}

export type TocResolutionChapter = {
  title: string
  href: string
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
  const paragraphOffset = entry.frag && anchors[entry.frag] !== undefined ? anchors[entry.frag] : 0

  return {
    chapterIndex,
    paragraphOffset,
  }
}
