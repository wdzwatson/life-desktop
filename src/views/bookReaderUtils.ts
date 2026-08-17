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
export type PdfLayoutMode = 'single' | 'dual' | 'scroll'
export type ReaderAnnotationKind = 'translation' | 'highlight' | 'note'

export type PdfSelectionArea = {
  x: number
  y: number
  width: number
  height: number
}

export const mergePdfSelectionAreas = (areas: PdfSelectionArea[]): PdfSelectionArea[] => {
  const validAreas = areas
    .filter(
      (area) =>
        Number.isFinite(area.x) &&
        Number.isFinite(area.y) &&
        Number.isFinite(area.width) &&
        Number.isFinite(area.height) &&
        area.width > 0 &&
        area.height > 0,
    )
    .map((area) => ({ ...area }))
    .sort(
      (left, right) => left.y + left.height / 2 - (right.y + right.height / 2) || left.x - right.x,
    )

  if (validAreas.length < 2) return validAreas

  const heights = validAreas.map((area) => area.height).sort((left, right) => left - right)
  const medianHeight = heights[Math.floor(heights.length / 2)]
  const lineTolerance = Math.min(0.035, Math.max(0.004, medianHeight * 0.65))
  const rows: Array<{ area: PdfSelectionArea; centerY: number; count: number }> = []

  validAreas.forEach((area) => {
    const centerY = area.y + area.height / 2
    const row = rows[rows.length - 1]
    const verticalOverlap = row
      ? Math.min(row.area.y + row.area.height, area.y + area.height) -
        Math.max(row.area.y, area.y)
      : 0
    const overlapRatio = row ? verticalOverlap / Math.min(row.area.height, area.height) : 0
    const sameLine =
      row &&
      (Math.abs(row.centerY - centerY) <= lineTolerance || overlapRatio >= 0.55)

    if (!row || !sameLine) {
      rows.push({ area, centerY, count: 1 })
      return
    }

    const current = row.area
    const left = Math.min(current.x, area.x)
    const right = Math.max(current.x + current.width, area.x + area.width)
    const top = Math.min(current.y, area.y)
    const bottom = Math.max(current.y + current.height, area.y + area.height)
    row.area = { x: left, y: top, width: right - left, height: bottom - top }
    row.centerY = (row.centerY * row.count + centerY) / (row.count + 1)
    row.count += 1
  })

  return rows.map((row) => row.area).sort((left, right) => left.y - right.y || left.x - right.x)
}

export type ReaderHighlightAnchor = {
  source?: 'pdf' | 'ocr' | 'epub' | 'unknown'
  version?: 2
  selectedText?: string
  positions?: Array<{
    source?: 'pdf' | 'ocr' | 'epub' | 'unknown'
    pageNumber?: number
    chapterIndex?: number
    blockOffset?: number
    charStart?: number
    charEnd?: number
    x?: number
    y?: number
    width?: number
    height?: number
  }>
  outlinePath?: unknown
  chapter?: string
  chapterIndex?: number
  blockOffset?: number
  startOffset?: number
  endOffset?: number
  pageNumber?: number
  areas?: Array<{ x: number; y: number; width: number; height: number }>
  highlighted?: boolean
  kind?: ReaderAnnotationKind
}

export type ReaderHighlight = {
  id: string
  text: string
  annotation?: string
  kind?: ReaderAnnotationKind | 'underline'
  anchor?: string | ReaderHighlightAnchor | null
  created_at?: string
}

export type ReaderTextSegment = {
  text: string
  highlight?: ReaderHighlight
  highlights?: ReaderHighlight[]
}

const normalizeParsedReaderHighlightAnchor = (value: unknown): ReaderHighlightAnchor | null => {
  if (!value || typeof value !== 'object') return null
  const parsed = value as Record<string, unknown>
  if (parsed.version !== 2 || !Array.isArray(parsed.positions)) {
    return parsed as ReaderHighlightAnchor
  }
  const positions = parsed.positions.filter(
    (position): position is Record<string, unknown> =>
      Boolean(position) && typeof position === 'object' && !Array.isArray(position),
  )
  const first = positions[0]
  if (!first) return null
  const pageNumber = Number.isInteger(first.pageNumber) ? Number(first.pageNumber) : undefined
  const areas =
    pageNumber === undefined
      ? undefined
      : positions
          .filter((position) => position.pageNumber === pageNumber)
          .flatMap((position) => {
            const area = {
              x: Number(position.x),
              y: Number(position.y),
              width: Number(position.width),
              height: Number(position.height),
            }
            return Object.values(area).every(Number.isFinite) && area.width > 0 && area.height > 0
              ? [area]
              : []
          })
  return {
    ...(typeof parsed.source === 'string'
      ? { source: parsed.source as ReaderHighlightAnchor['source'] }
      : {}),
    ...(pageNumber !== undefined ? { pageNumber } : {}),
    ...(areas?.length ? { areas } : {}),
    ...(Number.isInteger(first.chapterIndex) ? { chapterIndex: Number(first.chapterIndex) } : {}),
    ...(Number.isInteger(first.blockOffset) ? { blockOffset: Number(first.blockOffset) } : {}),
    ...(Number.isInteger(first.charStart) ? { startOffset: Number(first.charStart) } : {}),
    ...(Number.isInteger(first.charEnd) ? { endOffset: Number(first.charEnd) } : {}),
    ...(parsed.highlighted === undefined ? {} : { highlighted: Boolean(parsed.highlighted) }),
  }
}

const parseReaderHighlightAnchorValue = (anchor: ReaderHighlight['anchor']): unknown => {
  if (typeof anchor !== 'string') return anchor
  try {
    return JSON.parse(anchor)
  } catch {
    return null
  }
}

export const parseReaderHighlightAnchor = (anchor: ReaderHighlight['anchor']) => {
  if (!anchor) return null
  return normalizeParsedReaderHighlightAnchor(parseReaderHighlightAnchorValue(anchor))
}

export const getReaderHighlightPdfPageAreas = (anchor: ReaderHighlight['anchor']) => {
  const raw = parseReaderHighlightAnchorValue(anchor)
  if (raw && typeof raw === 'object') {
    const parsed = raw as Record<string, unknown>
    if (parsed.version === 2 && Array.isArray(parsed.positions)) {
      const byPage = new Map<number, PdfSelectionArea[]>()
      parsed.positions.forEach((position) => {
        if (!position || typeof position !== 'object' || Array.isArray(position)) return
        const candidate = position as Record<string, unknown>
        const pageNumber = Number(candidate.pageNumber)
        const area = {
          x: Number(candidate.x),
          y: Number(candidate.y),
          width: Number(candidate.width),
          height: Number(candidate.height),
        }
        if (
          !Number.isInteger(pageNumber) ||
          pageNumber < 1 ||
          !Object.values(area).every(Number.isFinite) ||
          area.width <= 0 ||
          area.height <= 0
        ) {
          return
        }
        const areas = byPage.get(pageNumber) || []
        areas.push(area)
        byPage.set(pageNumber, areas)
      })
      return Array.from(byPage, ([pageNumber, areas]) => ({ pageNumber, areas }))
    }
  }
  const legacy = normalizeParsedReaderHighlightAnchor(raw)
  return Number.isInteger(legacy?.pageNumber) && legacy?.areas?.length
    ? [{ pageNumber: legacy.pageNumber as number, areas: legacy.areas }]
    : []
}

const isReaderAnnotationKind = (value: unknown): value is ReaderAnnotationKind =>
  value === 'translation' || value === 'highlight' || value === 'note'

export const getReaderAnnotationKind = (highlight: ReaderHighlight): ReaderAnnotationKind => {
  if (highlight.kind === 'underline') return 'highlight'
  if (isReaderAnnotationKind(highlight.kind)) return highlight.kind
  const anchor = parseReaderHighlightAnchor(highlight.anchor)
  if (isReaderAnnotationKind(anchor?.kind)) return anchor.kind

  const annotation = String(highlight.annotation ?? '').trim()
  const hasAnnotation =
    annotation.length > 0 && annotation !== '无批注记录' && annotation !== 'No annotations'
  return hasAnnotation ? 'note' : 'highlight'
}

const getReaderHighlightDocumentPosition = (highlight: ReaderHighlight) => {
  const anchor = parseReaderHighlightAnchor(highlight.anchor)
  if (!anchor) return [1, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]

  if (Number.isInteger(anchor.pageNumber)) {
    const firstArea = [...(anchor.areas || [])].sort(
      (left, right) => left.y - right.y || left.x - right.x,
    )[0]
    return [0, anchor.pageNumber as number, firstArea?.y ?? 0, firstArea?.x ?? 0]
  }

  if (Number.isInteger(anchor.chapterIndex)) {
    return [
      0,
      anchor.chapterIndex as number,
      Number.isInteger(anchor.blockOffset) ? (anchor.blockOffset as number) : 0,
      Number.isInteger(anchor.startOffset) ? (anchor.startOffset as number) : 0,
    ]
  }

  return [1, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER]
}

export const compareReaderHighlightsByDocumentPosition = (
  left: ReaderHighlight,
  right: ReaderHighlight,
) => {
  const leftPosition = getReaderHighlightDocumentPosition(left)
  const rightPosition = getReaderHighlightDocumentPosition(right)
  for (let index = 0; index < leftPosition.length; index += 1) {
    const difference = leftPosition[index] - rightPosition[index]
    if (difference !== 0) return difference
  }

  const createdAtDifference = String(left.created_at || '').localeCompare(
    String(right.created_at || ''),
  )
  return createdAtDifference || left.id.localeCompare(right.id)
}

export const getReaderTextSegments = (
  text: string,
  highlights: ReaderHighlight[],
  chapterIndex: number,
  blockOffset: number,
  chapter: string,
): ReaderTextSegment[] => {
  const ranges = highlights
    .flatMap((highlight) => {
      const anchor = parseReaderHighlightAnchor(highlight.anchor)
      if (getReaderAnnotationKind(highlight) === 'translation') return []
      const isPreciseAnchor =
        anchor?.chapterIndex === chapterIndex &&
        anchor.blockOffset === blockOffset &&
        Number.isInteger(anchor.startOffset) &&
        Number.isInteger(anchor.endOffset)
      if (isPreciseAnchor) {
        const start = Math.max(0, Math.min(text.length, anchor.startOffset as number))
        const end = Math.max(start, Math.min(text.length, anchor.endOffset as number))
        return end > start ? [{ start, end, highlight }] : []
      }
      if (anchor?.pageNumber || anchor?.areas?.length) return []
      if (anchor?.chapter && anchor.chapter !== chapter) return []
      const start = text.indexOf(highlight.text)
      return start >= 0 ? [{ start, end: start + highlight.text.length, highlight }] : []
    })
    .sort((left, right) => left.start - right.start || right.end - left.end)

  if (ranges.length === 0) return [{ text }]
  const boundaries = Array.from(
    new Set([0, text.length, ...ranges.flatMap((range) => [range.start, range.end])]),
  ).sort((left, right) => left - right)
  const segments: ReaderTextSegment[] = []
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const start = boundaries[index]
    const end = boundaries[index + 1]
    if (end <= start) continue
    const activeHighlights = ranges
      .filter((range) => range.start <= start && range.end >= end)
      .map((range) => range.highlight)
    if (activeHighlights.length === 0) {
      segments.push({ text: text.slice(start, end) })
      continue
    }
    const primaryHighlight =
      activeHighlights.find((highlight) => getReaderAnnotationKind(highlight) === 'note') ||
      activeHighlights[0]
    segments.push({
      text: text.slice(start, end),
      highlight: primaryHighlight,
      highlights: activeHighlights,
    })
  }
  return segments
}

export const shouldShowEpubToc = (
  isPdf: boolean,
  hasChapters: boolean,
  epubLayoutMode: EpubLayoutMode,
) => {
  void epubLayoutMode
  return !isPdf && hasChapters
}

export const getReaderContentGridColumns = (
  showEpubToc: boolean,
  isTocDrawerOpen = false,
  tocDrawerWidth = 260,
  isAnnotationsDrawerOpen = false,
  annotationsDrawerWidth = 320,
  reserveClosedSideColumns = false,
  readerMainMinWidth = 0,
) => {
  const tocColumn =
    showEpubToc && (isTocDrawerOpen || reserveClosedSideColumns) ? `${tocDrawerWidth}px` : '0px'
  const annotationsColumn =
    isAnnotationsDrawerOpen || reserveClosedSideColumns ? `${annotationsDrawerWidth}px` : '0px'
  const readerColumn = readerMainMinWidth > 0 ? `${readerMainMinWidth}px` : '0'
  return `${tocColumn} minmax(${readerColumn}, 1fr) ${annotationsColumn}`
}

export const getPdfPageRenderWidth = (readerWidth: number, pdfLayoutMode: PdfLayoutMode) => {
  if (readerWidth <= 0) return 0

  if (pdfLayoutMode === 'dual') {
    return Math.round(Math.max(280, Math.min(620, (readerWidth - 164) / 2)))
  }

  return Math.round(Math.max(420, Math.min(1280, readerWidth - 112)))
}

export const getPdfPageIndexAtOffset = (
  pages: ArrayLike<{ offsetTop: number }>,
  viewportOffset: number,
) => {
  if (pages.length === 0) return 0

  let low = 0
  let high = pages.length - 1
  let activeIndex = 0

  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    if (pages[middle].offsetTop <= viewportOffset) {
      activeIndex = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }

  return activeIndex
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

  const pageCounts = chapters.map(
    (chapter) => getPagesForReadingBlocks(chapter.paragraphs || []).length,
  )
  const totalPages = pageCounts.reduce((sum, count) => sum + count, 0)
  if (totalPages <= 1) return 100

  const safeChapterIndex = Math.max(0, Math.min(chapterIndex, chapters.length - 1))
  const previousPages = pageCounts.slice(0, safeChapterIndex).reduce((sum, count) => sum + count, 0)
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
      (chapter, index) =>
        index >= entry.chapterIndex && normalizeTocTitle(chapter.title) === entryTitle,
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

const findHeadingTarget = (chapters: TocResolutionChapter[], title: string, startIndex: number) => {
  const normTitle = normalizeTocTitle(title)

  for (let chapterIndex = Math.max(0, startIndex); chapterIndex < chapters.length; chapterIndex++) {
    const headingIndex = chapters[chapterIndex].paragraphs?.findIndex(
      (block) =>
        isReadingBlockHeading(block) && normalizeTocTitle(getReadingBlockText(block)) === normTitle,
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
    if (
      headingTarget &&
      headingTarget.chapterIndex === chapterIndex &&
      headingTarget.paragraphOffset > 0
    ) {
      paragraphOffset = headingTarget.paragraphOffset
    }
  }

  return {
    chapterIndex,
    paragraphOffset,
  }
}
