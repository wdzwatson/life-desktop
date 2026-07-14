import assert from 'node:assert/strict'
import test from 'node:test'
import { getTrappedFocusIndex } from '../src/components/AccessibleDialog.tsx'

test('getTrappedFocusIndex cycles focus in both directions', () => {
  assert.equal(getTrappedFocusIndex(0, 3, false), 1)
  assert.equal(getTrappedFocusIndex(2, 3, false), 0)
  assert.equal(getTrappedFocusIndex(2, 3, true), 1)
  assert.equal(getTrappedFocusIndex(0, 3, true), 2)
  assert.equal(getTrappedFocusIndex(-1, 3, false), 0)
  assert.equal(getTrappedFocusIndex(-1, 3, true), 2)
  assert.equal(getTrappedFocusIndex(0, 0, false), -1)
})
