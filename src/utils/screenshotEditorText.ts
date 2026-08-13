export type ScreenshotTextStyle = {
  color: string
  fontSize: number
  bold: boolean
  italic: boolean
  underline: boolean
  outline: boolean
  shadow: boolean
  rotation: number
  skewX: number
}

export type ScreenshotTextLayer = ScreenshotTextStyle & {
  id: string
  text: string
  x: number
  y: number
}

export type ScreenshotTextBounds = {
  width: number
  height: number
}

export const defaultScreenshotTextStyle: ScreenshotTextStyle = {
  color: '#ef4444',
  fontSize: 28,
  bold: false,
  italic: false,
  underline: false,
  outline: false,
  shadow: false,
  rotation: 0,
  skewX: 0,
}

export function getScreenshotTextFont(style: ScreenshotTextStyle, scaledSize: number) {
  return `${style.italic ? 'italic ' : ''}${style.bold ? '700' : '500'} ${scaledSize}px Geist, system-ui, sans-serif`
}

export function getScaledScreenshotTextSize(fontSize: number, canvasWidth: number) {
  return Math.max(12, (canvasWidth / 900) * fontSize)
}

export function screenshotTextContainsPoint(
  layer: ScreenshotTextLayer,
  bounds: ScreenshotTextBounds,
  point: { x: number; y: number },
  padding = 8,
) {
  const radians = (-layer.rotation * Math.PI) / 180
  const offsetX = point.x - layer.x
  const offsetY = point.y - layer.y
  const rotatedX = Math.cos(radians) * offsetX - Math.sin(radians) * offsetY
  const rotatedY = Math.sin(radians) * offsetX + Math.cos(radians) * offsetY
  const localX = rotatedX - Math.tan((layer.skewX * Math.PI) / 180) * rotatedY

  return (
    localX >= -padding &&
    localX <= bounds.width + padding &&
    rotatedY >= -padding &&
    rotatedY <= bounds.height + padding
  )
}

export function getScreenshotTextAabb(layer: ScreenshotTextLayer, bounds: ScreenshotTextBounds) {
  const radians = (layer.rotation * Math.PI) / 180
  const skew = Math.tan((layer.skewX * Math.PI) / 180)
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  const corners = [
    { x: 0, y: 0 },
    { x: bounds.width, y: 0 },
    { x: 0, y: bounds.height },
    { x: bounds.width, y: bounds.height },
  ].map((point) => {
    const skewedX = point.x + skew * point.y
    return {
      x: layer.x + cosine * skewedX - sine * point.y,
      y: layer.y + sine * skewedX + cosine * point.y,
    }
  })

  const left = Math.min(...corners.map((point) => point.x))
  const top = Math.min(...corners.map((point) => point.y))
  const right = Math.max(...corners.map((point) => point.x))
  const bottom = Math.max(...corners.map((point) => point.y))
  return { x: left, y: top, width: right - left, height: bottom - top }
}
