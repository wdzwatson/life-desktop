export type ReaderDocumentSource = 'pdf' | 'ocr' | 'epub' | 'unknown'

export type ReaderAnnotationKind = 'translation' | 'underline' | 'note'

export type ReaderOutlineResolutionStatus = 'pending' | 'resolved' | 'page-only' | 'error'

export type ReaderOutlineRunState = 'idle' | 'queued' | 'running' | 'completed' | 'cancelled' | 'failed'

export type DocumentPosition = {
  source: ReaderDocumentSource
  pageNumber?: number
  chapterIndex?: number
  blockOffset?: number
  charStart?: number
  charEnd?: number
  x?: number
  y?: number
  width?: number
  height?: number
}

export type OutlinePathSnapshotNode = {
  id: string
  title: string
  level: number
  pathKey: string
}

export type OutlinePathSnapshot = {
  source: ReaderDocumentSource
  pathKey: string
  nodes: OutlinePathSnapshotNode[]
}

export type ReaderAnchorV2 = {
  version: 2
  source: ReaderDocumentSource
  selectedText: string
  positions: DocumentPosition[]
  outlinePath: OutlinePathSnapshot | null
  highlighted?: boolean
}

export type ReaderSelection = {
  id: string
  bookId: string | number
  source: ReaderDocumentSource
  selectedText: string
  anchor: ReaderAnchorV2
  outlinePath: OutlinePathSnapshot | null
  locationStatus: ReaderOutlineResolutionStatus
  createdAt: string
  updatedAt: string
}

export type ReaderAnnotationItem = {
  id: string
  bookId: string | number
  selectionId: string
  kind: ReaderAnnotationKind
  text: string
  body?: string
  translationLanguage?: string
  source: ReaderDocumentSource
  anchor: ReaderAnchorV2
  outlinePath: OutlinePathSnapshot | null
  locationStatus: ReaderOutlineResolutionStatus
  createdAt: string
  updatedAt: string
}

export type ExportAnnotationRecord = {
  id: string
  bookId: string | number
  selectionId: string
  kind: ReaderAnnotationKind
  text: string
  body?: string
  translationLanguage?: string
  source: ReaderDocumentSource
  anchor: ReaderAnchorV2
  outlinePath: OutlinePathSnapshot | null
  outlinePathTitles: string[]
  outlinePathKey: string
  pageNumbers: number[]
  deepLink: string
  locationStatus: ReaderOutlineResolutionStatus
  createdAt: string
}
