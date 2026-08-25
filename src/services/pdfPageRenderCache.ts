export type PdfPageRenderCacheConfig = Readonly<{
  sessionId: number
  renderWidth: number
  devicePixelRatio: number
  byteBudget: number
}>

export type PdfPageRenderCacheSnapshot = Readonly<{
  retainedPageIndexes: readonly number[]
  protectedPageIndexes: readonly number[]
  estimatedBytes: number
  byteBudget: number
  protectedOverflowBytes: number
}>

type CacheEntry = {
  estimatedBytes: number
  lastUsed: number
}

const normalizePositive = (value: number, fallback: number) =>
  Number.isFinite(value) && value > 0 ? value : fallback

export const estimatePdfCanvasBytes = ({
  renderWidth,
  aspectRatio,
  devicePixelRatio,
}: {
  renderWidth: number
  aspectRatio: number
  devicePixelRatio: number
}): number => {
  const width = Math.ceil(normalizePositive(renderWidth, 1) * normalizePositive(devicePixelRatio, 1))
  const height = Math.ceil(
    normalizePositive(renderWidth, 1) *
      normalizePositive(aspectRatio, 1) *
      normalizePositive(devicePixelRatio, 1),
  )
  return width * height * 4
}

export class PdfPageRenderCache {
  private config: PdfPageRenderCacheConfig
  private entries = new Map<number, CacheEntry>()
  private protectedPages = new Set<number>()
  private clock = 0

  constructor(config: PdfPageRenderCacheConfig) {
    this.config = this.normalizeConfig(config)
  }

  configure(config: PdfPageRenderCacheConfig): PdfPageRenderCacheSnapshot {
    const nextConfig = this.normalizeConfig(config)
    const isCompatible =
      nextConfig.sessionId === this.config.sessionId &&
      nextConfig.renderWidth === this.config.renderWidth &&
      nextConfig.devicePixelRatio === this.config.devicePixelRatio
    this.config = nextConfig
    if (!isCompatible) {
      this.entries.clear()
      this.protectedPages.clear()
      this.clock = 0
    }
    this.prune()
    return this.getSnapshot()
  }

  setProtectedPages(pageIndexes: Iterable<number>): PdfPageRenderCacheSnapshot {
    this.protectedPages = new Set(
      [...pageIndexes].filter((pageIndex) => Number.isInteger(pageIndex) && pageIndex >= 0),
    )
    this.prune()
    return this.getSnapshot()
  }

  recordRenderedPage(pageIndex: number, aspectRatio: number): PdfPageRenderCacheSnapshot {
    if (!Number.isInteger(pageIndex) || pageIndex < 0) return this.getSnapshot()
    this.entries.set(pageIndex, {
      estimatedBytes: estimatePdfCanvasBytes({
        renderWidth: this.config.renderWidth,
        aspectRatio,
        devicePixelRatio: this.config.devicePixelRatio,
      }),
      lastUsed: ++this.clock,
    })
    this.prune()
    return this.getSnapshot()
  }

  touchPages(pageIndexes: Iterable<number>): PdfPageRenderCacheSnapshot {
    for (const pageIndex of pageIndexes) {
      const entry = this.entries.get(pageIndex)
      if (entry) entry.lastUsed = ++this.clock
    }
    return this.getSnapshot()
  }

  getSnapshot(): PdfPageRenderCacheSnapshot {
    const retainedPageIndexes = [...this.entries.entries()]
      .sort((left, right) => right[1].lastUsed - left[1].lastUsed)
      .map(([pageIndex]) => pageIndex)
    const estimatedBytes = [...this.entries.values()].reduce(
      (total, entry) => total + entry.estimatedBytes,
      0,
    )
    return {
      retainedPageIndexes,
      protectedPageIndexes: [...this.protectedPages].sort((left, right) => left - right),
      estimatedBytes,
      byteBudget: this.config.byteBudget,
      protectedOverflowBytes: Math.max(0, estimatedBytes - this.config.byteBudget),
    }
  }

  private prune(): void {
    let estimatedBytes = [...this.entries.values()].reduce(
      (total, entry) => total + entry.estimatedBytes,
      0,
    )
    if (estimatedBytes <= this.config.byteBudget) return
    const candidates = [...this.entries.entries()]
      .filter(([pageIndex]) => !this.protectedPages.has(pageIndex))
      .sort((left, right) => left[1].lastUsed - right[1].lastUsed)
    for (const [pageIndex, entry] of candidates) {
      if (estimatedBytes <= this.config.byteBudget) break
      this.entries.delete(pageIndex)
      estimatedBytes -= entry.estimatedBytes
    }
  }

  private normalizeConfig(config: PdfPageRenderCacheConfig): PdfPageRenderCacheConfig {
    return {
      sessionId: Number.isFinite(config.sessionId) ? config.sessionId : 0,
      renderWidth: normalizePositive(config.renderWidth, 1),
      devicePixelRatio: normalizePositive(config.devicePixelRatio, 1),
      byteBudget: Math.max(0, Math.floor(Number.isFinite(config.byteBudget) ? config.byteBudget : 0)),
    }
  }
}
