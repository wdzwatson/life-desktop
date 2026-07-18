export type AISseEvent = {
  event?: string
  data: string
  id?: string
  retry?: number
}

const MAX_EVENT_BYTES = 2 * 1024 * 1024

function abortError(signal?: AbortSignal) {
  if (signal?.reason instanceof Error) return signal.reason
  return new DOMException('The operation was aborted.', 'AbortError')
}

function findEventBoundary(value: string) {
  const lf = value.indexOf('\n\n')
  const crlf = value.indexOf('\r\n\r\n')
  if (lf < 0) return crlf < 0 ? null : { index: crlf, length: 4 }
  if (crlf < 0 || lf < crlf) return { index: lf, length: 2 }
  return { index: crlf, length: 4 }
}

function parseEventBlock(block: string): AISseEvent | null {
  let event: string | undefined
  let id: string | undefined
  let retry: number | undefined
  const data: string[] = []
  for (const rawLine of block.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (!rawLine || rawLine.startsWith(':')) continue
    const separator = rawLine.indexOf(':')
    const field = separator < 0 ? rawLine : rawLine.slice(0, separator)
    const value = separator < 0 ? '' : rawLine.slice(separator + 1).replace(/^ /, '')
    if (field === 'data') data.push(value)
    else if (field === 'event') event = value
    else if (field === 'id' && !value.includes('\0')) id = value
    else if (field === 'retry' && /^\d+$/.test(value)) retry = Number(value)
  }
  if (data.length === 0) return null
  return {
    data: data.join('\n'),
    ...(event ? { event } : {}),
    ...(id ? { id } : {}),
    ...(retry === undefined ? {} : { retry }),
  }
}

export async function* parseAISseStream(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<AISseEvent> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const onAbort = () => void reader.cancel(signal?.reason).catch(() => undefined)
  signal?.addEventListener('abort', onAbort, { once: true })
  try {
    while (true) {
      if (signal?.aborted) throw abortError(signal)
      const { value, done } = await reader.read()
      if (signal?.aborted) throw abortError(signal)
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      if (buffer.length > MAX_EVENT_BYTES) throw new Error('SSE event exceeded the size limit.')
      while (true) {
        const boundary = findEventBoundary(buffer)
        if (!boundary) break
        const block = buffer.slice(0, boundary.index)
        buffer = buffer.slice(boundary.index + boundary.length)
        const event = parseEventBlock(block)
        if (event) yield event
      }
    }
    buffer += decoder.decode()
    if (buffer.trim()) {
      const event = parseEventBlock(buffer)
      if (event) yield event
    }
  } finally {
    signal?.removeEventListener('abort', onAbort)
    reader.releaseLock()
  }
}
