import type Database from 'better-sqlite3'
import {
  normalizeReaderAnnotationItem,
  normalizeReaderSelection,
} from '../src/services/readerAnnotationSerializer'
import type {
  OutlinePathSnapshot,
  ReaderAnnotationItem,
  ReaderDocumentSource,
  ReaderOutlineRunState,
  ReaderSelection,
} from '../src/types/readerAnnotation'

export type ReaderOutlineRunInput = {
  id: string
  bookId: number
  source: ReaderDocumentSource
  parserVersion: string
  contentHash?: string | null
  pageCount?: number | null
  state: ReaderOutlineRunState
  progress?: number
  errorMessage?: string | null
  startedAt?: string | null
  completedAt?: string | null
}

export type ReaderOutlineRunRecord = ReaderOutlineRunInput & {
  contentHash: string
  pageCount: number
  createdAt: string
  updatedAt: string
}

export type ReaderOutlineNodeInput = {
  id: string
  bookId: number
  runId: string
  source: ReaderDocumentSource
  parentId?: string | null
  title: string
  level: number
  pathKey: string
  sortOrder: number
  pageStart?: number | null
  pageEnd?: number | null
  yStart?: number | null
  yEnd?: number | null
  locator?: unknown
  confidence?: number | null
}

type ReaderSelectionRow = {
  id: string
  book_id: number
  source: ReaderDocumentSource
  selected_text: string
  anchor_json: string
  outline_path_json: string | null
  location_status: ReaderSelection['locationStatus']
  created_at: string
  updated_at: string
}

type ReaderAnnotationItemRow = {
  id: string
  book_id: number
  selection_id: string
  kind: ReaderAnnotationItem['kind']
  text: string
  body: string | null
  translation_language: string | null
  style_token: string
  created_at: string
  updated_at: string
}

const DOCUMENT_SOURCE_CHECK = "CHECK(source IN ('pdf', 'ocr', 'epub', 'unknown'))"
const OUTLINE_STATUS_CHECK = "CHECK(location_status IN ('pending', 'resolved', 'page-only', 'error'))"
const OUTLINE_RUN_STATE_CHECK =
  "CHECK(state IN ('idle', 'queued', 'running', 'completed', 'cancelled', 'failed'))"
const ANNOTATION_KIND_CHECK = "CHECK(kind IN ('translation', 'underline', 'note'))"

const jsonOrNull = (value: unknown) => (value === undefined || value === null ? null : JSON.stringify(value))

const normalizeContentHash = (value: string | null | undefined) => value?.trim() || ''

const normalizePageCount = (value: number | null | undefined) => {
  if (value === undefined || value === null) return 0
  if (!Number.isInteger(value) || value < 0) throw new Error('pageCount must be an integer >= 0.')
  return value
}

const normalizeProgress = (value: number | undefined) => {
  if (value === undefined) return 0
  if (!Number.isFinite(value)) throw new Error('progress must be numeric.')
  return Math.min(1, Math.max(0, value))
}

const getDefaultStyleToken = (kind: ReaderAnnotationItem['kind']) => {
  switch (kind) {
    case 'translation':
      return 'reader.annotation.translation'
    case 'note':
      return 'reader.annotation.note'
    case 'underline':
    default:
      return 'reader.annotation.underline'
  }
}

const getFirstPosition = (selection: ReaderSelection) => selection.anchor.positions[0]
const getLastPosition = (selection: ReaderSelection) =>
  selection.anchor.positions[selection.anchor.positions.length - 1]

const getPathKey = (outlinePath: OutlinePathSnapshot | null) => outlinePath?.pathKey || null

const resolveOutlineNodeId = (db: Database.Database, outlinePath: OutlinePathSnapshot | null) => {
  const nodeId = outlinePath?.nodes[outlinePath.nodes.length - 1]?.id
  if (!nodeId) return null
  const row = db.prepare('SELECT id FROM book_outline_nodes WHERE id = ?').get(nodeId) as
    | { id: string }
    | undefined
  return row?.id ?? null
}

export function ensureReaderAnnotationSchema(db: Database.Database) {
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE IF NOT EXISTS book_outline_runs (
      id TEXT PRIMARY KEY,
      book_id INTEGER NOT NULL,
      source TEXT NOT NULL ${DOCUMENT_SOURCE_CHECK},
      parser_version TEXT NOT NULL,
      content_hash TEXT NOT NULL DEFAULT '',
      page_count INTEGER NOT NULL DEFAULT 0 CHECK(page_count >= 0),
      state TEXT NOT NULL ${OUTLINE_RUN_STATE_CHECK},
      progress REAL NOT NULL DEFAULT 0 CHECK(progress >= 0 AND progress <= 1),
      error_message TEXT,
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(book_id, source, parser_version, content_hash, page_count),
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS book_outline_nodes (
      id TEXT PRIMARY KEY,
      book_id INTEGER NOT NULL,
      run_id TEXT NOT NULL,
      source TEXT NOT NULL ${DOCUMENT_SOURCE_CHECK},
      parent_id TEXT,
      title TEXT NOT NULL,
      level INTEGER NOT NULL CHECK(level >= 0),
      path_key TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      page_start INTEGER CHECK(page_start IS NULL OR page_start >= 1),
      page_end INTEGER CHECK(page_end IS NULL OR page_end >= 1),
      y_start REAL,
      y_end REAL,
      locator_json TEXT,
      confidence REAL CHECK(confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(book_id, run_id, path_key),
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
      FOREIGN KEY (run_id) REFERENCES book_outline_runs(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_id) REFERENCES book_outline_nodes(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS reader_selections (
      id TEXT PRIMARY KEY,
      book_id INTEGER NOT NULL,
      source TEXT NOT NULL ${DOCUMENT_SOURCE_CHECK},
      selected_text TEXT NOT NULL,
      anchor_version INTEGER NOT NULL DEFAULT 2 CHECK(anchor_version = 2),
      anchor_json TEXT NOT NULL,
      outline_path_json TEXT,
      path_key TEXT,
      start_outline_node_id TEXT,
      end_outline_node_id TEXT,
      start_page INTEGER CHECK(start_page IS NULL OR start_page >= 1),
      end_page INTEGER CHECK(end_page IS NULL OR end_page >= 1),
      start_y REAL,
      end_y REAL,
      location_status TEXT NOT NULL DEFAULT 'pending' ${OUTLINE_STATUS_CHECK},
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
      FOREIGN KEY (start_outline_node_id) REFERENCES book_outline_nodes(id) ON DELETE SET NULL,
      FOREIGN KEY (end_outline_node_id) REFERENCES book_outline_nodes(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS reader_annotation_items (
      id TEXT PRIMARY KEY,
      book_id INTEGER NOT NULL,
      selection_id TEXT NOT NULL,
      kind TEXT NOT NULL ${ANNOTATION_KIND_CHECK},
      text TEXT NOT NULL,
      body TEXT,
      translation_language TEXT,
      style_token TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      CHECK(
        (kind = 'translation' AND body IS NOT NULL AND TRIM(body) <> '' AND translation_language IS NOT NULL AND TRIM(translation_language) <> '')
        OR (kind = 'note' AND body IS NOT NULL AND TRIM(body) <> '' AND translation_language IS NULL)
        OR (kind = 'underline' AND (body IS NULL OR TRIM(body) = '') AND translation_language IS NULL)
      ),
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
      FOREIGN KEY (selection_id) REFERENCES reader_selections(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS book_outline_runs_book_state_idx
      ON book_outline_runs (book_id, state, updated_at);
    CREATE INDEX IF NOT EXISTS book_outline_nodes_book_parent_idx
      ON book_outline_nodes (book_id, parent_id, sort_order);
    CREATE INDEX IF NOT EXISTS book_outline_nodes_page_locator_idx
      ON book_outline_nodes (book_id, page_start, y_start, sort_order);
    CREATE INDEX IF NOT EXISTS book_outline_nodes_path_idx
      ON book_outline_nodes (book_id, path_key);
    CREATE INDEX IF NOT EXISTS reader_selections_book_status_path_idx
      ON reader_selections (book_id, location_status, path_key, start_page, start_y);
    CREATE INDEX IF NOT EXISTS reader_annotation_items_book_kind_idx
      ON reader_annotation_items (book_id, kind, created_at);
    CREATE INDEX IF NOT EXISTS reader_annotation_items_selection_idx
      ON reader_annotation_items (selection_id, kind, created_at);
    CREATE UNIQUE INDEX IF NOT EXISTS reader_annotation_items_translation_language_idx
      ON reader_annotation_items (selection_id, translation_language)
      WHERE kind = 'translation';
  `)
}

export function upsertOutlineRun(db: Database.Database, input: ReaderOutlineRunInput) {
  const contentHash = normalizeContentHash(input.contentHash)
  const pageCount = normalizePageCount(input.pageCount)
  const progress = normalizeProgress(input.progress)
  const existing = db
    .prepare(
      `SELECT id
       FROM book_outline_runs
       WHERE book_id = ? AND source = ? AND parser_version = ? AND content_hash = ? AND page_count = ?`,
    )
    .get(input.bookId, input.source, input.parserVersion, contentHash, pageCount) as
    | { id: string }
    | undefined

  if (existing) {
    db.prepare(
      `UPDATE book_outline_runs
       SET state = ?, progress = ?, error_message = ?, started_at = ?, completed_at = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).run(
      input.state,
      progress,
      input.errorMessage ?? null,
      input.startedAt ?? null,
      input.completedAt ?? null,
      existing.id,
    )
    return existing.id
  }

  db.prepare(
    `INSERT INTO book_outline_runs (
       id, book_id, source, parser_version, content_hash, page_count, state, progress,
       error_message, started_at, completed_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.bookId,
    input.source,
    input.parserVersion,
    contentHash,
    pageCount,
    input.state,
    progress,
    input.errorMessage ?? null,
    input.startedAt ?? null,
    input.completedAt ?? null,
  )
  return input.id
}

export function replaceOutlineNodesForRun(
  db: Database.Database,
  runId: string,
  nodes: ReaderOutlineNodeInput[],
) {
  const insertNode = db.prepare(
    `INSERT INTO book_outline_nodes (
       id, book_id, run_id, source, parent_id, title, level, path_key, sort_order,
       page_start, page_end, y_start, y_end, locator_json, confidence
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  const replaceNodes = db.transaction(() => {
    db.prepare('DELETE FROM book_outline_nodes WHERE run_id = ?').run(runId)
    const sortedNodes = [...nodes].sort((left, right) => left.level - right.level || left.sortOrder - right.sortOrder)
    for (const node of sortedNodes) {
      insertNode.run(
        node.id,
        node.bookId,
        runId,
        node.source,
        node.parentId ?? null,
        node.title.trim(),
        node.level,
        node.pathKey,
        node.sortOrder,
        node.pageStart ?? null,
        node.pageEnd ?? null,
        node.yStart ?? null,
        node.yEnd ?? null,
        jsonOrNull(node.locator),
        node.confidence ?? null,
      )
    }
  })
  replaceNodes()
}

export function saveReaderSelection(db: Database.Database, value: unknown) {
  const selection = normalizeReaderSelection(value)
  const firstPosition = getFirstPosition(selection)
  const lastPosition = getLastPosition(selection)
  const outlineNodeId = resolveOutlineNodeId(db, selection.outlinePath)
  db.prepare(
    `INSERT INTO reader_selections (
       id, book_id, source, selected_text, anchor_version, anchor_json, outline_path_json,
       path_key, start_outline_node_id, end_outline_node_id, start_page, end_page,
       start_y, end_y, location_status, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, 2, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       selected_text = excluded.selected_text,
       anchor_json = excluded.anchor_json,
       outline_path_json = excluded.outline_path_json,
       path_key = excluded.path_key,
       start_outline_node_id = excluded.start_outline_node_id,
       end_outline_node_id = excluded.end_outline_node_id,
       start_page = excluded.start_page,
       end_page = excluded.end_page,
       start_y = excluded.start_y,
       end_y = excluded.end_y,
       location_status = excluded.location_status,
       updated_at = excluded.updated_at`,
  ).run(
    selection.id,
    selection.bookId,
    selection.source,
    selection.selectedText,
    JSON.stringify(selection.anchor),
    jsonOrNull(selection.outlinePath),
    getPathKey(selection.outlinePath),
    outlineNodeId,
    outlineNodeId,
    firstPosition.pageNumber ?? null,
    lastPosition.pageNumber ?? null,
    firstPosition.y ?? null,
    lastPosition.y ?? null,
    selection.locationStatus,
    selection.createdAt,
    selection.updatedAt,
  )
  return selection
}

export function saveReaderAnnotationItem(db: Database.Database, value: unknown) {
  const item = normalizeReaderAnnotationItem(value)
  const styleToken = getDefaultStyleToken(item.kind)
  db.prepare(
    `INSERT INTO reader_annotation_items (
       id, book_id, selection_id, kind, text, body, translation_language, style_token, created_at, updated_at
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       kind = excluded.kind,
       text = excluded.text,
       body = excluded.body,
       translation_language = excluded.translation_language,
       style_token = excluded.style_token,
       updated_at = excluded.updated_at`,
  ).run(
    item.id,
    item.bookId,
    item.selectionId,
    item.kind,
    item.text,
    item.body ?? null,
    item.translationLanguage ?? null,
    styleToken,
    item.createdAt,
    item.updatedAt,
  )
  return item
}

export function listReaderSelectionsByBook(
  db: Database.Database,
  bookId: number,
  options: { locationStatus?: ReaderSelection['locationStatus']; pathKey?: string } = {},
) {
  const clauses = ['book_id = ?']
  const params: Array<number | string> = [bookId]
  if (options.locationStatus) {
    clauses.push('location_status = ?')
    params.push(options.locationStatus)
  }
  if (options.pathKey) {
    clauses.push('path_key = ?')
    params.push(options.pathKey)
  }
  const rows = db
    .prepare(
      `SELECT *
       FROM reader_selections
       WHERE ${clauses.join(' AND ')}
       ORDER BY COALESCE(start_page, 0), COALESCE(start_y, 0), created_at, id`,
    )
    .all(...params) as ReaderSelectionRow[]
  return rows.map((row) =>
    normalizeReaderSelection({
      id: row.id,
      bookId: row.book_id,
      source: row.source,
      selectedText: row.selected_text,
      anchor: JSON.parse(row.anchor_json),
      locationStatus: row.location_status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }),
  )
}

export function listReaderAnnotationItemsByBook(
  db: Database.Database,
  bookId: number,
  options: { kind?: ReaderAnnotationItem['kind'] } = {},
) {
  const clauses = ['items.book_id = ?']
  const params: Array<number | string> = [bookId]
  if (options.kind) {
    clauses.push('items.kind = ?')
    params.push(options.kind)
  }
  const rows = db
    .prepare(
      `SELECT items.*
       FROM reader_annotation_items items
       JOIN reader_selections selections ON selections.id = items.selection_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY COALESCE(selections.start_page, 0), COALESCE(selections.start_y, 0), items.created_at, items.id`,
    )
    .all(...params) as ReaderAnnotationItemRow[]
  return rows
}
