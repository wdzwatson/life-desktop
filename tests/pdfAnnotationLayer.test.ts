import assert from 'node:assert/strict'
import test from 'node:test'
import { getPdfAnnotationRects } from '../src/components/PdfAnnotationLayer.tsx'

test('PDF annotation rectangles support underline and note while excluding translations', () => {
  const rects = getPdfAnnotationRects([
    {
      id: 'underline',
      text: 'Source',
      kind: 'highlight',
      areas: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.04 }],
    },
    {
      id: 'note',
      text: 'Source',
      annotation: 'Note',
      highlighted: false,
      kind: 'note',
      areas: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.04 }],
    },
    {
      id: 'translation',
      text: 'Source',
      annotation: '译文',
      kind: 'translation',
      areas: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.04 }],
    },
  ])

  assert.deepEqual(
    rects.map((rect) => [rect.highlight.id, rect.visualState]),
    [
      ['underline', 'is-highlight-only'],
      ['note', 'is-annotation-only'],
    ],
  )
})

test('PDF annotation rectangles clamp valid areas and discard broken anchors', () => {
  const rects = getPdfAnnotationRects([
    {
      id: 'clamped',
      text: 'Source',
      kind: 'highlight',
      areas: [
        { x: -0.1, y: 0.95, width: 0.4, height: 0.2 },
        { x: Number.NaN, y: 0, width: 1, height: 1 },
        { x: 1.2, y: 0, width: 0.2, height: 0.1 },
        { x: 0.2, y: 0.2, width: 0, height: 0.1 },
      ],
    },
  ])

  assert.equal(rects.length, 1)
  assert.equal(rects[0]?.area.x, 0)
  assert.equal(rects[0]?.area.y, 0.95)
  assert.equal(rects[0]?.area.width, 0.4)
  assert.ok(Math.abs((rects[0]?.area.height || 0) - 0.05) < Number.EPSILON)
})
