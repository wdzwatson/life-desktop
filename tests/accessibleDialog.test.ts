import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getTrappedFocusIndex,
  shouldRestoreDialogFocus,
} from '../src/components/AccessibleDialog.tsx'

test('shouldRestoreDialogFocus waits until the mounted dialog is detached', () => {
  assert.equal(shouldRestoreDialogFocus({ isConnected: true }), false)
  assert.equal(shouldRestoreDialogFocus({ isConnected: false }), true)
  assert.equal(shouldRestoreDialogFocus(null), true)
})

test('getTrappedFocusIndex cycles focus in both directions', () => {
  assert.equal(getTrappedFocusIndex(0, 3, false), 1)
  assert.equal(getTrappedFocusIndex(2, 3, false), 0)
  assert.equal(getTrappedFocusIndex(2, 3, true), 1)
  assert.equal(getTrappedFocusIndex(0, 3, true), 2)
  assert.equal(getTrappedFocusIndex(-1, 3, false), 0)
  assert.equal(getTrappedFocusIndex(-1, 3, true), 2)
  assert.equal(getTrappedFocusIndex(0, 0, false), -1)
})
