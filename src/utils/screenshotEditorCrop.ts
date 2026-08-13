export type ScreenshotCropPoint = { x: number; y: number }
export type ScreenshotCropRect = ScreenshotCropPoint & { width: number; height: number }
export type ScreenshotCropHandle =
  | 'move'
  | 'north'
  | 'north-east'
  | 'east'
  | 'south-east'
  | 'south'
  | 'south-west'
  | 'west'
  | 'north-west'

const includesNorth = (handle: ScreenshotCropHandle) => handle.includes('north')
const includesSouth = (handle: ScreenshotCropHandle) => handle.includes('south')
const includesWest = (handle: ScreenshotCropHandle) => handle.includes('west')
const includesEast = (handle: ScreenshotCropHandle) => handle.includes('east')

export function resizeScreenshotCrop(
  origin: ScreenshotCropRect,
  handle: ScreenshotCropHandle,
  delta: ScreenshotCropPoint,
  bounds: { width: number; height: number },
  minimumSize = 16,
): ScreenshotCropRect {
  if (handle === 'move') {
    return {
      ...origin,
      x: Math.max(0, Math.min(bounds.width - origin.width, origin.x + delta.x)),
      y: Math.max(0, Math.min(bounds.height - origin.height, origin.y + delta.y)),
    }
  }

  let left = origin.x
  let top = origin.y
  let right = origin.x + origin.width
  let bottom = origin.y + origin.height

  if (includesWest(handle)) left = Math.max(0, Math.min(right - minimumSize, left + delta.x))
  if (includesEast(handle))
    right = Math.min(bounds.width, Math.max(left + minimumSize, right + delta.x))
  if (includesNorth(handle)) top = Math.max(0, Math.min(bottom - minimumSize, top + delta.y))
  if (includesSouth(handle))
    bottom = Math.min(bounds.height, Math.max(top + minimumSize, bottom + delta.y))

  return { x: left, y: top, width: right - left, height: bottom - top }
}
