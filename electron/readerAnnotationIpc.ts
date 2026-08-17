import type { ReaderAnnotationService } from './readerAnnotationService'

export const READER_ANNOTATION_CHANNELS = [
  'reader:annotation:list',
  'reader:annotation:save',
  'reader:annotation:delete',
] as const

type ReaderAnnotationChannel = (typeof READER_ANNOTATION_CHANNELS)[number]
type ReaderAnnotationHandler = (_event: unknown, payload?: unknown) => unknown | Promise<unknown>

export type ReaderAnnotationIpcRegistrar = {
  handle: (channel: string, handler: ReaderAnnotationHandler) => void
}

export type ReaderAnnotationIpcDependencies = {
  getService: () => ReaderAnnotationService
}

const requireObject = (payload: unknown) => {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Invalid annotation payload.')
  }
  return payload as Record<string, unknown>
}

const requireBookId = (value: unknown) => {
  if (!Number.isInteger(value) || Number(value) < 1) {
    throw new Error('Invalid book ID.')
  }
  return Number(value)
}

const requireItemId = (value: unknown) => {
  const text = String(value ?? '').trim()
  if (!text) throw new Error('Invalid annotation item ID.')
  return text
}

const requireKind = (value: unknown) => {
  const kind = String(value ?? '').trim()
  if (kind === 'translation' || kind === 'underline' || kind === 'note') {
    return kind
  }
  throw new Error('Invalid annotation kind.')
}

const requireText = (value: unknown) => {
  const text = String(value ?? '').trim()
  if (!text) throw new Error('Annotation text is required.')
  return text
}

const optionalLocationStatus = (value: unknown) => {
  if (value === undefined) return undefined
  const status = String(value).trim()
  if (
    status === 'pending' ||
    status === 'resolved' ||
    status === 'page-only' ||
    status === 'error'
  ) {
    return status
  }
  throw new Error('Invalid annotation location status.')
}

export function createReaderAnnotationHandlers(
  dependencies: ReaderAnnotationIpcDependencies,
): Record<ReaderAnnotationChannel, ReaderAnnotationHandler> {
  return {
    'reader:annotation:list': async (_event, payload) => {
      const data = requireObject(payload)
      const bookId = requireBookId(data.bookId)
      const annotations = dependencies.getService().listBookAnnotations(bookId)
      return { success: true, data: annotations }
    },
    'reader:annotation:save': async (_event, payload) => {
      const data = requireObject(payload)
      const result = dependencies.getService().saveBookAnnotation({
        bookId: requireBookId(data.bookId),
        kind: requireKind(data.kind),
        text: requireText(data.text),
        anchor: data.anchor,
        selectionId: data.selectionId,
        itemId: data.itemId,
        body: data.body === undefined ? undefined : String(data.body),
        translationLanguage:
          data.translationLanguage === undefined ? undefined : String(data.translationLanguage),
        locationStatus: optionalLocationStatus(data.locationStatus),
      })
      return { success: true, data: result }
    },
    'reader:annotation:delete': async (_event, payload) => {
      const data = requireObject(payload)
      const result = dependencies.getService().deleteBookAnnotation({
        bookId: requireBookId(data.bookId),
        itemId: requireItemId(data.itemId),
      })
      return { success: true, data: result }
    },
  }
}

export function registerReaderAnnotationIpc(
  registrar: ReaderAnnotationIpcRegistrar,
  dependencies: ReaderAnnotationIpcDependencies,
) {
  const handlers = createReaderAnnotationHandlers(dependencies)
  for (const channel of READER_ANNOTATION_CHANNELS) registrar.handle(channel, handlers[channel])
}
