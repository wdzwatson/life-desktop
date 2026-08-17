import type { PdfOutlineEntrySource } from '../../src/services/pdfOutlineAdapter'

export type PdfInspectorWorkerInput = {
  buffer: Uint8Array
  parserVersion: string
  contentHash: string
}

export type PdfInspectorWorkerProgress = {
  phase: 'classifying' | 'tagged' | 'inferred' | 'page-only'
  progress: number
  message: string
}

export type PdfInspectorWorkerResult = {
  source: PdfOutlineEntrySource | null
  pdfType: string
  pageCount: number
  entries: Array<{
    id: string
    title: string
    level: number
    pathKey: string
    parentPathKey: string | null
    pageNumber: number | null
    y: number | null
    destination: string | null
    resolved: boolean
    childrenCount: number
    analysisSource: PdfOutlineEntrySource
  }>
}

export type PdfInspectorWorkerMessage =
  | { type: 'progress'; data: PdfInspectorWorkerProgress }
  | { type: 'result'; data: PdfInspectorWorkerResult }
  | { type: 'error'; error: string }

export function createPdfInspectorWorkerSource() {
  return String.raw`
const { parentPort, workerData } = require('node:worker_threads')
const { classifyPdfAsync, extractPagesMarkdownAsync, extractStructureElements, extractTextWithPositions } = require('@firecrawl/pdf-inspector')

const slugify = (value) => String(value ?? '')
  .normalize('NFKC')
  .toLowerCase()
  .replace(/['"\`]/g, '')
  .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
  .replace(/^-+|-+$/g, '')
  .slice(0, 48) || 'node'

const normalizeTitle = (value) => {
  const title = String(value ?? '').replace(/\s+/g, ' ').trim()
  return title || 'Untitled'
}

const emit = (phase, progress, message) => {
  parentPort.postMessage({ type: 'progress', data: { phase, progress, message } })
}

const buildPathKeys = (entries) => {
  const siblingCounters = new Map()
  const stack = []
  const output = []
  for (const [index, entry] of entries.entries()) {
    const desiredLevel = Number.isInteger(entry.level) && entry.level > 0 ? entry.level : 0
    const effectiveLevel = stack.length === 0 ? 0 : Math.min(desiredLevel, stack.length)
    stack.length = effectiveLevel
    const parent = effectiveLevel > 0 ? stack[effectiveLevel - 1] : null
    const parentPathKey = parent ? parent.pathKey : null
    const siblingKey = parentPathKey || '__root__'
    const nextSiblingIndex = (siblingCounters.get(siblingKey) || 0) + 1
    siblingCounters.set(siblingKey, nextSiblingIndex)
    const segment = String(nextSiblingIndex) + '-' + slugify(entry.title)
    const pathKey = parentPathKey ? parentPathKey + '/' + segment : segment
    const outputEntry = {
      id: pathKey,
      title: normalizeTitle(entry.title),
      level: effectiveLevel,
      pathKey,
      parentPathKey,
      pageNumber: entry.pageNumber ?? null,
      y: entry.y ?? null,
      destination: entry.destination ?? null,
      resolved: Boolean(entry.pageNumber),
      childrenCount: 0,
      analysisSource: entry.analysisSource,
    }
    output.push(outputEntry)
    stack[effectiveLevel] = outputEntry
  }
  const childrenCount = new Map()
  for (const entry of output) {
    if (!entry.parentPathKey) continue
    childrenCount.set(entry.parentPathKey, (childrenCount.get(entry.parentPathKey) || 0) + 1)
  }
  return output.map((entry) => ({
    ...entry,
    childrenCount: childrenCount.get(entry.pathKey) || 0,
  }))
}

const normalizePageCount = (value) => (Number.isInteger(value) && value > 0 ? value : 0)

const buildTaggedEntries = (buffer) => {
  const structureElements = extractStructureElements(buffer)
  if (!Array.isArray(structureElements) || structureElements.length === 0) return []
  const textItems = extractTextWithPositions(buffer)
  const textByPageMcid = new Map()
  for (const item of textItems) {
    if (!Number.isInteger(item.mcid) || !item.text) continue
    const key = String(item.page) + ':' + String(item.mcid)
    const existing = textByPageMcid.get(key)
    if (existing) existing.push(item)
    else textByPageMcid.set(key, [item])
  }
  const headings = []
  for (const element of structureElements) {
    const role = String(element.role || '').trim()
    const roleMatch = /^H([1-6])$/i.exec(role)
    if (!roleMatch) continue
    const key = String(element.page) + ':' + String(element.mcid)
    const textItemsForHeading = textByPageMcid.get(key) || []
    const title = normalizeTitle(textItemsForHeading.map((item) => item.text).join(' '))
    if (!title || title === 'Untitled') continue
    const yCandidates = textItemsForHeading.map((item) => item.y).filter((value) => Number.isFinite(value))
    headings.push({
      title,
      level: Number(roleMatch[1]) - 1,
      pageNumber: Number.isInteger(element.page) ? element.page : null,
      y: yCandidates.length > 0 ? Math.min(...yCandidates) : null,
      destination: 'page:' + String(element.page),
      resolved: Number.isInteger(element.page),
      analysisSource: 'tagged',
    })
  }
  return buildPathKeys(headings)
}

const buildMarkdownEntries = async (buffer) => {
  const pagesResult = await extractPagesMarkdownAsync(buffer)
  const headings = []
  for (const page of pagesResult.pages) {
    const lines = String(page.markdown || '').split(/\r?\n/)
    for (const [index, line] of lines.entries()) {
      const match = /^\s*(#{1,6})\s+(.+?)\s*$/.exec(line)
      if (!match) continue
      const title = normalizeTitle(match[2])
      if (!title || title === 'Untitled') continue
      headings.push({
        title,
        level: match[1].length - 1,
        pageNumber: Number.isInteger(page.page) ? page.page + 1 : null,
        y: index,
        destination: 'page:' + String((Number.isInteger(page.page) ? page.page + 1 : 1)),
        resolved: true,
        analysisSource: 'inferred',
      })
    }
  }
  if (headings.length === 0) return []
  return buildPathKeys(headings)
}

const buildPageOnlyEntries = (pageCount) => {
  const count = normalizePageCount(pageCount)
  const entries = []
  for (let page = 1; page <= count; page += 1) {
    entries.push({
      title: 'Page ' + String(page),
      level: 0,
      pageNumber: page,
      y: null,
      destination: 'page:' + String(page),
      resolved: true,
      analysisSource: 'page-only',
    })
  }
  return buildPathKeys(entries)
}

(async () => {
  try {
    const buffer = Buffer.from(workerData.buffer)
    emit('classifying', 0.1, '正在分析 PDF 类型...')
    const classification = await classifyPdfAsync(buffer)
    const pageCount = normalizePageCount(classification.pageCount)

    emit('tagged', 0.35, '正在检查 Tagged PDF 结构...')
    let taggedEntries = []
    try {
      taggedEntries = buildTaggedEntries(buffer)
    } catch {
      taggedEntries = []
    }
    if (taggedEntries.length > 0) {
      parentPort.postMessage({
        type: 'result',
        data: {
          source: 'tagged',
          pdfType: classification.pdfType,
          pageCount,
          entries: taggedEntries,
        },
      })
      return
    }

    emit('inferred', 0.7, '正在推断 Markdown 标题...')
    let inferredEntries = []
    try {
      inferredEntries = await buildMarkdownEntries(buffer)
    } catch {
      inferredEntries = []
    }
    if (inferredEntries.length > 0) {
      parentPort.postMessage({
        type: 'result',
        data: {
          source: 'inferred',
          pdfType: classification.pdfType,
          pageCount,
          entries: inferredEntries,
        },
      })
      return
    }

    emit('page-only', 0.9, '未识别到目录，回退到页码目录...')
    parentPort.postMessage({
      type: 'result',
      data: {
        source: 'page-only',
        pdfType: classification.pdfType,
        pageCount,
        entries: buildPageOnlyEntries(pageCount),
      },
    })
  } catch (error) {
    parentPort.postMessage({
      type: 'error',
      error: error instanceof Error ? error.message : String(error),
    })
  }
})()
`
}
