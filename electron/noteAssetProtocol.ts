import fs from 'node:fs'
import path from 'node:path'

export const NOTE_ASSET_PROTOCOL = 'life-note-asset'
export const NOTE_ASSET_HOST = 'attachment'

const MIME_TYPES: Record<string, string> = {
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.md': 'text/markdown; charset=utf-8',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.webp': 'image/webp',
}

function isSafeAssetName(value: string) {
  return (
    Boolean(value) &&
    !value.includes('\0') &&
    !value.includes('/') &&
    !value.includes('\\') &&
    !value.includes(':') &&
    value !== '.' &&
    value !== '..'
  )
}

export function getNoteAssetUrl(relativePath: string) {
  if (!isSafeAssetName(relativePath)) return undefined
  return `${NOTE_ASSET_PROTOCOL}://${NOTE_ASSET_HOST}/${encodeURIComponent(relativePath)}`
}

export function getNoteAssetRelativePath(urlValue: string) {
  try {
    const url = new URL(urlValue)
    if (
      url.protocol !== `${NOTE_ASSET_PROTOCOL}:` ||
      url.hostname !== NOTE_ASSET_HOST ||
      url.search ||
      url.hash
    ) {
      return undefined
    }
    const assetName = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    return isSafeAssetName(assetName) ? assetName : undefined
  } catch {
    return undefined
  }
}

export async function resolveNoteAssetPath(filesRoot: string, relativePath: string) {
  if (!isSafeAssetName(relativePath)) return undefined
  const root = path.resolve(filesRoot, 'notes')
  const resolved = path.resolve(root, relativePath)
  const relation = path.relative(root, resolved)
  if (!relation || relation.startsWith(`..${path.sep}`) || path.isAbsolute(relation))
    return undefined

  try {
    const [realRoot, realFile] = await Promise.all([
      fs.promises.realpath(root),
      fs.promises.realpath(resolved),
    ])
    const realRelation = path.relative(realRoot, realFile)
    if (
      !realRelation ||
      realRelation.startsWith(`..${path.sep}`) ||
      path.isAbsolute(realRelation)
    ) {
      return undefined
    }
    return realFile
  } catch {
    return undefined
  }
}

export function isNoteImageFile(fileName: string) {
  return ['.avif', '.gif', '.jpeg', '.jpg', '.png', '.webp'].includes(
    path.extname(fileName).toLowerCase(),
  )
}

export async function handleNoteAssetProtocolRequest(input: {
  request: Request
  filesRoot: string
}) {
  if (!['GET', 'HEAD'].includes(input.request.method.toUpperCase())) {
    return new Response('Method not allowed', { status: 405 })
  }
  const relativePath = getNoteAssetRelativePath(input.request.url)
  if (!relativePath) return new Response('Not found', { status: 404 })
  const filePath = await resolveNoteAssetPath(input.filesRoot, relativePath)
  if (!filePath) return new Response('Not found', { status: 404 })

  try {
    const data = await fs.promises.readFile(filePath)
    return new Response(input.request.method.toUpperCase() === 'HEAD' ? null : data, {
      headers: {
        'cache-control': 'private, max-age=86400',
        'content-type':
          MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
        'x-content-type-options': 'nosniff',
      },
    })
  } catch {
    return new Response('Not found', { status: 404 })
  }
}
