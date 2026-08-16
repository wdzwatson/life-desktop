import type { ReaderDocumentSource } from '../src/types/readerAnnotation'
import type {
  ReaderOutlineAnalysisProgress,
  ReaderOutlineAnalysisRequest,
  ReaderOutlineService,
} from './readerOutlineService'

export const READER_OUTLINE_CHANNELS = [
  'reader:outline:analyze',
  'reader:outline:cancel',
] as const

export const READER_OUTLINE_PROGRESS_CHANNEL = 'reader:outline:progress'

type ReaderOutlineChannel = (typeof READER_OUTLINE_CHANNELS)[number]
type ReaderOutlineHandler = (_event: unknown, payload?: unknown) => unknown | Promise<unknown>

export type ReaderOutlineIpcRegistrar = {
  handle: (channel: string, handler: ReaderOutlineHandler) => void
}

export type ReaderOutlineIpcDependencies = {
  getService: () => ReaderOutlineService
}

const requireObject = (payload: unknown) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Invalid outline analysis payload.')
  }
  return payload as Record<string, unknown>
}

const requireBookId = (value: unknown) => {
  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new Error('Invalid book ID.')
  }
  return Number(value)
}

const requireSource = (value: unknown): ReaderDocumentSource => {
  if (value === 'pdf' || value === 'ocr' || value === 'epub' || value === 'unknown') return value
  throw new Error('Invalid document source.')
}

const requireFilePath = (value: unknown) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid file path.')
  return value.trim()
}

const requirePageCount = (value: unknown) => {
  const normalized = Number(value)
  if (!Number.isInteger(normalized) || normalized < 0) throw new Error('Invalid page count.')
  return normalized
}

const serializeError = (error: unknown) => ({
  code: 'outline_analysis_failed',
  message: error instanceof Error ? error.message : String(error),
})

export function createReaderOutlineHandlers(
  dependencies: ReaderOutlineIpcDependencies,
): Record<ReaderOutlineChannel, ReaderOutlineHandler> {
  return {
    'reader:outline:analyze': async (event, payload) => {
      try {
        const data = requireObject(payload)
        const request: ReaderOutlineAnalysisRequest = {
          bookId: requireBookId(data.bookId),
          source: requireSource(data.source),
          filePath: requireFilePath(data.filePath),
          pageCount: requirePageCount(data.pageCount),
          parserVersion:
            typeof data.parserVersion === 'string' && data.parserVersion.trim()
              ? data.parserVersion.trim()
              : undefined,
        }
        const result = await dependencies.getService().analyze(request, (progress) => {
          ;(event as { sender?: { send: (channel: string, payload: ReaderOutlineAnalysisProgress) => void } })
            .sender?.send(READER_OUTLINE_PROGRESS_CHANNEL, progress)
        })
        return { success: true, data: result }
      } catch (error) {
        return { success: false, error: serializeError(error) }
      }
    },
    'reader:outline:cancel': async (_event, payload) => {
      try {
        const data = requireObject(payload)
        const bookId = requireBookId(data.bookId)
        dependencies.getService().cancel(bookId)
        return { success: true, data: { cancelled: true } }
      } catch (error) {
        return { success: false, error: serializeError(error) }
      }
    },
  }
}

export function registerReaderOutlineIpc(
  registrar: ReaderOutlineIpcRegistrar,
  dependencies: ReaderOutlineIpcDependencies,
) {
  const handlers = createReaderOutlineHandlers(dependencies)
  for (const channel of READER_OUTLINE_CHANNELS) registrar.handle(channel, handlers[channel])
}
