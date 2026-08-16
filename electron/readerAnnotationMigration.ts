import type Database from 'better-sqlite3'
import {
  convertLegacyReaderAnchorToV2,
  normalizeReaderAnchorV2,
} from '../src/services/readerAnnotationSerializer'
import type { ReaderAnnotationKind } from '../src/types/readerAnnotation'
import {
  saveReaderAnnotationItem,
  saveReaderSelection,
} from './readerAnnotationStore'

type LegacyHighlightRow = {
  id: string
  book_id: number
  text: string
  annotation: string | null
  anchor: string | null
  created_at: string | null
}

const nowIso = () => new Date().toISOString()

const createFallbackAnchor = (text: string) =>
  normalizeReaderAnchorV2({
    version: 2,
    source: 'unknown',
    selectedText: text,
    positions: [{ source: 'unknown', pageNumber: 1 }],
    outlinePath: null,
  })

const getLegacyHighlightKind = (row: LegacyHighlightRow): ReaderAnnotationKind => {
  const annotation = String(row.annotation ?? '').trim()
  return annotation ? 'note' : 'underline'
}

const getLegacyHighlightLocationStatus = (anchor: ReturnType<typeof normalizeReaderAnchorV2>) => {
  const position = anchor.positions[0]
  if (position.pageNumber !== undefined && position.chapterIndex === undefined) return 'page-only'
  if (
    position.chapterIndex !== undefined ||
    position.blockOffset !== undefined ||
    position.charStart !== undefined ||
    position.charEnd !== undefined
  ) {
    return 'resolved'
  }
  return 'pending'
}

export function ensureLegacyHighlightCompatibility(db: Database.Database) {
  db.exec(`
    CREATE VIEW IF NOT EXISTS reader_highlights_compat AS
    SELECT
      items.id AS id,
      selections.book_id AS book_id,
      items.text AS text,
      COALESCE(items.body, '') AS annotation,
      selections.anchor_json AS anchor,
      items.created_at AS created_at
    FROM reader_annotation_items items
    JOIN reader_selections selections ON selections.id = items.selection_id;

    CREATE TRIGGER IF NOT EXISTS highlights_reader_annotations_insert
    AFTER INSERT ON highlights
    BEGIN
      INSERT INTO reader_selections (
        id, book_id, source, selected_text, anchor_version, anchor_json, outline_path_json,
        path_key, start_outline_node_id, end_outline_node_id, start_page, end_page,
        start_y, end_y, location_status, created_at, updated_at
      )
      VALUES (
        NEW.id,
        NEW.book_id,
        'unknown',
        NEW.text,
        2,
        NEW.anchor,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        'pending',
        COALESCE(NEW.created_at, CURRENT_TIMESTAMP),
        COALESCE(NEW.created_at, CURRENT_TIMESTAMP)
      )
      ON CONFLICT(id) DO UPDATE SET
        selected_text = excluded.selected_text,
        anchor_json = excluded.anchor_json,
        updated_at = excluded.updated_at;

      INSERT INTO reader_annotation_items (
        id, book_id, selection_id, kind, text, body, translation_language, style_token, created_at, updated_at
      )
      VALUES (
        NEW.id,
        NEW.book_id,
        NEW.id,
        CASE WHEN NULLIF(TRIM(NEW.annotation), '') IS NULL THEN 'underline' ELSE 'note' END,
        NEW.text,
        NULLIF(TRIM(NEW.annotation), ''),
        NULL,
        CASE WHEN NULLIF(TRIM(NEW.annotation), '') IS NULL
          THEN 'reader.annotation.underline'
          ELSE 'reader.annotation.note'
        END,
        COALESCE(NEW.created_at, CURRENT_TIMESTAMP),
        COALESCE(NEW.created_at, CURRENT_TIMESTAMP)
      )
      ON CONFLICT(id) DO UPDATE SET
        kind = excluded.kind,
        text = excluded.text,
        body = excluded.body,
        translation_language = excluded.translation_language,
        style_token = excluded.style_token,
        updated_at = excluded.updated_at;
    END;

    CREATE TRIGGER IF NOT EXISTS highlights_reader_annotations_update
    AFTER UPDATE OF text, annotation, anchor ON highlights
    BEGIN
      INSERT INTO reader_selections (
        id, book_id, source, selected_text, anchor_version, anchor_json, outline_path_json,
        path_key, start_outline_node_id, end_outline_node_id, start_page, end_page,
        start_y, end_y, location_status, created_at, updated_at
      )
      VALUES (
        NEW.id,
        NEW.book_id,
        'unknown',
        NEW.text,
        2,
        NEW.anchor,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        NULL,
        'pending',
        COALESCE(NEW.created_at, CURRENT_TIMESTAMP),
        CURRENT_TIMESTAMP
      )
      ON CONFLICT(id) DO UPDATE SET
        selected_text = excluded.selected_text,
        anchor_json = excluded.anchor_json,
        updated_at = excluded.updated_at;

      INSERT INTO reader_annotation_items (
        id, book_id, selection_id, kind, text, body, translation_language, style_token, created_at, updated_at
      )
      VALUES (
        NEW.id,
        NEW.book_id,
        NEW.id,
        CASE WHEN NULLIF(TRIM(NEW.annotation), '') IS NULL THEN 'underline' ELSE 'note' END,
        NEW.text,
        NULLIF(TRIM(NEW.annotation), ''),
        NULL,
        CASE WHEN NULLIF(TRIM(NEW.annotation), '') IS NULL
          THEN 'reader.annotation.underline'
          ELSE 'reader.annotation.note'
        END,
        COALESCE(NEW.created_at, CURRENT_TIMESTAMP),
        CURRENT_TIMESTAMP
      )
      ON CONFLICT(id) DO UPDATE SET
        kind = excluded.kind,
        text = excluded.text,
        body = excluded.body,
        translation_language = excluded.translation_language,
        style_token = excluded.style_token,
        updated_at = excluded.updated_at;
    END;

    CREATE TRIGGER IF NOT EXISTS highlights_reader_annotations_delete
    AFTER DELETE ON highlights
    BEGIN
      DELETE FROM reader_annotation_items WHERE id = OLD.id;
      DELETE FROM reader_selections WHERE id = OLD.id;
    END;
  `)
}

export function migrateLegacyHighlights(db: Database.Database) {
  const rows = db.prepare('SELECT id, book_id, text, annotation, anchor, created_at FROM highlights ORDER BY created_at, id').all() as LegacyHighlightRow[]
  const migrate = db.transaction(() => {
    for (const row of rows) {
      const createdAt = row.created_at || nowIso()
      const kind = getLegacyHighlightKind(row)
      let anchor
      let locationStatus: 'pending' | 'resolved' | 'page-only' | 'error'
      try {
        anchor = row.anchor ? convertLegacyReaderAnchorToV2(JSON.parse(row.anchor)) : createFallbackAnchor(row.text)
        locationStatus = getLegacyHighlightLocationStatus(anchor)
      } catch {
        anchor = createFallbackAnchor(row.text)
        locationStatus = 'error'
      }

      const selection = saveReaderSelection(db, {
        id: row.id,
        bookId: row.book_id,
        source: anchor.source,
        selectedText: row.text,
        anchor,
        outlinePath: anchor.outlinePath,
        locationStatus,
        createdAt,
        updatedAt: createdAt,
      })

      saveReaderAnnotationItem(db, {
        id: row.id,
        bookId: row.book_id,
        selectionId: selection.id,
        kind,
        text: row.text,
        body: kind === 'note' ? String(row.annotation ?? '').trim() || undefined : undefined,
        anchor: selection.anchor,
        locationStatus,
        createdAt,
        updatedAt: createdAt,
      })
    }
  })
  migrate()
}

export function readLegacyHighlightsCompat(db: Database.Database, bookId: number) {
  const selectionCount = db
    .prepare('SELECT count(*) AS count FROM reader_annotation_items items WHERE items.book_id = ?')
    .get(bookId) as { count: number }
  if (selectionCount.count > 0) {
    return db
      .prepare(
        `
        SELECT
          items.id AS id,
          items.book_id AS book_id,
          items.text AS text,
          COALESCE(items.body, '') AS annotation,
          selections.anchor_json AS anchor,
          items.created_at AS created_at
        FROM reader_annotation_items items
        JOIN reader_selections selections ON selections.id = items.selection_id
        WHERE items.book_id = ?
        ORDER BY COALESCE(selections.start_page, 0), COALESCE(selections.start_y, 0), items.created_at, items.id
      `,
      )
      .all(bookId)
  }

  return db
    .prepare('SELECT id, book_id, text, annotation, anchor, created_at FROM highlights WHERE book_id = ? ORDER BY created_at, id')
    .all(bookId)
}
