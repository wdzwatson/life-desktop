export type PdfReaderPerformanceEventName =
  | 'outline-select'
  | 'scroll-committed'
  | 'page-loaded'
  | 'canvas-rendered'
  | 'text-resolved'
  | 'superseded'

export type PdfReaderPerformanceEvent = Readonly<{
  jumpId: number
  event: PdfReaderPerformanceEventName
  pageNumber: number
  timestamp: number
  elapsedMs: number
}>

type ActivePdfJump = {
  id: number
  pageNumber: number
  startedAt: number
  recordedEvents: Set<PdfReaderPerformanceEventName>
}

type PdfReaderPerformanceTraceOptions = {
  capacity?: number
  now?: () => number
}

const DEFAULT_TRACE_CAPACITY = 120

export class PdfReaderPerformanceTrace {
  private readonly capacity: number
  private readonly now: () => number
  private events: PdfReaderPerformanceEvent[] = []
  private activeJump: ActivePdfJump | null = null
  private nextJumpId = 1

  constructor(options: PdfReaderPerformanceTraceOptions = {}) {
    this.capacity = Math.max(1, Math.floor(options.capacity ?? DEFAULT_TRACE_CAPACITY))
    this.now = options.now ?? (() => performance.now())
  }

  resetSession(): void {
    this.events = []
    this.activeJump = null
    this.nextJumpId = 1
  }

  beginOutlineJump(pageNumber: number): number {
    const normalizedPageNumber = Math.max(1, Math.floor(pageNumber))
    if (
      this.activeJump &&
      !this.activeJump.recordedEvents.has('canvas-rendered') &&
      !this.activeJump.recordedEvents.has('superseded')
    ) {
      this.record(this.activeJump, 'superseded')
    }

    const startedAt = this.now()
    const jump: ActivePdfJump = {
      id: this.nextJumpId,
      pageNumber: normalizedPageNumber,
      startedAt,
      recordedEvents: new Set(),
    }
    this.nextJumpId += 1
    this.activeJump = jump
    this.record(jump, 'outline-select', startedAt)
    return jump.id
  }

  markJump(
    jumpId: number,
    event: Exclude<PdfReaderPerformanceEventName, 'outline-select' | 'superseded'>,
    pageNumber: number,
  ): boolean {
    const jump = this.activeJump
    if (!jump || jump.id !== jumpId || jump.pageNumber !== pageNumber) return false
    return this.record(jump, event)
  }

  markTargetPage(
    event: 'page-loaded' | 'canvas-rendered' | 'text-resolved',
    pageNumber: number,
  ): boolean {
    const jump = this.activeJump
    if (!jump || jump.pageNumber !== pageNumber) return false
    return this.record(jump, event)
  }

  getSnapshot(): readonly PdfReaderPerformanceEvent[] {
    return this.events.map((event) => ({ ...event }))
  }

  private record(
    jump: ActivePdfJump,
    event: PdfReaderPerformanceEventName,
    timestamp = this.now(),
  ): boolean {
    if (jump.recordedEvents.has(event)) return false
    jump.recordedEvents.add(event)
    this.events.push({
      jumpId: jump.id,
      event,
      pageNumber: jump.pageNumber,
      timestamp,
      elapsedMs: Math.max(0, timestamp - jump.startedAt),
    })
    if (this.events.length > this.capacity) {
      this.events.splice(0, this.events.length - this.capacity)
    }
    return true
  }
}

export const pdfReaderPerformanceTrace = new PdfReaderPerformanceTrace()

