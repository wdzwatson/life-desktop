export interface DouyinReaderBounds {
  x: number
  y: number
  width: number
  height: number
}

export function normalizeDouyinReaderBounds(value: unknown): DouyinReaderBounds | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const candidate = value as Record<string, unknown>
  const x = Number(candidate.x)
  const y = Number(candidate.y)
  const width = Number(candidate.width)
  const height = Number(candidate.height)
  if (
    ![x, y, width, height].every(Number.isFinite) ||
    x < 0 ||
    y < 0 ||
    width < 1 ||
    height < 1
  ) {
    return null
  }
  return {
    x: Math.min(20_000, Math.floor(x)),
    y: Math.min(20_000, Math.floor(y)),
    width: Math.min(20_000, Math.floor(width)),
    height: Math.min(20_000, Math.floor(height)),
  }
}

export function isDouyinReaderSourceUrl(value: unknown) {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      (url.hostname === 'douyin.com' || url.hostname.endsWith('.douyin.com')) &&
      /^\/(note|article)\/\d+\/?$/.test(url.pathname)
    )
  } catch {
    return false
  }
}

export function isDouyinReaderNavigationUrl(value: string) {
  try {
    const url = new URL(value)
    return (
      url.protocol === 'https:' &&
      (url.hostname === 'douyin.com' || url.hostname.endsWith('.douyin.com'))
    )
  } catch {
    return false
  }
}
