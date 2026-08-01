import fs from 'node:fs'
import path from 'node:path'

export const LANDING_POSTER_PROTOCOL = 'life-landing-poster'
export const LANDING_POSTER_HOST = 'poster'
export const LANDING_POSTER_FILE_STEM = 'landing-poster'

const MIME_TYPES: Record<string, string> = {
  '.avif': 'image/avif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
}

export function isLandingPosterExtension(extension: string) {
  return Object.hasOwn(MIME_TYPES, extension.toLowerCase())
}

export function getLandingPosterUrl(version?: string | number) {
  const search = version === undefined ? '' : `?v=${encodeURIComponent(String(version))}`
  return `${LANDING_POSTER_PROTOCOL}://${LANDING_POSTER_HOST}/current${search}`
}

function isCurrentPosterRequest(urlValue: string) {
  try {
    const url = new URL(urlValue)
    return (
      url.protocol === `${LANDING_POSTER_PROTOCOL}:` &&
      url.hostname === LANDING_POSTER_HOST &&
      url.pathname === '/current' &&
      !url.hash
    )
  } catch {
    return false
  }
}

async function findStoredPoster(assetRoot: string) {
  const root = path.resolve(assetRoot)
  try {
    const entries = await fs.promises.readdir(root, { withFileTypes: true })
    const poster = entries.find(
      (entry) => entry.isFile() && path.parse(entry.name).name === LANDING_POSTER_FILE_STEM &&
        isLandingPosterExtension(path.extname(entry.name)),
    )
    if (!poster) return undefined
    const resolved = path.resolve(root, poster.name)
    const relation = path.relative(root, resolved)
    if (!relation || relation.startsWith('..') || path.isAbsolute(relation)) return undefined
    return resolved
  } catch {
    return undefined
  }
}

export async function handleLandingPosterProtocolRequest(input: {
  request: Request
  assetRoot: string
}) {
  if (!['GET', 'HEAD'].includes(input.request.method.toUpperCase())) {
    return new Response('Method not allowed', { status: 405 })
  }
  if (!isCurrentPosterRequest(input.request.url)) return new Response('Not found', { status: 404 })

  const posterPath = await findStoredPoster(input.assetRoot)
  if (!posterPath) return new Response('Not found', { status: 404 })
  const contentType = MIME_TYPES[path.extname(posterPath).toLowerCase()]
  if (!contentType) return new Response('Not found', { status: 404 })

  try {
    const data = await fs.promises.readFile(posterPath)
    return new Response(input.request.method.toUpperCase() === 'HEAD' ? null : data, {
      headers: {
        'cache-control': 'private, max-age=86400',
        'content-type': contentType,
        'x-content-type-options': 'nosniff',
      },
    })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}
