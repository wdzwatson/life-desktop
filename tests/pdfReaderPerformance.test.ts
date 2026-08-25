import assert from 'node:assert/strict'
import test from 'node:test'
import { PdfReaderPerformanceTrace } from '../src/services/pdfReaderPerformance.ts'

test('PDF reader trace records one ordered timeline for the active outline jump', () => {
  let now = 100
  const trace = new PdfReaderPerformanceTrace({ now: () => now })
  const jumpId = trace.beginOutlineJump(42)

  now = 104
  assert.equal(trace.markJump(jumpId, 'scroll-committed', 42), true)
  now = 112
  assert.equal(trace.markTargetPage('page-loaded', 42), true)
  now = 135
  assert.equal(trace.markTargetPage('canvas-rendered', 42), true)
  now = 140
  assert.equal(trace.markTargetPage('text-resolved', 42), true)

  assert.deepEqual(
    trace.getSnapshot().map(({ event, elapsedMs }) => ({ event, elapsedMs })),
    [
      { event: 'outline-select', elapsedMs: 0 },
      { event: 'scroll-committed', elapsedMs: 4 },
      { event: 'page-loaded', elapsedMs: 12 },
      { event: 'canvas-rendered', elapsedMs: 35 },
      { event: 'text-resolved', elapsedMs: 40 },
    ],
  )
})

test('PDF reader trace rejects stale callbacks and supersedes unfinished jumps', () => {
  let now = 0
  const trace = new PdfReaderPerformanceTrace({ now: () => now })
  const firstJumpId = trace.beginOutlineJump(10)
  now = 5
  const secondJumpId = trace.beginOutlineJump(80)

  now = 9
  assert.equal(trace.markJump(firstJumpId, 'scroll-committed', 10), false)
  assert.equal(trace.markTargetPage('canvas-rendered', 10), false)
  assert.equal(trace.markJump(secondJumpId, 'scroll-committed', 80), true)
  assert.equal(trace.markTargetPage('page-loaded', 81), false)

  assert.deepEqual(
    trace.getSnapshot().map(({ jumpId, event, pageNumber }) => ({ jumpId, event, pageNumber })),
    [
      { jumpId: firstJumpId, event: 'outline-select', pageNumber: 10 },
      { jumpId: firstJumpId, event: 'superseded', pageNumber: 10 },
      { jumpId: secondJumpId, event: 'outline-select', pageNumber: 80 },
      { jumpId: secondJumpId, event: 'scroll-committed', pageNumber: 80 },
    ],
  )
})

test('PDF reader trace is bounded, deduplicated, and reset between book sessions', () => {
  let now = 0
  const trace = new PdfReaderPerformanceTrace({ capacity: 3, now: () => now })
  trace.beginOutlineJump(3)
  now = 1
  assert.equal(trace.markTargetPage('page-loaded', 3), true)
  assert.equal(trace.markTargetPage('page-loaded', 3), false)
  now = 2
  trace.markTargetPage('canvas-rendered', 3)
  now = 3
  trace.markTargetPage('text-resolved', 3)

  assert.equal(trace.getSnapshot().length, 3)
  assert.deepEqual(
    Object.keys(trace.getSnapshot()[0]).sort(),
    ['elapsedMs', 'event', 'jumpId', 'pageNumber', 'timestamp'],
  )

  trace.resetSession()
  assert.deepEqual(trace.getSnapshot(), [])
  assert.equal(trace.beginOutlineJump(7), 1)
})

