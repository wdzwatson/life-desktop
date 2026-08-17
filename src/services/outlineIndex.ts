import type { DocumentPosition, OutlinePathSnapshot, OutlinePathSnapshotNode, ReaderDocumentSource } from '../types/readerAnnotation'

export type OutlineIndexInputNode = {
  id: string
  title: string
  level?: number
  parentId?: string | null
  pathKey?: string | null
  sortOrder?: number
  pageStart?: number | null
  pageEnd?: number | null
  yStart?: number | null
  yEnd?: number | null
  source?: ReaderDocumentSource
  analysisSource?: 'native' | 'tagged' | 'inferred' | 'page-only'
}

export type OutlineIndexNode = {
  id: string
  title: string
  level: number
  parentId: string | null
  pathKey: string
  sortOrder: number
  pageStart: number | null
  pageEnd: number | null
  yStart: number | null
  yEnd: number | null
  source: ReaderDocumentSource
  analysisSource: 'native' | 'tagged' | 'inferred' | 'page-only' | null
  childrenCount: number
}

export type OutlineIndexPosition = Pick<DocumentPosition, 'pageNumber' | 'y'>

export type OutlineSelectionResolution = {
  startNode: OutlineIndexNode | null
  endNode: OutlineIndexNode | null
  startPath: OutlinePathSnapshot | null
  endPath: OutlinePathSnapshot | null
  pathKey: string | null
  isCrossChapter: boolean
}

export type OutlineIndex = {
  rootNodes: OutlineIndexNode[]
  childrenByParent: Map<string | null, OutlineIndexNode[]>
  nodesById: Map<string, OutlineIndexNode>
  pathSnapshotsById: Map<string, OutlinePathSnapshot>
  flatIndex: OutlineIndexNode[]
  getNodeById: (id: string) => OutlineIndexNode | null
  getPathSnapshot: (nodeOrId: string | OutlineIndexNode | null | undefined) => OutlinePathSnapshot | null
  findNodeAtPosition: (position: OutlineIndexPosition | null | undefined) => OutlineIndexNode | null
  resolveSelection: (positions: OutlineIndexPosition[]) => OutlineSelectionResolution
}

const MAX_NUMBER = Number.MAX_SAFE_INTEGER
const MIN_NUMBER = Number.NEGATIVE_INFINITY

const slugifySegment = (value: string) =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/['"`]/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'node'

const normalizeTitle = (value: string) => String(value ?? '').replace(/\s+/g, ' ').trim() || 'Untitled'

const normalizeNumber = (value: unknown, fallback: number) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return value
}

const normalizeNullableNumber = (value: unknown) => {
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value
}

const compareNullableAscending = (left: number | null, right: number | null, nullRank: 'first' | 'last') => {
  const leftValue = left ?? (nullRank === 'first' ? MIN_NUMBER : MAX_NUMBER)
  const rightValue = right ?? (nullRank === 'first' ? MIN_NUMBER : MAX_NUMBER)
  return leftValue - rightValue
}

const compareNodesByLayout = (left: OutlineIndexNode, right: OutlineIndexNode) =>
  compareNullableAscending(left.pageStart, right.pageStart, 'last') ||
  compareNullableAscending(left.yStart, right.yStart, 'first') ||
  left.sortOrder - right.sortOrder ||
  left.level - right.level ||
  left.pathKey.localeCompare(right.pathKey) ||
  left.id.localeCompare(right.id)

const compareNodeToPosition = (node: OutlineIndexNode, position: OutlineIndexPosition) =>
  compareNullableAscending(node.pageStart, position.pageNumber ?? null, 'last') ||
  compareNullableAscending(node.yStart, position.y ?? MAX_NUMBER, 'first')

const comparePositionForSelection = (left: OutlineIndexPosition, right: OutlineIndexPosition) =>
  compareNullableAscending(left.pageNumber ?? null, right.pageNumber ?? null, 'last') ||
  compareNullableAscending(left.y ?? null, right.y ?? null, 'last')

const normalizeInputNode = (node: OutlineIndexInputNode, defaultSource: ReaderDocumentSource) => {
  const title = normalizeTitle(node.title)
  return {
    id: String(node.id).trim(),
    title,
    level: Math.max(0, Math.trunc(normalizeNumber(node.level, 0))),
    parentId:
      typeof node.parentId === 'string' && node.parentId.trim() ? node.parentId.trim() : null,
    pathKey: typeof node.pathKey === 'string' && node.pathKey.trim() ? node.pathKey.trim() : null,
    sortOrder: Math.max(0, Math.trunc(normalizeNumber(node.sortOrder, 0))),
    pageStart: normalizeNullableNumber(node.pageStart),
    pageEnd: normalizeNullableNumber(node.pageEnd),
    yStart: normalizeNullableNumber(node.yStart),
    yEnd: normalizeNullableNumber(node.yEnd),
    source: node.source ?? defaultSource,
    analysisSource: node.analysisSource ?? null,
  }
}

export function createOutlineIndex(
  inputNodes: OutlineIndexInputNode[],
  options: { defaultSource?: ReaderDocumentSource } = {},
): OutlineIndex {
  const defaultSource = options.defaultSource ?? 'pdf'
  const normalizedNodes = inputNodes.map((node) => normalizeInputNode(node, defaultSource))
  const nodesById = new Map<string, OutlineIndexNode>()
  const pathSnapshotsById = new Map<string, OutlinePathSnapshot>()
  const childrenByParent = new Map<string | null, OutlineIndexNode[]>()

  for (const node of normalizedNodes) {
    if (!node.id) continue
    const outlineNode: OutlineIndexNode = {
      id: node.id,
      title: node.title,
      level: node.level,
      parentId: node.parentId,
      pathKey: node.pathKey || '',
      sortOrder: node.sortOrder,
      pageStart: node.pageStart,
      pageEnd: node.pageEnd,
      yStart: node.yStart,
      yEnd: node.yEnd,
      source: node.source,
      analysisSource: node.analysisSource ?? null,
      childrenCount: 0,
    }
    nodesById.set(outlineNode.id, outlineNode)
  }

  const childrenDrafts = new Map<string | null, OutlineIndexNode[]>()
  const effectiveParentById = new Map<string, string | null>()
  for (const node of nodesById.values()) {
    const parentId = node.parentId && nodesById.has(node.parentId) ? node.parentId : null
    effectiveParentById.set(node.id, parentId)
  }

  const resolvedParentChains = new Set<string>()
  for (const node of nodesById.values()) {
    if (resolvedParentChains.has(node.id)) continue
    const chain: string[] = []
    const chainIndexes = new Map<string, number>()
    let currentId: string | null = node.id
    while (currentId && !resolvedParentChains.has(currentId)) {
      const cycleIndex = chainIndexes.get(currentId)
      if (cycleIndex !== undefined) {
        effectiveParentById.set(chain[cycleIndex], null)
        break
      }
      chainIndexes.set(currentId, chain.length)
      chain.push(currentId)
      currentId = effectiveParentById.get(currentId) || null
    }
    chain.forEach((id) => resolvedParentChains.add(id))
  }

  for (const node of nodesById.values()) {
    const parentId = effectiveParentById.get(node.id) || null
    node.parentId = parentId
    const siblings = childrenDrafts.get(parentId) || []
    siblings.push(node)
    childrenDrafts.set(parentId, siblings)
  }

  for (const [parentId, children] of childrenDrafts) {
    childrenByParent.set(parentId, [...children].sort(compareNodesByLayout))
  }

  const rootNodes = childrenByParent.get(null) || []
  const stack = rootNodes
    .map((node, index) => ({
      node,
      siblingIndex: index,
      parentPathNodes: [] as OutlinePathSnapshotNode[],
      parentPathKey: null as string | null,
    }))
    .reverse()
  while (stack.length > 0) {
    const current = stack.pop()!
    const { node, siblingIndex, parentPathNodes, parentPathKey } = current
    const segment = `${siblingIndex + 1}-${slugifySegment(node.title)}`
    const pathKey = node.pathKey || (parentPathKey ? `${parentPathKey}/${segment}` : segment)
    node.pathKey = pathKey
    const childNodes = childrenByParent.get(node.id) || []
    node.childrenCount = childNodes.length
    const pathNodes = [
      ...parentPathNodes,
      {
        id: node.id,
        title: node.title,
        level: node.level,
        pathKey,
      },
    ]
    pathSnapshotsById.set(node.id, {
      source: node.source,
      pathKey,
      nodes: pathNodes,
    })
    for (let index = childNodes.length - 1; index >= 0; index -= 1) {
      stack.push({
        node: childNodes[index],
        siblingIndex: index,
        parentPathNodes: pathNodes,
        parentPathKey: pathKey,
      })
    }
  }

  const flatIndex = [...nodesById.values()].sort(compareNodesByLayout)

  const findNodeAtPosition = (position: OutlineIndexPosition | null | undefined) => {
    if (!position || !Number.isInteger(position.pageNumber) || (position.pageNumber as number) < 1) {
      return null
    }
    let low = 0
    let high = flatIndex.length - 1
    let matchIndex = -1
    while (low <= high) {
      const middle = Math.floor((low + high) / 2)
      const comparison = compareNodeToPosition(flatIndex[middle], position)
      if (comparison <= 0) {
        matchIndex = middle
        low = middle + 1
      } else {
        high = middle - 1
      }
    }
    return matchIndex >= 0 ? flatIndex[matchIndex] : null
  }

  const getPathSnapshot = (nodeOrId: string | OutlineIndexNode | null | undefined) => {
    if (!nodeOrId) return null
    const node = typeof nodeOrId === 'string' ? nodesById.get(nodeOrId) || null : nodeOrId
    if (!node) return null
    return pathSnapshotsById.get(node.id) || null
  }

  const resolveSelection = (positions: OutlineIndexPosition[]) => {
    if (!Array.isArray(positions) || positions.length === 0) {
      return {
        startNode: null,
        endNode: null,
        startPath: null,
        endPath: null,
        pathKey: null,
        isCrossChapter: false,
      }
    }
    const sortedPositions = [...positions].sort(comparePositionForSelection)
    const startPosition = sortedPositions[0]
    const endPosition = sortedPositions[sortedPositions.length - 1]
    const startNode = findNodeAtPosition(startPosition)
    const endNode = findNodeAtPosition(endPosition)
    const startPath = getPathSnapshot(startNode)
    const endPath = getPathSnapshot(endNode)
    return {
      startNode,
      endNode,
      startPath,
      endPath,
      pathKey: startPath?.pathKey ?? endPath?.pathKey ?? null,
      isCrossChapter: Boolean(startPath && endPath && startPath.pathKey !== endPath.pathKey),
    }
  }

  return {
    rootNodes,
    childrenByParent,
    nodesById,
    pathSnapshotsById,
    flatIndex,
    getNodeById: (id: string) => nodesById.get(id) || null,
    getPathSnapshot,
    findNodeAtPosition,
    resolveSelection,
  }
}
