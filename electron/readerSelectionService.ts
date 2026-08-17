import type Database from 'better-sqlite3'
import {
  getLatestCompletedOutlineRunForBook,
  listOutlineNodesForRun,
  listPendingReaderSelectionsByBook,
  updateReaderSelectionOutlineLocation,
} from './readerAnnotationStore'
import { normalizeReaderAnchorV2 } from '../src/services/readerAnnotationSerializer'
import { resolveSelectionOutlineLocation } from '../src/services/selectionOutlineResolver'
import type { ReaderDocumentSource } from '../src/types/readerAnnotation'

export type ReaderSelectionReconcileResult = {
  bookId: number
  resolved: number
  pageOnly: number
  error: number
  skipped: number
}

export type ReaderSelectionServiceDependencies = {
  getDb: () => Database.Database
}

export class ReaderSelectionService {
  constructor(private readonly dependencies: ReaderSelectionServiceDependencies) {}

  reconcileBookSelections(bookId: number, source?: ReaderDocumentSource) {
    const db = this.dependencies.getDb()
    const outlineRun = source
      ? getLatestCompletedOutlineRunForBook(db, { bookId, source })
      : undefined
    const outlineNodes = outlineRun
      ? listOutlineNodesForRun(db, outlineRun.id).map((row) => {
          let analysisSource: 'native' | 'tagged' | 'inferred' | 'page-only' | undefined
          try {
            const locator = row.locator_json ? (JSON.parse(row.locator_json) as { analysisSource?: typeof analysisSource }) : null
            analysisSource = locator?.analysisSource
          } catch {
            analysisSource = undefined
          }
          return {
            id: row.id,
            title: row.title,
            level: row.level,
            parentId: row.parent_id,
            pathKey: row.path_key,
            sortOrder: row.sort_order,
            pageStart: row.page_start,
            pageEnd: row.page_end,
            yStart: row.y_start,
            yEnd: row.y_end,
            source: row.source,
            analysisSource,
          }
        })
      : []
    const pendingSelections = listPendingReaderSelectionsByBook(db, bookId)
    const result: ReaderSelectionReconcileResult = {
      bookId,
      resolved: 0,
      pageOnly: 0,
      error: 0,
      skipped: 0,
    }

    for (const selection of pendingSelections) {
      try {
        const rawAnchor = JSON.parse(selection.anchor_json)
        const anchor = normalizeReaderAnchorV2(rawAnchor)
        const hasEpubChapter = anchor.positions.some((position) => Number.isInteger(position.chapterIndex))
        if (outlineNodes.length === 0 && !hasEpubChapter && !anchor.outlinePath?.nodes?.length) {
          result.skipped += 1
          continue
        }
        const resolved = resolveSelectionOutlineLocation({
          anchor: rawAnchor,
          source: selection.source,
          outlineNodes,
        })
        if (resolved.locationStatus === 'pending') {
          result.skipped += 1
          continue
        }
        updateReaderSelectionOutlineLocation(db, {
          selectionId: selection.id,
          bookId,
          outlinePath: resolved.outlinePath,
          locationStatus: resolved.locationStatus,
          pathKey: resolved.pathKey,
          startOutlineNodeId: resolved.startOutlineNodeId,
          endOutlineNodeId: resolved.endOutlineNodeId,
          startPage: resolved.startPage,
          endPage: resolved.endPage,
          startY: resolved.startY,
          endY: resolved.endY,
        })
        if (resolved.locationStatus === 'resolved') result.resolved += 1
        else if (resolved.locationStatus === 'page-only') result.pageOnly += 1
        else result.error += 1
      } catch {
        result.error += 1
      }
    }

    return result
  }
}

export function createReaderSelectionService(dependencies: ReaderSelectionServiceDependencies) {
  return new ReaderSelectionService(dependencies)
}
