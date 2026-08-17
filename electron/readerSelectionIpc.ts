import type { ReaderDocumentSource } from '../src/types/readerAnnotation'
import type { ReaderSelectionService } from './readerSelectionService'

export const READER_SELECTION_CHANNELS = ['reader:selection:reconcile'] as const

type ReaderSelectionChannel = (typeof READER_SELECTION_CHANNELS)[number]
type ReaderSelectionHandler = (_event: unknown, payload?: unknown) => unknown | Promise<unknown>

export type ReaderSelectionIpcRegistrar = {
  handle: (channel: string, handler: ReaderSelectionHandler) => void
}

export type ReaderSelectionIpcDependencies = {
  getService: () => ReaderSelectionService
}

const requireObject = (payload: unknown) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Invalid selection payload.')
  }
  return payload as Record<string, unknown>
}

const requireBookId = (value: unknown) => {
  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new Error('Invalid book ID.')
  }
  return Number(value)
}

const requireSource = (value: unknown) => {
  if (value === undefined || value === null) return undefined
  if (value === 'pdf' || value === 'ocr' || value === 'epub' || value === 'unknown') {
    return value as ReaderDocumentSource
  }
  throw new Error('Invalid document source.')
}

export function createReaderSelectionHandlers(
  dependencies: ReaderSelectionIpcDependencies,
): Record<ReaderSelectionChannel, ReaderSelectionHandler> {
  return {
    'reader:selection:reconcile': async (_event, payload) => {
      const data = requireObject(payload)
      const bookId = requireBookId(data.bookId)
      const source = requireSource(data.source)
      const result = dependencies.getService().reconcileBookSelections(bookId, source)
      return { success: true, data: result }
    },
  }
}

export function registerReaderSelectionIpc(
  registrar: ReaderSelectionIpcRegistrar,
  dependencies: ReaderSelectionIpcDependencies,
) {
  const handlers = createReaderSelectionHandlers(dependencies)
  for (const channel of READER_SELECTION_CHANNELS) registrar.handle(channel, handlers[channel])
}
