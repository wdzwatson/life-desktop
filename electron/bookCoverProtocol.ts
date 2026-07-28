import fs from 'node:fs'
import path from 'node:path'

const COVER_MIME_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
}

function getRelativeCoverPath(urlValue: string) {
  try {
    const url = new URL(urlValue)
    if (url.protocol !== 'life-book-cover:' || url.hostname !== 'cover' || url.search || url.hash) {
      return undefined
    }
    const relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '')
    if (!relativePath || relativePath.includes('\0') || path.isAbsolute(relativePath)) return undefined
    return relativePath
  } catch {
    return undefined
  }
}

async function resolveCoverPath(filesRoot: string, relativePath: string) {
  const root = path.resolve(filesRoot, 'book-covers')
  const resolved = path.resolve(root, relativePath)
  const relation = path.relative(root, resolved)
  if (!relation || relation.startsWith('..') || path.isAbsolute(relation)) return undefined
  try {
    const [realRoot, realFile] = await Promise.all([fs.promises.realpath(root), fs.promises.realpath(resolved)])
    const realRelation = path.relative(realRoot, realFile)
    if (!realRelation || realRelation.startsWith('..') || path.isAbsolute(realRelation)) return undefined
    return realFile
  } catch {
    return undefined
  }
}

export async function handleBookCoverProtocolRequest(input: { request: Request; filesRoot: string }) {
  if (!['GET', 'HEAD'].includes(input.request.method.toUpperCase())) {
    return new Response('Method not allowed', { status: 405 })
  }
  const relativePath = getRelativeCoverPath(input.request.url)
  if (!relativePath) return new Response('Not found', { status: 404 })
  const filePath = await resolveCoverPath(input.filesRoot, relativePath)
  if (!filePath) return new Response('Not found', { status: 404 })
  const contentType = COVER_MIME_TYPES[path.extname(filePath).toLowerCase()]
  if (!contentType) return new Response('Not found', { status: 404 })
  try {
    const data = await fs.promises.readFile(filePath)
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
