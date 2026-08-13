import assert from 'node:assert/strict'
import test from 'node:test'
import {
  defaultScreenshotTextStyle,
  getScreenshotTextAabb,
  screenshotTextContainsPoint,
  type ScreenshotTextLayer,
} from '../src/utils/screenshotEditorText'

const layer = (overrides: Partial<ScreenshotTextLayer> = {}): ScreenshotTextLayer => ({
  ...defaultScreenshotTextStyle,
  id: 'text-1',
  text: 'Editable text',
  x: 100,
  y: 100,
  ...overrides,
})

test('text layer hit testing follows rotation', () => {
  const rotated = layer({ rotation: 90 })
  assert.equal(
    screenshotTextContainsPoint(rotated, { width: 60, height: 20 }, { x: 95, y: 130 }),
    true,
  )
  assert.equal(
    screenshotTextContainsPoint(rotated, { width: 60, height: 20 }, { x: 140, y: 130 }),
    false,
  )
})

test('text layer hit testing follows horizontal skew', () => {
  const skewed = layer({ skewX: 30 })
  const worldPoint = { x: 110 + Math.tan(Math.PI / 6) * 10, y: 110 }
  assert.equal(screenshotTextContainsPoint(skewed, { width: 60, height: 20 }, worldPoint), true)
  assert.equal(
    screenshotTextContainsPoint(skewed, { width: 60, height: 20 }, { x: 180, y: 110 }),
    false,
  )
})

test('text layer bounds include rotation and skew', () => {
  const transformed = layer({ rotation: 90, skewX: 30 })
  const bounds = getScreenshotTextAabb(transformed, { width: 60, height: 20 })
  assert.ok(bounds.x < 100)
  assert.ok(bounds.y >= 100)
  assert.ok(bounds.width >= 20)
  assert.ok(bounds.height > 60)
})
