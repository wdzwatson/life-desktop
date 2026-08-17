import crypto from 'node:crypto'
import type Database from 'better-sqlite3'
import { saveReaderAnnotationItem, saveReaderSelection } from './readerAnnotationStore'
import { normalizeReaderAnchorV2 } from '../src/services/readerAnnotationSerializer'
import type {
  OutlinePathSnapshot,
  ReaderAnnotationKind,
  ReaderOutlineResolutionStatus,
} from '../src/types/readerAnnotation'

export type ReaderAnnotationListRecord = {
  id: string
  book_id: number
  selection_id: string
  kind: ReaderAnnotationKind
  text: string
  annotation: string
  translation_language: string | null
  style_token: string
  anchor: string
  location_status: ReaderOutlineResolutionStatus
  outline_path_json: string | null
  created_at: string
  updated_at: string
}

export type ReaderAnnotationSaveInput = {
  bookId: number
  kind: ReaderAnnotationKind
  text: string
  anchor: unknown
  selectionId?: string
  itemId?: string
  body?: string
  translationLanguage?: string
  locationStatus?: ReaderOutlineResolutionStatus
}

export type ReaderAnnotationSaveResult = {
  itemId: string
  selectionId: string
  kind: ReaderAnnotationKind
  locationStatus: ReaderOutlineResolutionStatus
}

export type ReaderAnnotationDeleteResult = {
  itemId: string
  selectionId: string | null
  selectionDeleted: boolean
}

export type ReaderAnnotationServiceDependencies = {
  getDb: () => Database.Database
}

const nowIso = () => new Date().toISOString()

const requireBookId = (value: unknown) => {
  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new Error('Invalid book ID.')
  }
  return Number(value)
}

const requireText = (value: unknown) => {
  const text = String(value ?? '').trim()
  if (!text) throw new Error('Annotation text is required.')
  return text
}

const normalizeSelectionId = (value: unknown) => {
  const selectionId = String(value ?? '').trim()
  return selectionId || `selection-${crypto.randomUUID()}`
}

const normalizeItemId = (value: unknown) => {
  const itemId = String(value ?? '').trim()
  return itemId || `annotation-${crypto.randomUUID()}`
}

const normalizeKind = (value: unknown): ReaderAnnotationKind => {
  const kind = String(value ?? '').trim()
  if (kind === 'translation' || kind === 'underline' || kind === 'note') return kind
  throw new Error('Invalid annotation kind.')
}

const normalizeBody = (kind: ReaderAnnotationKind, value: unknown) => {
  const body = String(value ?? '').trim()
  if (kind === 'translation' || kind === 'note') {
    if (!body) throw new Error(`${kind} annotations require body text.`)
    return body
  }
  return ''
}

const normalizeTranslationLanguage = (kind: ReaderAnnotationKind, value: unknown) => {
  const language = String(value ?? '').trim()
  if (kind === 'translation' && !language) {
    throw new Error('translation annotations require translationLanguage.')
  }
  return language || null
}

const mapSelectionLocationStatus = (
  existingStatus: ReaderOutlineResolutionStatus | null | undefined,
  requestedStatus: ReaderOutlineResolutionStatus | null | undefined,
) => requestedStatus ?? existingStatus ?? 'pending'

const normalizeSelectionOutlinePath = (value: OutlinePathSnapshot | null | undefined) =>
  value ?? null

const listAnnotationRowsSql = `
  SELECT
    items.id AS id,
    items.book_id AS book_id,
    items.selection_id AS selection_id,
    items.kind AS kind,
    items.text AS text,
    COALESCE(items.body, '') AS annotation,
    items.translation_language AS translation_language,
    items.style_token AS style_token,
    selections.anchor_json AS anchor,
    selections.location_status AS location_status,
    selections.outline_path_json AS outline_path_json,
    items.created_at AS created_at,
    items.updated_at AS updated_at
  FROM reader_annotation_items items
  JOIN reader_selections selections ON selections.id = items.selection_id
  WHERE items.book_id = ?
  ORDER BY COALESCE(selections.start_page, 0), COALESCE(selections.start_y, 0), items.created_at, items.id
`

export class ReaderAnnotationService {
  constructor(private readonly dependencies: ReaderAnnotationServiceDependencies) {}

  listBookAnnotations(bookId: number) {
    const db = this.dependencies.getDb()
    return db
      .prepare(listAnnotationRowsSql)
      .all(requireBookId(bookId)) as ReaderAnnotationListRecord[]
  }

  saveBookAnnotation(input: ReaderAnnotationSaveInput): ReaderAnnotationSaveResult {
    const db = this.dependencies.getDb()
    const bookId = requireBookId(input.bookId)
    const kind = normalizeKind(input.kind)
    const anchor = normalizeReaderAnchorV2(input.anchor)
    const text = requireText(input.text)
    const { selectionId, existingItem } = this.resolveSaveIdentity(db, {
      bookId,
      kind,
      selectionId: input.selectionId,
      itemId: input.itemId,
    })
    const existingSelection = db
      .prepare('SELECT location_status FROM reader_selections WHERE id = ? AND book_id = ? LIMIT 1')
      .get(selectionId, bookId) as { location_status: ReaderOutlineResolutionStatus } | undefined
    const locationStatus = mapSelectionLocationStatus(
      existingSelection?.location_status,
      input.locationStatus,
    )
    const body = normalizeBody(kind, input.body)
    const translationLanguage = normalizeTranslationLanguage(kind, input.translationLanguage)
    const itemId = this.resolveItemId(db, {
      bookId,
      selectionId,
      itemId: existingItem?.id || input.itemId,
      kind,
      translationLanguage,
    })
    const now = nowIso()

    db.transaction(() => {
      saveReaderSelection(db, {
        id: selectionId,
        bookId,
        source: anchor.source,
        selectedText: text,
        anchor,
        outlinePath: normalizeSelectionOutlinePath(anchor.outlinePath),
        locationStatus,
        createdAt: now,
        updatedAt: now,
      })
      saveReaderAnnotationItem(db, {
        id: itemId,
        bookId,
        selectionId,
        kind,
        text,
        ...(body ? { body } : {}),
        ...(translationLanguage ? { translationLanguage } : {}),
        anchor,
        locationStatus,
        createdAt: now,
        updatedAt: now,
      })
    })()

    return {
      itemId,
      selectionId,
      kind,
      locationStatus,
    }
  }

  deleteBookAnnotation(input: { bookId: number; itemId: string }): ReaderAnnotationDeleteResult {
    const db = this.dependencies.getDb()
    const bookId = requireBookId(input.bookId)
    const itemId = String(input.itemId ?? '').trim()
    if (!itemId) throw new Error('Invalid annotation item ID.')

    const itemRow = db
      .prepare(
        'SELECT selection_id FROM reader_annotation_items WHERE id = ? AND book_id = ? LIMIT 1',
      )
      .get(itemId, bookId) as { selection_id: string } | undefined
    if (!itemRow) {
      return { itemId, selectionId: null, selectionDeleted: false }
    }

    let selectionDeleted = false
    db.transaction(() => {
      db.prepare('DELETE FROM reader_annotation_items WHERE id = ? AND book_id = ?').run(
        itemId,
        bookId,
      )
      const remaining = db
        .prepare('SELECT count(*) AS count FROM reader_annotation_items WHERE selection_id = ?')
        .get(itemRow.selection_id) as { count: number }
      if (remaining.count === 0) {
        db.prepare('DELETE FROM reader_selections WHERE id = ? AND book_id = ?').run(
          itemRow.selection_id,
          bookId,
        )
        selectionDeleted = true
      }
    })()

    return {
      itemId,
      selectionId: itemRow.selection_id,
      selectionDeleted,
    }
  }

  private resolveSaveIdentity(
    db: Database.Database,
    input: {
      bookId: number
      kind: ReaderAnnotationKind
      selectionId?: string
      itemId?: string
    },
  ) {
    const requestedSelectionId = String(input.selectionId ?? '').trim()
    const requestedItemId = String(input.itemId ?? '').trim()
    if (requestedItemId) {
      const row = db
        .prepare(
          'SELECT id, book_id, selection_id, kind FROM reader_annotation_items WHERE id = ? LIMIT 1',
        )
        .get(requestedItemId) as
        | { id: string; book_id: number; selection_id: string; kind: ReaderAnnotationKind }
        | undefined
      if (row) {
        if (row.book_id !== input.bookId)
          throw new Error('Annotation item belongs to another book.')
        if (row.kind !== input.kind) throw new Error('Annotation kind cannot be changed.')
        if (requestedSelectionId && requestedSelectionId !== row.selection_id) {
          throw new Error('Annotation item belongs to another selection.')
        }
        return { selectionId: row.selection_id, existingItem: row }
      }
    }

    const selectionId = normalizeSelectionId(requestedSelectionId)
    const selectionOwner = db
      .prepare('SELECT book_id FROM reader_selections WHERE id = ? LIMIT 1')
      .get(selectionId) as { book_id: number } | undefined
    if (selectionOwner && selectionOwner.book_id !== input.bookId) {
      throw new Error('Selection belongs to another book.')
    }
    return { selectionId, existingItem: undefined }
  }

  private resolveItemId(
    db: Database.Database,
    input: {
      bookId: number
      selectionId: string
      itemId?: string
      kind: ReaderAnnotationKind
      translationLanguage: string | null
    },
  ) {
    const explicitId = String(input.itemId ?? '').trim()
    if (explicitId) return explicitId
    if (input.kind === 'translation' && input.translationLanguage) {
      const row = db
        .prepare(
          `SELECT id
           FROM reader_annotation_items
           WHERE book_id = ? AND selection_id = ? AND kind = 'translation' AND translation_language = ?
           ORDER BY created_at DESC, id DESC
           LIMIT 1`,
        )
        .get(input.bookId, input.selectionId, input.translationLanguage) as
        { id: string } | undefined
      if (row?.id) return row.id
    }
    if (input.kind === 'underline') {
      const row = db
        .prepare(
          `SELECT id
           FROM reader_annotation_items
           WHERE book_id = ? AND selection_id = ? AND kind = 'underline'
           ORDER BY created_at DESC, id DESC
           LIMIT 1`,
        )
        .get(input.bookId, input.selectionId) as { id: string } | undefined
      if (row?.id) return row.id
    }
    return normalizeItemId(input.itemId)
  }
}

export function createReaderAnnotationService(dependencies: ReaderAnnotationServiceDependencies) {
  return new ReaderAnnotationService(dependencies)
}
