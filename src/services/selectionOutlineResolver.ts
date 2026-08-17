import { createOutlineIndex, type OutlineIndexInputNode } from './outlineIndex'
import { normalizeReaderAnchorV2 } from './readerAnnotationSerializer'
import type {
  OutlinePathSnapshot,
  OutlinePathSnapshotNode,
  ReaderDocumentSource,
  ReaderOutlineResolutionStatus,
  ReaderAnchorV2,
} from '../types/readerAnnotation'

export type SelectionOutlineResolutionInput = {
  anchor: unknown
  source?: ReaderDocumentSource
  outlineNodes?: OutlineIndexInputNode[]
}

export type SelectionOutlineResolution = {
  anchor: ReaderAnchorV2
  outlinePath: OutlinePathSnapshot | null
  locationStatus: ReaderOutlineResolutionStatus
  pathKey: string | null
  startOutlineNodeId: string | null
  endOutlineNodeId: string | null
  startPage: number | null
  endPage: number | null
  startY: number | null
  endY: number | null
  isCrossChapter: boolean
}

const buildSyntheticPath = (
  source: ReaderDocumentSource,
  title: string,
  pathKey: string,
  nodeId: string,
) => ({
  source,
  pathKey,
  nodes: [
    {
      id: nodeId,
      title,
      level: 0,
      pathKey,
    },
  ] satisfies OutlinePathSnapshotNode[],
})

const getPageNumber = (anchor: ReaderAnchorV2) =>
  anchor.positions.find((position) => Number.isInteger(position.pageNumber))?.pageNumber ?? null

const getLastPosition = (anchor: ReaderAnchorV2) => anchor.positions[anchor.positions.length - 1]

export function resolveSelectionOutlineLocation(input: SelectionOutlineResolutionInput) {
  const anchor = normalizeReaderAnchorV2(input.anchor)
  const firstPosition = anchor.positions[0] ?? null
  const lastPosition = getLastPosition(anchor)
  const startPage = firstPosition?.pageNumber ?? null
  const endPage = lastPosition?.pageNumber ?? null
  const startY = firstPosition?.y ?? null
  const endY = lastPosition?.y ?? null

  if (anchor.outlinePath?.nodes?.length) {
    return {
      anchor,
      outlinePath: anchor.outlinePath,
      locationStatus: 'resolved' as const,
      pathKey: anchor.outlinePath.pathKey,
      startOutlineNodeId: anchor.outlinePath.nodes[0]?.id ?? null,
      endOutlineNodeId: anchor.outlinePath.nodes[anchor.outlinePath.nodes.length - 1]?.id ?? null,
      startPage,
      endPage,
      startY,
      endY,
      isCrossChapter: Boolean(
        startPage !== null && endPage !== null && startPage !== endPage,
      ),
    }
  }

  const epubChapterIndex = anchor.positions.find(
    (position) => Number.isInteger(position.chapterIndex),
  )?.chapterIndex
  if (anchor.source === 'epub' || epubChapterIndex !== undefined) {
    const chapterIndex = Number.isInteger(epubChapterIndex) ? (epubChapterIndex as number) : 0
    const chapterTitle = `Chapter ${chapterIndex + 1}`
    const pathKey = `chapter-${chapterIndex + 1}`
    return {
      anchor,
      outlinePath: buildSyntheticPath('epub', chapterTitle, pathKey, pathKey),
      locationStatus: 'resolved' as const,
      pathKey,
      startOutlineNodeId: null,
      endOutlineNodeId: null,
      startPage,
      endPage,
      startY,
      endY,
      isCrossChapter: Boolean(
        Number.isInteger(firstPosition?.chapterIndex) &&
          Number.isInteger(lastPosition?.chapterIndex) &&
          firstPosition?.chapterIndex !== lastPosition?.chapterIndex,
      ),
    }
  }

  if (Array.isArray(input.outlineNodes) && input.outlineNodes.length > 0) {
    const hasOnlyPageFallbackNodes = input.outlineNodes.every(
      (node) => node.analysisSource === 'page-only',
    )
    if (hasOnlyPageFallbackNodes) {
      return {
        anchor,
        outlinePath: null,
        locationStatus: 'page-only' as const,
        pathKey: null,
        startOutlineNodeId: null,
        endOutlineNodeId: null,
        startPage,
        endPage,
        startY,
        endY,
        isCrossChapter: false,
      }
    }
    const index = createOutlineIndex(input.outlineNodes, { defaultSource: input.source ?? 'pdf' })
    const resolution = index.resolveSelection(
      anchor.positions.map((position) => ({
        pageNumber: position.pageNumber,
        y: position.y,
      })),
    )
    if (resolution.startPath || resolution.endPath) {
      const startPath = resolution.startPath ?? resolution.endPath
      return {
        anchor,
        outlinePath: startPath,
        locationStatus: 'resolved' as const,
        pathKey: startPath?.pathKey ?? null,
        startOutlineNodeId: resolution.startNode?.id ?? null,
        endOutlineNodeId: resolution.endNode?.id ?? null,
        startPage,
        endPage,
        startY,
        endY,
        isCrossChapter: resolution.isCrossChapter,
      }
    }
  }

  return {
    anchor,
    outlinePath: null,
    locationStatus: getPageNumber(anchor) !== null ? 'page-only' : 'error',
    pathKey: null,
    startOutlineNodeId: null,
    endOutlineNodeId: null,
    startPage,
    endPage,
    startY,
    endY,
    isCrossChapter: false,
  }
}
