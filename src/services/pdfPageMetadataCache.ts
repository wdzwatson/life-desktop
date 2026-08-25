export type PdfPageTextMode = 'unknown' | 'text' | 'scanned'

export type PdfPageMetadata = Readonly<{
  aspectRatio?: number
  textMode: PdfPageTextMode
}>

type MetadataListener = () => void

const EMPTY_PDF_PAGE_METADATA: PdfPageMetadata = Object.freeze({ textMode: 'unknown' })

export class PdfPageMetadataCache {
  private sessionId = 0
  private readonly pages = new Map<number, PdfPageMetadata>()
  private readonly listeners = new Map<number, Set<MetadataListener>>()

  beginSession(): number {
    this.sessionId += 1
    this.pages.clear()
    for (const pageListeners of this.listeners.values()) {
      for (const listener of pageListeners) listener()
    }
    return this.sessionId
  }

  getSessionId(): number {
    return this.sessionId
  }

  getSnapshot(pageNumber: number): PdfPageMetadata {
    return this.pages.get(pageNumber) ?? EMPTY_PDF_PAGE_METADATA
  }

  setAspectRatio(sessionId: number, pageNumber: number, aspectRatio: number): boolean {
    if (
      sessionId !== this.sessionId ||
      !Number.isInteger(pageNumber) ||
      pageNumber < 1 ||
      !Number.isFinite(aspectRatio) ||
      aspectRatio <= 0
    ) {
      return false
    }
    const current = this.getSnapshot(pageNumber)
    if (
      current.aspectRatio !== undefined &&
      Math.abs(current.aspectRatio - aspectRatio) < 0.001
    ) {
      return false
    }
    this.pages.set(pageNumber, { ...current, aspectRatio })
    this.notify(pageNumber)
    return true
  }

  setTextMode(sessionId: number, pageNumber: number, textMode: PdfPageTextMode): boolean {
    if (
      sessionId !== this.sessionId ||
      !Number.isInteger(pageNumber) ||
      pageNumber < 1 ||
      !['unknown', 'text', 'scanned'].includes(textMode)
    ) {
      return false
    }
    const current = this.getSnapshot(pageNumber)
    if (current.textMode === textMode) return false
    this.pages.set(pageNumber, { ...current, textMode })
    this.notify(pageNumber)
    return true
  }

  subscribe(pageNumber: number, listener: MetadataListener): () => void {
    const pageListeners = this.listeners.get(pageNumber) ?? new Set<MetadataListener>()
    pageListeners.add(listener)
    this.listeners.set(pageNumber, pageListeners)
    return () => {
      pageListeners.delete(listener)
      if (pageListeners.size === 0) this.listeners.delete(pageNumber)
    }
  }

  private notify(pageNumber: number): void {
    for (const listener of this.listeners.get(pageNumber) ?? []) listener()
  }
}

