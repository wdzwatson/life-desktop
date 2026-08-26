export type PdfRenderSchedule = Readonly<{
  targetPageIndex: number
  admittedPageIndexes: readonly number[]
  inFlightPageIndexes: readonly number[]
  completedPageIndexes: readonly number[]
  pendingPageIndexes: readonly number[]
}>

export type PdfRenderWindowRequest = {
  pageCount: number
  targetPageIndex: number
  visiblePageIndexes?: readonly number[]
  overscanBefore?: number
  overscanAfter?: number
  overscan: number
  direction?: -1 | 0 | 1
}

export const buildPdfRenderPriority = ({
  pageCount,
  targetPageIndex,
  visiblePageIndexes = [],
  overscanBefore,
  overscanAfter,
  overscan,
  direction = 1,
}: PdfRenderWindowRequest): number[] => {
  if (pageCount <= 0) return []
  const target = Math.max(0, Math.min(pageCount - 1, Math.floor(targetPageIndex)))
  const beforeRadius = Math.max(0, Math.floor(overscanBefore ?? overscan))
  const afterRadius = Math.max(0, Math.floor(overscanAfter ?? overscan))
  const priority = [target]
  const seen = new Set(priority)
  for (const pageIndex of visiblePageIndexes) {
    const visiblePageIndex = Math.floor(pageIndex)
    if (visiblePageIndex < 0 || visiblePageIndex >= pageCount || seen.has(visiblePageIndex)) continue
    priority.push(visiblePageIndex)
    seen.add(visiblePageIndex)
  }
  const preferPrevious = direction < 0

  const appendRange = (radius: number, step: -1 | 1) => {
    for (let distance = 1; distance <= radius; distance += 1) {
      const pageIndex = target + distance * step
      if (pageIndex < 0 || pageIndex >= pageCount || seen.has(pageIndex)) continue
      priority.push(pageIndex)
      seen.add(pageIndex)
    }
  }
  if (beforeRadius === afterRadius) {
    for (let distance = 1; distance <= beforeRadius; distance += 1) {
      const previous = target - distance
      const next = target + distance
      if (preferPrevious) {
        if (previous >= 0 && !seen.has(previous)) priority.push(previous)
        if (next < pageCount && !seen.has(next)) priority.push(next)
      } else {
        if (next < pageCount && !seen.has(next)) priority.push(next)
        if (previous >= 0 && !seen.has(previous)) priority.push(previous)
      }
    }
  } else if (preferPrevious) {
    appendRange(beforeRadius, -1)
    appendRange(afterRadius, 1)
  } else {
    appendRange(afterRadius, 1)
    appendRange(beforeRadius, -1)
  }
  return priority
}

export class PdfPageRenderScheduler {
  private readonly maxConcurrent: number
  private targetPageIndex = 0
  private priority: number[] = []
  private admitted = new Set<number>()
  private inFlight = new Set<number>()
  private completed = new Set<number>()
  private failed = new Set<number>()
  private retained = new Set<number>()
  private lastSnapshot: PdfRenderSchedule | null = null
  private lastSnapshotKey = ''

  constructor(maxConcurrent = 2) {
    this.maxConcurrent = Math.max(1, Math.floor(maxConcurrent))
  }

  moveWindow(request: PdfRenderWindowRequest): PdfRenderSchedule {
    const priority = buildPdfRenderPriority(request)
    if (priority.length === 0) {
      this.priority = []
      this.admitted.clear()
      this.inFlight.clear()
      this.completed.clear()
      this.failed.clear()
      this.retained.clear()
      return this.getSnapshot()
    }

    const previousPriority = new Set(this.priority)
    this.targetPageIndex = priority[0]
    this.priority = priority
    this.failed.clear()
    const desired = new Set([...priority, ...this.retained])
    for (const pageIndex of this.admitted) {
      if (desired.has(pageIndex)) continue
      this.admitted.delete(pageIndex)
      this.inFlight.delete(pageIndex)
      this.completed.delete(pageIndex)
    }

    const criticalPages = new Set([
      this.targetPageIndex,
      ...(request.visiblePageIndexes ?? []).filter(
        (pageIndex) => Number.isInteger(pageIndex) && pageIndex >= 0 && pageIndex < request.pageCount,
      ),
    ])
    for (const pageIndex of this.completed) {
      if (this.admitted.has(pageIndex)) continue
      if (!desired.has(pageIndex)) {
        this.completed.delete(pageIndex)
        continue
      }
      if (criticalPages.has(pageIndex) || !previousPriority.has(pageIndex)) {
        this.completed.delete(pageIndex)
      }
    }

    if (!this.admitted.has(this.targetPageIndex)) {
      this.admitted.add(this.targetPageIndex)
      this.inFlight.add(this.targetPageIndex)
    }
    this.enforceConcurrencyLimit()

    // A newly requested target starts alone. Its page-load callback opens the
    // second slot, proving that the target reached PDF.js before any neighbor.
    if (this.completed.has(this.targetPageIndex)) this.fillAvailableSlots()
    return this.getSnapshot()
  }

  markPageLoaded(pageIndex: number): PdfRenderSchedule {
    if (pageIndex === this.targetPageIndex && this.inFlight.has(pageIndex)) {
      this.fillAvailableSlots()
    }
    return this.getSnapshot()
  }

  markPageFinished(pageIndex: number, succeeded = true): PdfRenderSchedule {
    if (!this.admitted.has(pageIndex)) return this.getSnapshot()
    this.inFlight.delete(pageIndex)
    if (succeeded) this.completed.add(pageIndex)
    else {
      this.admitted.delete(pageIndex)
      this.completed.delete(pageIndex)
      this.failed.add(pageIndex)
    }
    this.fillAvailableSlots()
    return this.getSnapshot()
  }

  setRetainedPageIndexes(pageIndexes: Iterable<number>): PdfRenderSchedule {
    this.retained = new Set(pageIndexes)
    for (const pageIndex of this.completed) {
      if (this.retained.has(pageIndex)) continue
      this.admitted.delete(pageIndex)
      if (!this.priority.includes(pageIndex)) this.completed.delete(pageIndex)
    }
    return this.getSnapshot()
  }

  getSnapshot(): PdfRenderSchedule {
    const pending = this.priority.filter(
      (pageIndex) =>
        !this.admitted.has(pageIndex) &&
        !this.completed.has(pageIndex) &&
        !this.failed.has(pageIndex),
    )
    const snapshot: PdfRenderSchedule = {
      targetPageIndex: this.targetPageIndex,
      admittedPageIndexes: [...this.admitted],
      inFlightPageIndexes: [...this.inFlight],
      completedPageIndexes: [...this.completed],
      pendingPageIndexes: pending,
    }
    const snapshotKey = [
      snapshot.targetPageIndex,
      snapshot.admittedPageIndexes.join(','),
      snapshot.inFlightPageIndexes.join(','),
      snapshot.completedPageIndexes.join(','),
      snapshot.pendingPageIndexes.join(','),
    ].join('|')
    if (this.lastSnapshot && snapshotKey === this.lastSnapshotKey) return this.lastSnapshot
    this.lastSnapshot = snapshot
    this.lastSnapshotKey = snapshotKey
    return snapshot
  }

  private fillAvailableSlots(): void {
    for (const pageIndex of this.priority) {
      if (this.inFlight.size >= this.maxConcurrent) return
      if (
        this.admitted.has(pageIndex) ||
        this.completed.has(pageIndex) ||
        this.failed.has(pageIndex)
      ) {
        continue
      }
      this.admitted.add(pageIndex)
      this.inFlight.add(pageIndex)
    }
  }

  private enforceConcurrencyLimit(): void {
    if (this.inFlight.size <= this.maxConcurrent) return
    const rank = new Map(this.priority.map((pageIndex, index) => [pageIndex, index]))
    const removable = [...this.inFlight]
      .filter((pageIndex) => pageIndex !== this.targetPageIndex)
      .sort((left, right) => (rank.get(right) ?? Infinity) - (rank.get(left) ?? Infinity))
    while (this.inFlight.size > this.maxConcurrent && removable.length > 0) {
      const pageIndex = removable.shift()!
      this.inFlight.delete(pageIndex)
      this.admitted.delete(pageIndex)
    }
  }
}
