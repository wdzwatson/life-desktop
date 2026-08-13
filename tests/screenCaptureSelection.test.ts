import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizeScreenCaptureSelection,
  scaleScreenCaptureSelection,
} from '../src/utils/screenCaptureSelection'

test('screen capture selection rejects invalid and accidental drags', () => {
  const bounds = { width: 1440, height: 900 }
  assert.equal(normalizeScreenCaptureSelection(null, bounds), null)
  assert.equal(
    normalizeScreenCaptureSelection({ x: 20, y: 30, width: 7, height: 20 }, bounds),
    null,
  )
  assert.equal(
    normalizeScreenCaptureSelection({ x: 20, y: 30, width: Number.NaN, height: 20 }, bounds),
    null,
  )
})

test('screen capture selection clamps to the active display', () => {
  assert.deepEqual(
    normalizeScreenCaptureSelection(
      { x: -12, y: 40, width: 120, height: 1000 },
      { width: 800, height: 600 },
    ),
    { x: 0, y: 40, width: 108, height: 560 },
  )
})

test('screen capture selection scales from display points to image pixels', () => {
  assert.deepEqual(
    scaleScreenCaptureSelection(
      { x: 100, y: 50, width: 300, height: 200 },
      { width: 1440, height: 900 },
      { width: 2880, height: 1800 },
    ),
    { x: 200, y: 100, width: 600, height: 400 },
  )
})
