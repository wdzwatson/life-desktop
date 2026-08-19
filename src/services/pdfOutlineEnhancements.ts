import type { PdfOutlineEntry } from './pdfOutlineAdapter'

export type PdfOutlineActiveNode = {
  id: string
  level: number
  pageNumber?: number | null
}

export type OcrOutlineWord = {
  text: string
  x: number
  y: number
  width: number
  height: number
  confidence: number
}

export type OcrOutlineCandidate = {
  title: string
  level: number
  pageNumber: number
  printedPageNumber: number | null
  pageNumberSource: 'pdf-sequence' | 'printed' | 'pdf-label'
  y: number | null
}

const BROKEN_GLYPH_PATTERN = /[\uFFFD\u25A1\u25A0]/u
const OUTLINE_NUMBER_PATTERN = /^(\d+(?:[.．]\d+)*)(?:[.．])?\s+(.+)$/u
const TRAILING_PAGE_PATTERN = /^(.*?)(?:\.{2,}|…+|\s{2,}|\s)([0-9/]{1,4})$/u

const PDF_LIGATURE_REPLACEMENTS: Readonly<Record<string, string>> = {
  ﬀ: 'ff',
  ﬁ: 'fi',
  ﬂ: 'fl',
  ﬃ: 'ffi',
  ﬄ: 'ffl',
  ﬅ: 'ft',
  ﬆ: 'st',
}

const normalizeWhitespace = (value: string) => value.replace(/\s+/gu, ' ').trim()

export const normalizePdfOutlineText = (value: string) =>
  value
    .normalize('NFKC')
    .replace(/[ﬀ-ﬆ]/gu, (ligature) => PDF_LIGATURE_REPLACEMENTS[ligature] ?? ligature)
    .replace(/[\u00AD\u200B]/gu, '')

const normalizeForComparison = (value: string) =>
  normalizePdfOutlineText(value)
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')

export const hasBrokenPdfOutlineGlyph = (value: string) => BROKEN_GLYPH_PATTERN.test(value)

export function getActivePdfOutlineNodeId(
  nodes: PdfOutlineActiveNode[],
  pageNumber: number,
  preferredNodeId?: string | null,
) {
  if (nodes.length === 0) return null

  const preferred = preferredNodeId ? nodes.find((node) => node.id === preferredNodeId) : null
  if (preferred?.pageNumber === pageNumber) return preferred.id

  let active: PdfOutlineActiveNode | null = null
  for (const node of nodes) {
    if (!Number.isInteger(node.pageNumber) || (node.pageNumber as number) > pageNumber) continue
    if (!active || (node.pageNumber as number) > (active.pageNumber as number)) active = node
  }
  return active?.id ?? nodes[0].id
}

export function repairPdfOutlineTitle(title: string, candidates: string[]) {
  const normalizedTitle = normalizePdfOutlineText(title)
  if (!hasBrokenPdfOutlineGlyph(title)) return normalizedTitle
  const parts = normalizedTitle
    .toLocaleLowerCase()
    .split(BROKEN_GLYPH_PATTERN)
    .map((part) => normalizeForComparison(part))
  const matches = candidates
    .map(normalizeWhitespace)
    .filter((candidate) => candidate && !hasBrokenPdfOutlineGlyph(candidate))
    .filter((candidate) => {
      const normalizedCandidate = normalizeForComparison(candidate)
      let cursor = 0
      for (const part of parts) {
        if (!part) continue
        const matchAt = normalizedCandidate.indexOf(part, cursor)
        if (matchAt < cursor || matchAt - cursor > 4) return false
        cursor = matchAt + part.length
      }
      return normalizedCandidate.length - cursor <= 4
    })

  return matches.length === 1 ? normalizePdfOutlineText(matches[0]) : normalizedTitle
}

export type OcrOutlinePageNumberMode = 'pdf-sequence' | 'printed'

export function resolveOcrOutlinePageNumber({
  sourcePageNumber,
  printedPageNumber,
  documentPageCount,
  mode = 'pdf-sequence',
}: {
  sourcePageNumber: number
  printedPageNumber: number | null
  documentPageCount: number
  mode?: OcrOutlinePageNumberMode
}) {
  const sourceIsValid =
    Number.isInteger(sourcePageNumber) &&
    sourcePageNumber >= 1 &&
    sourcePageNumber <= documentPageCount
  const printedIsValid =
    Number.isInteger(printedPageNumber) &&
    (printedPageNumber as number) >= 1 &&
    (printedPageNumber as number) <= documentPageCount
  if (mode === 'printed' && printedIsValid) return printedPageNumber as number
  if (sourceIsValid) return sourcePageNumber
  return printedIsValid ? (printedPageNumber as number) : 1
}

const parseOcrPrintedPageNumber = (match: RegExpExecArray | null) => {
  if (!match) return null
  const token = match[2]
  if (/^\d+$/u.test(token)) return Number(token)

  // OCR frequently reads a dotted-leader page number "1" as "/". Restrict
  // this repair to a slash-only token preceded by an actual leader so that
  // ordinary title text such as "A / B" is not changed.
  if (/^\/+$/u.test(token) && /(?:\.{2,}|…+)\s*$/u.test(match[1])) {
    return Number(token.replaceAll('/', '1'))
  }
  return null
}

export function groupOcrWordsIntoLines(words: OcrOutlineWord[]) {
  const reliable = words
    .filter((word) => normalizeWhitespace(word.text) && word.confidence >= 35)
    .sort((left, right) => left.y - right.y || left.x - right.x)
  const lines: Array<{ words: OcrOutlineWord[]; centerY: number; height: number }> = []

  for (const word of reliable) {
    const centerY = word.y + word.height / 2
    const current = lines.at(-1)
    const normalizedCoordinates = Math.max(current?.height ?? 0, word.height) <= 1
    const tolerance = current
      ? normalizedCoordinates
        ? Math.max(0.005, Math.min(0.03, Math.max(current.height, word.height) * 0.65))
        : Math.max(5, Math.min(24, Math.max(current.height, word.height) * 0.65))
      : 0
    if (!current || Math.abs(current.centerY - centerY) > tolerance) {
      lines.push({ words: [word], centerY, height: word.height })
      continue
    }
    current.words.push(word)
    current.centerY =
      (current.centerY * (current.words.length - 1) + centerY) / current.words.length
    current.height = Math.max(current.height, word.height)
  }

  return lines.map((line) => ({
    text: normalizeWhitespace(
      line.words
        .sort((left, right) => left.x - right.x)
        .map((word) => word.text)
        .join(' '),
    ),
    y: Math.min(...line.words.map((word) => word.y)),
  }))
}

export function extractOcrOutlineCandidates(
  words: OcrOutlineWord[],
  sourcePageNumber: number,
  documentPageCount: number,
  pageNumberMode: OcrOutlinePageNumberMode = 'pdf-sequence',
) {
  const candidates: OcrOutlineCandidate[] = []
  for (const line of groupOcrWordsIntoLines(words)) {
    const cleaned = normalizePdfOutlineText(line.text)
      .replace(/[·•]{2,}/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim()
    const numbered = OUTLINE_NUMBER_PATTERN.exec(cleaned)
    const structural =
      /^(?:(chapter|part|section)\s+([0-9ivxlcdm]+(?:[.．]\d+)*)|第\s*([一二三四五六七八九十百千万零〇0-9]+)\s*([章节篇部]))\s*(.+)$/iu.exec(
        cleaned,
      )
    if (!numbered && !structural) continue

    const sectionNumber = numbered?.[1].replace(/．/gu, '.')
    const content = numbered?.[2] ?? structural?.[5] ?? ''
    const trailingPage = TRAILING_PAGE_PATTERN.exec(content)
    const rawTitle = normalizeWhitespace(trailingPage?.[1] ?? content)
      .replace(/[.。·•…]+$/gu, '')
      .trim()
    if (rawTitle.length < 2 || /^\d+$/u.test(rawTitle)) continue

    const printedPage = parseOcrPrintedPageNumber(trailingPage)
    const targetPage = resolveOcrOutlinePageNumber({
      sourcePageNumber,
      printedPageNumber: printedPage,
      documentPageCount,
      mode: pageNumberMode,
    })
    candidates.push({
      title: numbered
        ? `${sectionNumber} ${rawTitle}`
        : `${cleaned.slice(0, cleaned.length - content.length).trim()} ${rawTitle}`,
      level: numbered
        ? Math.max(0, (sectionNumber as string).split('.').length - 1)
        : structural?.[1]?.toLocaleLowerCase() === 'section' || structural?.[4] === '节'
          ? 1
          : 0,
      pageNumber: targetPage,
      printedPageNumber: printedPage,
      pageNumberSource:
        pageNumberMode === 'printed' && targetPage === printedPage ? 'printed' : 'pdf-sequence',
      y: line.y,
    })
  }
  return candidates
}

export function resolveOcrOutlineCandidatesWithPageLabels(
  candidates: OcrOutlineCandidate[],
  pageLabels: string[] | null,
  documentPageCount: number,
) {
  if (
    candidates.length === 0 ||
    !pageLabels ||
    pageLabels.length !== documentPageCount ||
    documentPageCount < 1
  ) {
    return null
  }

  const labelToPageNumber = new Map<string, number | null>()
  pageLabels.forEach((label, index) => {
    const normalizedLabel = normalizePdfOutlineText(label).trim()
    if (!/^\d{1,4}$/u.test(normalizedLabel)) return
    labelToPageNumber.set(
      normalizedLabel,
      labelToPageNumber.has(normalizedLabel) ? null : index + 1,
    )
  })

  const resolved: OcrOutlineCandidate[] = []
  for (const candidate of candidates) {
    if (!Number.isInteger(candidate.printedPageNumber)) return null
    const pageNumber = labelToPageNumber.get(String(candidate.printedPageNumber))
    if (!Number.isInteger(pageNumber)) return null
    resolved.push({
      ...candidate,
      pageNumber: pageNumber as number,
      pageNumberSource: 'pdf-label',
    })
  }
  return resolved
}

export function buildOcrPdfOutlineEntries(candidates: OcrOutlineCandidate[]) {
  const entries: PdfOutlineEntry[] = []
  const stack: PdfOutlineEntry[] = []
  const siblingCounts = new Map<string, number>()
  const seen = new Set<string>()
  const minimumLevel = candidates.reduce(
    (current, candidate) => Math.min(current, Math.max(0, candidate.level)),
    Number.POSITIVE_INFINITY,
  )

  for (const candidate of candidates) {
    const signature = `${candidate.title.toLocaleLowerCase()}@${candidate.pageNumber}`
    if (seen.has(signature)) continue
    seen.add(signature)

    const relativeLevel = Math.max(
      0,
      candidate.level - (Number.isFinite(minimumLevel) ? minimumLevel : 0),
    )
    const level = Math.min(relativeLevel, stack.length)
    stack.length = level
    const parentPathKey = level > 0 ? (stack[level - 1]?.pathKey ?? null) : null
    const siblingKey = parentPathKey ?? '__root__'
    const siblingIndex = (siblingCounts.get(siblingKey) ?? 0) + 1
    siblingCounts.set(siblingKey, siblingIndex)
    const slug = normalizeForComparison(candidate.title).slice(0, 48) || 'section'
    const pathKey = parentPathKey
      ? `${parentPathKey}/${siblingIndex}-${slug}`
      : `${siblingIndex}-${slug}`
    const entry: PdfOutlineEntry = {
      id: pathKey,
      title: candidate.title,
      level,
      pathKey,
      parentPathKey,
      pageNumber: candidate.pageNumber,
      y: candidate.y,
      destination: `page:${candidate.pageNumber}`,
      resolved: true,
      childrenCount: 0,
      analysisSource: 'inferred',
    }
    entries.push(entry)
    stack[level] = entry
  }

  const childrenCounts = new Map<string, number>()
  entries.forEach((entry) => {
    if (!entry.parentPathKey) return
    childrenCounts.set(entry.parentPathKey, (childrenCounts.get(entry.parentPathKey) ?? 0) + 1)
  })
  return entries.map((entry) => ({
    ...entry,
    childrenCount: childrenCounts.get(entry.pathKey) ?? 0,
  }))
}
