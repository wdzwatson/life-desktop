import assert from 'node:assert/strict'
import test from 'node:test'
import { decidePdfReaderVirtualization } from '../scripts/pdf-reader-virtualization-decision.mjs'

test('PDF virtualization stays off when list structure is a minor frame and heavy-stage cost', () => {
  const decision = decidePdfReaderVirtualization({
    pageCount: 320,
    outlineJumpStructureP95Ms: 0.5,
    resizeLayoutP95Ms: 8,
    minimumHeavyPageStageMs: 10,
    scrollFrameBudgetMs: 16,
  })

  assert.equal(decision.implementVirtualization, false)
  assert.deepEqual(decision.reasons, [])
})

test('PDF virtualization is recommended when jump structure or resize layout is significant', () => {
  const jumpDecision = decidePdfReaderVirtualization({
    pageCount: 320,
    outlineJumpStructureP95Ms: 4,
    resizeLayoutP95Ms: 8,
    minimumHeavyPageStageMs: 100,
    scrollFrameBudgetMs: 16,
  })
  assert.equal(jumpDecision.implementVirtualization, true)
  assert.ok(jumpDecision.reasons.includes('outline-jump-exceeds-quarter-frame'))

  const resizeDecision = decidePdfReaderVirtualization({
    pageCount: 320,
    outlineJumpStructureP95Ms: 0.2,
    resizeLayoutP95Ms: 16,
    minimumHeavyPageStageMs: 100,
    scrollFrameBudgetMs: 16,
  })
  assert.equal(resizeDecision.implementVirtualization, true)
  assert.ok(resizeDecision.reasons.includes('resize-layout-exceeds-frame'))
})
