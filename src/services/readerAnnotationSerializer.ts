import {
  type DocumentPosition,
  type ExportAnnotationRecord,
  type OutlinePathSnapshot,
  type OutlinePathSnapshotNode,
  type ReaderAnchorV2,
  type ReaderAnnotationItem,
  type ReaderAnnotationKind,
  type ReaderDocumentSource,
  type ReaderOutlineResolutionStatus,
  type ReaderSelection,
} from '../types/readerAnnotation'

export class ReaderAnnotationValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReaderAnnotationValidationError'
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const toStringValue = (value: unknown, field: string) => {
  const text = String(value ?? '').trim()
  if (!text) throw new ReaderAnnotationValidationError(`${field} is required.`)
  return text
}

const toOptionalStringValue = (value: unknown) => {
  const text = String(value ?? '').trim()
  return text || undefined
}

const normalizeBookId = (value: unknown, field: string): string | number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return toStringValue(value, field)
}

const toNumberValue = (value: unknown, field: string) => {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed)) throw new ReaderAnnotationValidationError(`${field} must be numeric.`)
  return parsed
}

const toIntegerValue = (value: unknown, field: string, min = 0) => {
  const parsed = toNumberValue(value, field)
  if (!Number.isInteger(parsed) || parsed < min) {
    throw new ReaderAnnotationValidationError(`${field} must be an integer greater than or equal to ${min}.`)
  }
  return parsed
}

const normalizeSource = (value: unknown): ReaderDocumentSource => {
  const source = String(value ?? '').trim().toLowerCase()
  if (source === 'pdf' || source === 'ocr' || source === 'epub') return source
  return 'unknown'
}

const normalizeKind = (value: unknown): ReaderAnnotationKind => {
  const kind = String(value ?? '').trim()
  if (kind === 'translation' || kind === 'underline' || kind === 'note') return kind
  throw new ReaderAnnotationValidationError(`Unsupported annotation kind: ${kind || '<empty>'}.`)
}

const normalizeStatus = (value: unknown): ReaderOutlineResolutionStatus => {
  const status = String(value ?? '').trim()
  if (status === 'pending' || status === 'resolved' || status === 'page-only' || status === 'error') {
    return status
  }
  return 'pending'
}

const normalizePosition = (value: unknown, fallbackSource: ReaderDocumentSource): DocumentPosition => {
  if (!isRecord(value)) {
    throw new ReaderAnnotationValidationError('Document position must be an object.')
  }
  const source = normalizeSource(value.source ?? fallbackSource)
  const pageNumber =
    value.pageNumber === undefined || value.pageNumber === null
      ? undefined
      : toIntegerValue(value.pageNumber, 'position.pageNumber', 1)
  const chapterIndex =
    value.chapterIndex === undefined || value.chapterIndex === null
      ? undefined
      : toIntegerValue(value.chapterIndex, 'position.chapterIndex', 0)
  const blockOffset =
    value.blockOffset === undefined || value.blockOffset === null
      ? undefined
      : toIntegerValue(value.blockOffset, 'position.blockOffset', 0)
  const charStart =
    value.charStart === undefined || value.charStart === null
      ? undefined
      : toIntegerValue(value.charStart, 'position.charStart', 0)
  const charEnd =
    value.charEnd === undefined || value.charEnd === null
      ? undefined
      : toIntegerValue(value.charEnd, 'position.charEnd', 0)
  if (charStart !== undefined && charEnd !== undefined && charEnd < charStart) {
    throw new ReaderAnnotationValidationError('position.charEnd must be greater than or equal to position.charStart.')
  }
  const x = value.x === undefined || value.x === null ? undefined : toNumberValue(value.x, 'position.x')
  const y = value.y === undefined || value.y === null ? undefined : toNumberValue(value.y, 'position.y')

  if (
    pageNumber === undefined &&
    chapterIndex === undefined &&
    blockOffset === undefined &&
    charStart === undefined &&
    charEnd === undefined &&
    x === undefined &&
    y === undefined
  ) {
    throw new ReaderAnnotationValidationError('Document position must include at least one location field.')
  }

  return {
    source,
    ...(pageNumber !== undefined ? { pageNumber } : {}),
    ...(chapterIndex !== undefined ? { chapterIndex } : {}),
    ...(blockOffset !== undefined ? { blockOffset } : {}),
    ...(charStart !== undefined ? { charStart } : {}),
    ...(charEnd !== undefined ? { charEnd } : {}),
    ...(x !== undefined ? { x } : {}),
    ...(y !== undefined ? { y } : {}),
  }
}

const compareDocumentPositions = (left: DocumentPosition, right: DocumentPosition) => {
  const sourceRank = (source: ReaderDocumentSource) => {
    switch (source) {
      case 'pdf':
        return 0
      case 'ocr':
        return 1
      case 'epub':
        return 2
      default:
        return 3
    }
  }
  const bySource = sourceRank(left.source) - sourceRank(right.source)
  if (bySource !== 0) return bySource
  if (left.pageNumber !== undefined || right.pageNumber !== undefined) {
    const page = (left.pageNumber || 0) - (right.pageNumber || 0)
    if (page !== 0) return page
    const y = (left.y || 0) - (right.y || 0)
    if (y !== 0) return y
    const x = (left.x || 0) - (right.x || 0)
    if (x !== 0) return x
  }
  if (left.chapterIndex !== undefined || right.chapterIndex !== undefined) {
    const chapter = (left.chapterIndex || 0) - (right.chapterIndex || 0)
    if (chapter !== 0) return chapter
    const block = (left.blockOffset || 0) - (right.blockOffset || 0)
    if (block !== 0) return block
  }
  const start = (left.charStart || 0) - (right.charStart || 0)
  if (start !== 0) return start
  const end = (left.charEnd || 0) - (right.charEnd || 0)
  if (end !== 0) return end
  return 0
}

const normalizePositions = (value: unknown, fallbackSource: ReaderDocumentSource) => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ReaderAnnotationValidationError('Anchor positions must be a non-empty array.')
  }
  return value.map((position) => normalizePosition(position, fallbackSource)).sort(compareDocumentPositions)
}

const normalizeOutlinePathNode = (value: unknown): OutlinePathSnapshotNode => {
  if (!isRecord(value)) {
    throw new ReaderAnnotationValidationError('Outline path nodes must be objects.')
  }
  return {
    id: toStringValue(value.id, 'outlinePath.nodes.id'),
    title: toStringValue(value.title, 'outlinePath.nodes.title'),
    level: toIntegerValue(value.level, 'outlinePath.nodes.level', 0),
    pathKey: toStringValue(value.pathKey, 'outlinePath.nodes.pathKey'),
  }
}

const normalizeOutlinePathSnapshot = (value: unknown, fallbackSource: ReaderDocumentSource) => {
  if (value === null || value === undefined) return null
  if (!isRecord(value)) {
    throw new ReaderAnnotationValidationError('Outline path snapshot must be an object or null.')
  }
  const nodes = Array.isArray(value.nodes) ? value.nodes.map(normalizeOutlinePathNode) : []
  if (nodes.length === 0) {
    throw new ReaderAnnotationValidationError('Outline path snapshot requires at least one node.')
  }
  const source = normalizeSource(value.source ?? fallbackSource)
  const pathKey =
    value.pathKey !== undefined && String(value.pathKey).trim()
      ? String(value.pathKey).trim()
      : nodes.map((node) => node.pathKey).join('>')
  return { source, pathKey, nodes }
}

const normalizeAnchorShape = (value: unknown): ReaderAnchorV2 => {
  const raw = isRecord(value) && value.version === 2 ? value : null
  const fallbackSource = raw ? normalizeSource(raw.source) : 'unknown'

  if (raw && Array.isArray(raw.positions)) {
    const outlinePath = normalizeOutlinePathSnapshot(raw.outlinePath, fallbackSource)
    return {
      version: 2,
      source: normalizeSource(raw.source),
      selectedText: String(raw.selectedText ?? '').trim(),
      positions: normalizePositions(raw.positions, fallbackSource),
      outlinePath,
      ...(raw.highlighted === undefined ? {} : { highlighted: Boolean(raw.highlighted) }),
    }
  }

  if (!isRecord(value)) {
    throw new ReaderAnnotationValidationError('Anchor must be an object or a JSON string.')
  }

  const source = normalizeSource(value.source ?? 'unknown')
  const selectedText = String(value.selectedText ?? value.text ?? '').trim()
  const positions: DocumentPosition[] = []
  if (value.pageNumber !== undefined || value.areas !== undefined) {
    const pageNumber = toIntegerValue(value.pageNumber, 'anchor.pageNumber', 1)
    const areas = Array.isArray(value.areas) ? value.areas : []
    if (areas.length > 0) {
      areas.forEach((area) => {
        if (!isRecord(area)) {
          throw new ReaderAnnotationValidationError('anchor.areas entries must be objects.')
        }
        positions.push(
          normalizePosition(
            {
              source: value.source ?? 'pdf',
              pageNumber,
              x: area.x,
              y: area.y,
            },
            'pdf',
          ),
        )
      })
    } else {
      positions.push(normalizePosition({ source: value.source ?? 'pdf', pageNumber }, 'pdf'))
    }
  } else if (value.chapterIndex !== undefined || value.blockOffset !== undefined) {
    positions.push(
      normalizePosition(
        {
          source: value.source ?? 'epub',
          chapterIndex: value.chapterIndex,
          blockOffset: value.blockOffset,
          charStart: value.startOffset,
          charEnd: value.endOffset,
        },
        'epub',
      ),
    )
  }

  if (positions.length === 0) {
    throw new ReaderAnnotationValidationError('Anchor requires at least one position.')
  }

  return {
    version: 2,
    source,
    selectedText,
    positions: positions.sort(compareDocumentPositions),
    outlinePath: normalizeOutlinePathSnapshot((value as Record<string, unknown>).outlinePath ?? null, source),
    ...(value.highlighted === undefined ? {} : { highlighted: Boolean(value.highlighted) }),
  }
}

const normalizeLegacySelectionStatus = (value: unknown): ReaderOutlineResolutionStatus => {
  const status = normalizeStatus(value)
  if (status === 'pending' || status === 'resolved' || status === 'page-only' || status === 'error') {
    return status
  }
  return 'pending'
}

export const convertLegacyReaderAnchorToV2 = (value: unknown): ReaderAnchorV2 => {
  return normalizeAnchorShape(value)
}

export const normalizeReaderAnchorV2 = (value: unknown): ReaderAnchorV2 => {
  if (typeof value === 'string') {
    try {
      return normalizeAnchorShape(JSON.parse(value))
    } catch {
      throw new ReaderAnnotationValidationError('Anchor JSON is invalid.')
    }
  }
  return normalizeAnchorShape(value)
}

export const normalizeReaderSelection = (value: unknown): ReaderSelection => {
  if (!isRecord(value)) throw new ReaderAnnotationValidationError('Selection must be an object.')
  const anchor = normalizeReaderAnchorV2(value.anchor)
  const selectedText = toStringValue(value.selectedText ?? anchor.selectedText, 'selection.selectedText')
  return {
    id: toStringValue(value.id, 'selection.id'),
    bookId: normalizeBookId(value.bookId ?? value.book_id, 'selection.bookId'),
    source: anchor.source,
    selectedText,
    anchor: {
      ...anchor,
      selectedText,
    },
    outlinePath: anchor.outlinePath,
    locationStatus: normalizeLegacySelectionStatus(value.locationStatus),
    createdAt: toStringValue(value.createdAt ?? value.created_at, 'selection.createdAt'),
    updatedAt: toStringValue(value.updatedAt ?? value.updated_at, 'selection.updatedAt'),
  }
}

export const normalizeReaderAnnotationItem = (value: unknown): ReaderAnnotationItem => {
  if (!isRecord(value)) throw new ReaderAnnotationValidationError('Annotation item must be an object.')
  const kind = normalizeKind(value.kind)
  const anchor = normalizeReaderAnchorV2(value.anchor)
  const text = toStringValue(value.text ?? anchor.selectedText, 'annotation.text')
  const body = toOptionalStringValue(value.body)
  const translationLanguage = toOptionalStringValue(value.translationLanguage ?? value.translation_language)
  if (kind === 'translation') {
    if (!translationLanguage) {
      throw new ReaderAnnotationValidationError('translation annotations require translationLanguage.')
    }
    if (!body) {
      throw new ReaderAnnotationValidationError('translation annotations require body text.')
    }
  }
  if (kind === 'note' && !body) {
    throw new ReaderAnnotationValidationError('note annotations require body text.')
  }
  if (kind === 'underline' && body) {
    throw new ReaderAnnotationValidationError('underline annotations do not accept body text.')
  }

  return {
    id: toStringValue(value.id, 'annotation.id'),
    bookId: normalizeBookId(value.bookId ?? value.book_id, 'annotation.bookId'),
    selectionId: toStringValue(value.selectionId ?? value.selection_id, 'annotation.selectionId'),
    kind,
    text,
    ...(body ? { body } : {}),
    ...(translationLanguage ? { translationLanguage } : {}),
    source: anchor.source,
    anchor: {
      ...anchor,
      selectedText: text,
    },
    outlinePath: anchor.outlinePath,
    locationStatus: normalizeLegacySelectionStatus(value.locationStatus),
    createdAt: toStringValue(value.createdAt ?? value.created_at, 'annotation.createdAt'),
    updatedAt: toStringValue(value.updatedAt ?? value.updated_at, 'annotation.updatedAt'),
  }
}

export const serializeReaderAnnotationItem = (value: ReaderAnnotationItem) => {
  return JSON.stringify(value)
}

export const deserializeReaderAnnotationItem = (value: string) => {
  try {
    return normalizeReaderAnnotationItem(JSON.parse(value))
  } catch (error) {
    if (error instanceof ReaderAnnotationValidationError) throw error
    throw new ReaderAnnotationValidationError('Annotation item JSON is invalid.')
  }
}

export const compareReaderAnnotationItems = (left: ReaderAnnotationItem, right: ReaderAnnotationItem) => {
  const leftPosition = left.anchor.positions[0]
  const rightPosition = right.anchor.positions[0]
  const positionDelta = compareDocumentPositions(leftPosition, rightPosition)
  if (positionDelta !== 0) return positionDelta
  const timeDelta = String(left.createdAt).localeCompare(String(right.createdAt))
  if (timeDelta !== 0) return timeDelta
  return left.id.localeCompare(right.id)
}

const getOutlinePathTitles = (outlinePath: OutlinePathSnapshot | null) =>
  outlinePath?.nodes.map((node) => node.title) || []

const getPageNumbers = (anchor: ReaderAnchorV2) =>
  Array.from(
    new Set(
      anchor.positions
        .map((position) => position.pageNumber)
        .filter((pageNumber): pageNumber is number => typeof pageNumber === 'number'),
    ),
  ).sort((left, right) => left - right)

const getOutlinePathKey = (outlinePath: OutlinePathSnapshot | null) =>
  outlinePath?.pathKey || outlinePath?.nodes.map((node) => node.pathKey).join('>') || ''

export const buildExportAnnotationRecord = (value: ReaderAnnotationItem): ExportAnnotationRecord => {
  const outlinePath = value.outlinePath ?? value.anchor.outlinePath ?? null
  return {
    id: value.id,
    bookId: value.bookId,
    selectionId: value.selectionId,
    kind: value.kind,
    text: value.text,
    ...(value.body ? { body: value.body } : {}),
    ...(value.translationLanguage ? { translationLanguage: value.translationLanguage } : {}),
    source: value.source,
    anchor: value.anchor,
    outlinePath,
    outlinePathTitles: getOutlinePathTitles(outlinePath),
    outlinePathKey: getOutlinePathKey(outlinePath),
    pageNumbers: getPageNumbers(value.anchor),
    deepLink: `book:${value.bookId}#annotation:${value.id}`,
    locationStatus: value.locationStatus,
    createdAt: value.createdAt,
  }
}
