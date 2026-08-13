export type ScreenCaptureRect = {
  x: number
  y: number
  width: number
  height: number
}

type Size = { width: number; height: number }

const finiteNumber = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

export function normalizeScreenCaptureSelection(
  input: unknown,
  bounds: Size,
  minimumSize = 8,
): ScreenCaptureRect | null {
  if (!input || typeof input !== 'object') return null
  const candidate = input as Partial<ScreenCaptureRect>
  const x = finiteNumber(candidate.x)
  const y = finiteNumber(candidate.y)
  const width = finiteNumber(candidate.width)
  const height = finiteNumber(candidate.height)
  if (x === null || y === null || width === null || height === null) return null

  const left = Math.max(0, Math.min(bounds.width, x))
  const top = Math.max(0, Math.min(bounds.height, y))
  const right = Math.max(left, Math.min(bounds.width, x + width))
  const bottom = Math.max(top, Math.min(bounds.height, y + height))
  if (right - left < minimumSize || bottom - top < minimumSize) return null

  return { x: left, y: top, width: right - left, height: bottom - top }
}

export function scaleScreenCaptureSelection(
  selection: ScreenCaptureRect,
  from: Size,
  to: Size,
): ScreenCaptureRect {
  const scaleX = to.width / from.width
  const scaleY = to.height / from.height
  const x = Math.max(0, Math.min(to.width - 1, Math.round(selection.x * scaleX)))
  const y = Math.max(0, Math.min(to.height - 1, Math.round(selection.y * scaleY)))
  const right = Math.max(
    x + 1,
    Math.min(to.width, Math.round((selection.x + selection.width) * scaleX)),
  )
  const bottom = Math.max(
    y + 1,
    Math.min(to.height, Math.round((selection.y + selection.height) * scaleY)),
  )
  return { x, y, width: right - x, height: bottom - y }
}
