import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import { Worker } from 'node:worker_threads'
import type Database from 'better-sqlite3'
import { createPdfInspectorWorkerSource } from './worker/pdfInspectorWorker'
import {
  getOutlineRunByKey,
  listOutlineNodesForRun,
  replaceOutlineNodesForRun,
  upsertOutlineRun,
  type ReaderOutlineNodeInput,
  type ReaderOutlineRunInput,
} from './readerAnnotationStore'
import type {
  PdfOutlineEntry,
  PdfOutlineEntrySource,
} from '../src/services/pdfOutlineAdapter'
import type { ReaderDocumentSource, ReaderOutlineRunState } from '../src/types/readerAnnotation'

export const PDF_INSPECTOR_PARSER_VERSION = '@firecrawl/pdf-inspector@1.14.2'

export type ReaderOutlineAnalysisProgress = {
  bookId: number
  state: ReaderOutlineRunState
  phase: string
  progress: number
  message: string
  cacheStatus?: 'hit' | 'miss'
}

export type ReaderOutlineAnalysisRequest = {
  bookId: number
  source: ReaderDocumentSource
  filePath: string
  pageCount: number
  parserVersion?: string
}

export type ReaderOutlineAnalysisResult =
  | {
      status: 'ready'
      cacheStatus: 'hit' | 'miss'
      source: PdfOutlineEntrySource
      pageCount: number
      parserVersion: string
      contentHash: string
      entries: PdfOutlineEntry[]
      runId: string
    }
  | {
      status: 'empty'
      cacheStatus: 'hit' | 'miss'
      source: null
      pageCount: number
      parserVersion: string
      contentHash: string
      entries: []
      runId: string
    }
  | {
      status: 'cancelled'
      cacheStatus: 'miss'
      source: null
      pageCount: number
      parserVersion: string
      contentHash: string
      entries: []
      runId: string
    }
  | {
      status: 'error'
      cacheStatus: 'miss'
      source: null
      pageCount: number
      parserVersion: string
      contentHash: string
      entries: []
      error: string
      runId: string
    }

type ActiveTask = {
  key: string
  runId: string
  worker: Worker
  listeners: Set<(event: ReaderOutlineAnalysisProgress) => void>
  promise: Promise<ReaderOutlineAnalysisResult>
  cancel: () => void
}

type ReaderOutlineWorkerLike = Pick<Worker, 'once' | 'on' | 'terminate'>

type OutlineRunRow = {
  id: string
  state: ReaderOutlineRunState
  progress: number
  error_message: string | null
  content_hash: string
  page_count: number
  parser_version: string
  source: ReaderDocumentSource
}

type OutlineNodeRow = {
  id: string
  parent_id: string | null
  title: string
  level: number
  path_key: string
  page_start: number | null
  page_end: number | null
  y_start: number | null
  y_end: number | null
  locator_json: string | null
  source: ReaderDocumentSource
}

export type ReaderOutlineServiceDependencies = {
  getDb: () => Database.Database
  readFile?: (filePath: string) => Promise<Buffer>
  createWorker?: (input: {
    buffer: Buffer
    parserVersion: string
    contentHash: string
  }) => ReaderOutlineWorkerLike
  reconcileSelections?: (bookId: number, source: ReaderDocumentSource) => void
  markSelectionsError?: (bookId: number, source: ReaderDocumentSource) => void
}

export type ReaderOutlineServiceIpcProgressListener = (event: ReaderOutlineAnalysisProgress) => void

const normalizePageCount = (value: number) => {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error('The PDF page count must be a non-negative integer.')
  }
  return value
}

const normalizeParserVersion = (value: unknown) =>
  typeof value === 'string' && value.trim() ? value.trim() : PDF_INSPECTOR_PARSER_VERSION

const hashBuffer = (buffer: Buffer) => crypto.createHash('sha256').update(buffer).digest('hex')

const buildCacheKey = (
  bookId: number,
  source: ReaderDocumentSource,
  parserVersion: string,
  contentHash: string,
  pageCount: number,
) => [bookId, source, parserVersion, contentHash, pageCount].join(':')

const mapNodeRowsToEntries = (rows: OutlineNodeRow[]) => {
  const childrenCount = new Map<string, number>()
  for (const row of rows) {
    if (!row.parent_id) continue
    childrenCount.set(row.parent_id, (childrenCount.get(row.parent_id) || 0) + 1)
  }
  return rows.map<PdfOutlineEntry>((row) => ({
    analysisSource: (() => {
      try {
        const locator = row.locator_json
          ? (JSON.parse(row.locator_json) as { analysisSource?: PdfOutlineEntrySource })
          : null
        return locator?.analysisSource ?? (row.source === 'pdf' ? 'native' : 'page-only')
      } catch {
        return row.source === 'pdf' ? 'native' : 'page-only'
      }
    })(),
    id: row.id,
    title: row.title,
    level: row.level,
    pathKey: row.path_key,
    parentPathKey: row.parent_id,
    pageNumber: row.page_start,
    y: row.y_start,
    destination: row.page_start ? `page:${row.page_start}` : null,
    resolved: row.page_start !== null,
    childrenCount: childrenCount.get(row.id) || 0,
  }))
}

export class ReaderOutlineService {
  private readonly activeTasks = new Map<number, ActiveTask>()

  constructor(private readonly dependencies: ReaderOutlineServiceDependencies) {}

  cancel(bookId: number) {
    this.activeTasks.get(bookId)?.cancel()
  }

  async analyze(request: ReaderOutlineAnalysisRequest, onProgress?: ReaderOutlineServiceIpcProgressListener) {
    const pageCount = normalizePageCount(request.pageCount)
    const parserVersion = normalizeParserVersion(request.parserVersion)
    const db = this.dependencies.getDb()
    const buffer = await (this.dependencies.readFile ?? fs.readFile)(request.filePath)
    const contentHash = hashBuffer(buffer)
    const cacheKey = buildCacheKey(request.bookId, request.source, parserVersion, contentHash, pageCount)
    const cached = this.readCachedOutline(db, request.bookId, request.source, parserVersion, contentHash, pageCount)
    if (cached) {
      this.dependencies.reconcileSelections?.(request.bookId, request.source)
      onProgress?.({
        bookId: request.bookId,
        state: 'completed',
        phase: 'cached',
        progress: 1,
        message: 'Using cached outline analysis.',
        cacheStatus: 'hit',
      })
      return cached
    }

    const existingTask = this.activeTasks.get(request.bookId)
    if (existingTask && existingTask.key === cacheKey) {
      if (onProgress) existingTask.listeners.add(onProgress)
      return existingTask.promise
    }

    if (existingTask) existingTask.cancel()

    const existingRun = getOutlineRunByKey(db, {
      bookId: request.bookId,
      source: request.source,
      parserVersion,
      contentHash,
      pageCount,
    })
    const runId = existingRun?.id ?? `outline-${request.bookId}-${crypto.randomUUID()}`
    const startedAt = new Date().toISOString()
    const listeners = new Set<(event: ReaderOutlineAnalysisProgress) => void>()
    if (onProgress) listeners.add(onProgress)
    const worker = this.dependencies.createWorker
      ? this.dependencies.createWorker({ buffer, parserVersion, contentHash })
      : new Worker(createPdfInspectorWorkerSource(), {
          eval: true,
          workerData: {
            buffer,
            parserVersion,
            contentHash,
          },
        })

    const notify = (event: ReaderOutlineAnalysisProgress) => {
      for (const listener of listeners) listener(event)
    }

    const persistRun = (
      state: ReaderOutlineRunState,
      progress: number,
      errorMessage: string | null,
      completedAt?: string | null,
    ) => {
      const runInput: ReaderOutlineRunInput = {
        id: runId,
        bookId: request.bookId,
        source: request.source,
        parserVersion,
        contentHash,
        pageCount,
        state,
        progress,
        errorMessage,
        startedAt,
        completedAt: completedAt ?? null,
      }
      upsertOutlineRun(db, runInput)
      return runInput
    }

    const finalize = (result: ReaderOutlineAnalysisResult) => {
      if (this.activeTasks.get(request.bookId)?.key === cacheKey) {
        this.activeTasks.delete(request.bookId)
      }
      return result
    }

    const markSelectionsError = () => {
      try {
        this.dependencies.markSelectionsError?.(request.bookId, request.source)
      } catch {
        // Outline failure reporting must not hide the original parser error.
      }
    }

    let settled = false
    let cancelTask: (() => void) | null = null

    const promise = new Promise<ReaderOutlineAnalysisResult>((resolve) => {
      const settle = (result: ReaderOutlineAnalysisResult) => {
        if (settled) return
        settled = true
        resolve(finalize(result))
      }

      worker.once('error', (error) => {
        markSelectionsError()
        persistRun('failed', 1, error instanceof Error ? error.message : String(error), new Date().toISOString())
        notify({
          bookId: request.bookId,
          state: 'failed',
          phase: 'error',
          progress: 1,
          message: error instanceof Error ? error.message : String(error),
          cacheStatus: 'miss',
        })
        settle({
          status: 'error',
          cacheStatus: 'miss',
          source: null,
          pageCount,
          parserVersion,
          contentHash,
          entries: [],
          error: error instanceof Error ? error.message : String(error),
          runId,
        })
      })
      worker.once('exit', (code) => {
        if (code === 0 || settled) return
        markSelectionsError()
        const error = `pdf-inspector worker exited with code ${code}.`
        persistRun('failed', 1, error, new Date().toISOString())
        notify({
          bookId: request.bookId,
          state: 'failed',
          phase: 'error',
          progress: 1,
          message: error,
          cacheStatus: 'miss',
        })
        settle({
          status: 'error',
          cacheStatus: 'miss',
          source: null,
          pageCount,
          parserVersion,
          contentHash,
          entries: [],
          error,
          runId,
        })
      })
      worker.on('message', (message: unknown) => {
        if (!message || typeof message !== 'object') return
        const payload = message as { type?: string; data?: any; error?: unknown }
        if (payload.type === 'progress' && payload.data) {
          persistRun('running', Number(payload.data.progress) || 0, null, null)
          notify({
            bookId: request.bookId,
            state: 'running',
            phase: String(payload.data.phase || 'running'),
            progress: Number(payload.data.progress) || 0,
            message: String(payload.data.message || 'Analyzing outline...'),
            cacheStatus: 'miss',
          })
          return
        }
        if (payload.type === 'result' && payload.data) {
          const resultData = payload.data as {
            source: PdfOutlineEntrySource | null
            pageCount: number
            entries: PdfOutlineEntry[]
          }
          const entries = Array.isArray(resultData.entries) ? resultData.entries : []
          if (entries.length === 0) {
            persistRun('completed', 1, null, new Date().toISOString())
            settle({
              status: 'empty',
              cacheStatus: 'miss',
              source: null,
              pageCount: resultData.pageCount || pageCount,
              parserVersion,
              contentHash,
              entries: [],
              runId,
            })
            return
          }
          const normalizedEntries = entries.map((entry) => ({
            ...entry,
            analysisSource: entry.analysisSource ?? (resultData.source ?? 'page-only'),
          }))
          const completedAt = new Date().toISOString()
          persistRun('completed', 1, null, completedAt)
          replaceOutlineNodesForRun(
            db,
            runId,
            normalizedEntries.map<ReaderOutlineNodeInput>((entry, index) => ({
              id: entry.id,
              bookId: request.bookId,
              runId,
              source: request.source,
              parentId: entry.parentPathKey,
              title: entry.title,
              level: entry.level,
              pathKey: entry.pathKey,
              sortOrder: index,
              pageStart: entry.pageNumber,
              pageEnd: entry.pageNumber,
              yStart: entry.y,
              yEnd: entry.y,
              locator: { destination: entry.destination, analysisSource: entry.analysisSource },
              confidence:
                entry.analysisSource === 'tagged'
                  ? 1
                  : entry.analysisSource === 'inferred'
                    ? 0.84
                    : 0.6,
              })),
          )
          this.dependencies.reconcileSelections?.(request.bookId, request.source)
          settle({
            status: 'ready',
            cacheStatus: 'miss',
            source: resultData.source ?? 'page-only',
            pageCount: resultData.pageCount || pageCount,
            parserVersion,
            contentHash,
            entries: normalizedEntries,
            runId,
          })
          return
        }
        if (payload.type === 'error') {
          markSelectionsError()
          const errorMessage = String(payload.error || 'Outline analysis failed.')
          persistRun('failed', 1, errorMessage, new Date().toISOString())
          settle({
            status: 'error',
            cacheStatus: 'miss',
            source: null,
            pageCount,
            parserVersion,
            contentHash,
            entries: [],
            error: errorMessage,
            runId,
          })
        }
      })

      cancelTask = () => {
        if (settled) return
        persistRun('cancelled', 0, 'Outline analysis cancelled.', new Date().toISOString())
        notify({
          bookId: request.bookId,
          state: 'cancelled',
          phase: 'cancelled',
          progress: 0,
          message: 'Outline analysis cancelled.',
          cacheStatus: 'miss',
        })
        void worker.terminate()
        settle({
          status: 'cancelled',
          cacheStatus: 'miss',
          source: null,
          pageCount,
          parserVersion,
          contentHash,
          entries: [],
          runId,
        })
      }
    })

    const task: ActiveTask = {
      key: cacheKey,
      runId,
      worker,
      listeners,
      promise,
      cancel: () => cancelTask?.(),
    }
    this.activeTasks.set(request.bookId, task)

    notify({
      bookId: request.bookId,
      state: 'queued',
      phase: 'queued',
      progress: 0,
      message: 'Outline analysis queued.',
      cacheStatus: 'miss',
    })
    persistRun('queued', 0, null, null)

    return promise
  }

  private readCachedOutline(
    db: Database.Database,
    bookId: number,
    source: ReaderDocumentSource,
    parserVersion: string,
    contentHash: string,
    pageCount: number,
  ) {
    const run = db
      .prepare(
        `SELECT id, state, progress, error_message, content_hash, page_count, parser_version, source
         FROM book_outline_runs
         WHERE book_id = ? AND source = ? AND parser_version = ? AND content_hash = ? AND page_count = ? AND state = 'completed'
         ORDER BY updated_at DESC
         LIMIT 1`,
      )
      .get(bookId, source, parserVersion, contentHash, pageCount) as OutlineRunRow | undefined
    if (!run) return null
    const nodeRows = listOutlineNodesForRun(db, run.id)
    if (nodeRows.length === 0) return null
    const entries = mapNodeRowsToEntries(nodeRows)
    return {
      status: 'ready' as const,
      cacheStatus: 'hit' as const,
      source: entries[0]?.analysisSource ?? 'page-only',
      pageCount: run.page_count,
      parserVersion: run.parser_version,
      contentHash: run.content_hash,
      entries,
      runId: run.id,
    }
  }
}

export function createReaderOutlineService(dependencies: ReaderOutlineServiceDependencies) {
  return new ReaderOutlineService(dependencies)
}
