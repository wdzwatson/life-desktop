import assert from 'node:assert/strict'
import test from 'node:test'
import { resizeScreenshotCrop } from '../src/utils/screenshotEditorCrop'

const bounds = { width: 1000, height: 600 }
const full = { x: 0, y: 0, width: 1000, height: 600 }

test('crop handles resize inward from the existing screenshot border', () => {
  assert.deepEqual(resizeScreenshotCrop(full, 'north-west', { x: 120, y: 80 }, bounds), {
    x: 120,
    y: 80,
    width: 880,
    height: 520,
  })
  assert.deepEqual(resizeScreenshotCrop(full, 'south-east', { x: -150, y: -60 }, bounds), {
    x: 0,
    y: 0,
    width: 850,
    height: 540,
  })
})

test('crop resize and movement stay inside the canvas', () => {
  const selection = { x: 100, y: 80, width: 500, height: 300 }
  assert.deepEqual(resizeScreenshotCrop(selection, 'move', { x: 900, y: 700 }, bounds), {
    x: 500,
    y: 300,
    width: 500,
    height: 300,
  })
  assert.deepEqual(resizeScreenshotCrop(selection, 'west', { x: 900, y: 0 }, bounds, 32), {
    x: 568,
    y: 80,
    width: 32,
    height: 300,
  })
})
