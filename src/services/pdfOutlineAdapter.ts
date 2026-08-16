import type { PDFDocumentProxy } from 'pdfjs-dist'

export type PdfOutlineResolutionStatus = 'ready' | 'empty' | 'error'

export type PdfOutlineEntry = {
  id: string
  title: string
  level: number
  pathKey: string
  parentPathKey: string | null
  pageNumber: number | null
  y: number | null
  destination: string | readonly unknown[] | null
  resolved: boolean
  childrenCount: number
}

export type PdfOutlineLoadResult = {
  status: PdfOutlineResolutionStatus
  entries: PdfOutlineEntry[]
  error?: string
}

type PdfOutlineNode = Awaited<ReturnType<PDFDocumentProxy['getOutline']>>[number]

type OutlineDestination = {
  pageNumber: number | null
  y: number | null
  resolved: boolean
}

const slugifyOutlineSegment = (value: string) =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/['"`]/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'node'

const buildOutlinePathKey = (parentPathKey: string | null, index: number, title: string) => {
  const segment = `${index + 1}-${slugifyOutlineSegment(title)}`
  return parentPathKey ? `${parentPathKey}/${segment}` : segment
}

const resolveOutlineDestinationArray = async (
  pdfDocument: Pick<PDFDocumentProxy, 'getPageIndex'>,
  destination: readonly unknown[],
): Promise<OutlineDestination> => {
  if (destination.length === 0) {
    return { pageNumber: null, y: null, resolved: false }
  }

  const firstTarget = destination[0]
  let pageNumber: number | null = null
  if (typeof firstTarget === 'number' && Number.isInteger(firstTarget)) {
    pageNumber = firstTarget > 0 ? firstTarget : null
  } else if (typeof firstTarget === 'object' && firstTarget !== null) {
    try {
      const pageIndex = await pdfDocument.getPageIndex(firstTarget as never)
      pageNumber = Number.isInteger(pageIndex) && pageIndex >= 0 ? pageIndex + 1 : null
    } catch {
      pageNumber = null
    }
  }

  const yValue =
    typeof destination[3] === 'number' && Number.isFinite(destination[3])
      ? destination[3]
      : typeof destination[2] === 'number' && Number.isFinite(destination[2])
        ? destination[2]
        : null
  const y = yValue

  return {
    pageNumber,
    y,
    resolved: pageNumber !== null,
  }
}

const resolveOutlineDestination = async (
  pdfDocument: Pick<PDFDocumentProxy, 'getDestination' | 'getPageIndex'>,
  destination: PdfOutlineNode['dest'],
): Promise<OutlineDestination> => {
  if (typeof destination === 'string') {
    try {
      const resolvedDestination = await pdfDocument.getDestination(destination)
      if (!resolvedDestination) {
        return { pageNumber: null, y: null, resolved: false }
      }
      return resolveOutlineDestinationArray(pdfDocument, resolvedDestination)
    } catch {
      return { pageNumber: null, y: null, resolved: false }
    }
  }

  if (Array.isArray(destination)) {
    return resolveOutlineDestinationArray(pdfDocument, destination)
  }

  return { pageNumber: null, y: null, resolved: false }
}

const flattenOutlineNodes = async (
  pdfDocument: Pick<PDFDocumentProxy, 'getDestination' | 'getPageIndex'>,
  nodes: PdfOutlineNode[],
  level = 0,
  parentPathKey: string | null = null,
  output: PdfOutlineEntry[] = [],
): Promise<PdfOutlineEntry[]> => {
  for (const [index, node] of nodes.entries()) {
    const title = String(node.title ?? '').trim() || 'Untitled'
    const pathKey = buildOutlinePathKey(parentPathKey, index, title)
    const destination = await resolveOutlineDestination(pdfDocument, node.dest)
    const childNodes = Array.isArray(node.items) ? (node.items as PdfOutlineNode[]) : []
    output.push({
      id: pathKey,
      title,
      level,
      pathKey,
      parentPathKey,
      pageNumber: destination.pageNumber,
      y: destination.y,
      destination: node.dest,
      resolved: destination.resolved,
      childrenCount: childNodes.length,
    })
    if (childNodes.length > 0) {
      await flattenOutlineNodes(pdfDocument, childNodes, level + 1, pathKey, output)
    }
  }
  return output
}

export async function loadPdfOutline(
  pdfDocument: Pick<PDFDocumentProxy, 'getOutline' | 'getDestination' | 'getPageIndex'>,
): Promise<PdfOutlineLoadResult> {
  try {
    const outline = await pdfDocument.getOutline()
    if (!outline || outline.length === 0) {
      return { status: 'empty', entries: [] }
    }

    const entries = await flattenOutlineNodes(pdfDocument, outline as PdfOutlineNode[])
    if (entries.length === 0) {
      return { status: 'empty', entries: [] }
    }

    return { status: 'ready', entries }
  } catch (error) {
    return {
      status: 'error',
      entries: [],
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
