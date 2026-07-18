import type Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'

type AssetRow = {
  id: number
  mime_type: string
  local_path: string | null
  status: string
}

export type AIMediaByteRange = { start: number; end: number }

export function parseAIMediaRange(value: string | null, size: number): AIMediaByteRange | undefined | null {
  if (!value) return undefined
  const match = value.match(/^bytes=(\d*)-(\d*)$/)
  if (!match || size < 1) return null
  if (!match[1] && !match[2]) return null
  let start: number
  let end: number
  if (!match[1]) {
    const suffix = Number(match[2])
    if (!Number.isInteger(suffix) || suffix < 1) return null
    start = Math.max(size - suffix, 0)
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] ? Number(match[2]) : size - 1
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= size || end < start) return null
    end = Math.min(end, size - 1)
  }
  return { start, end }
}

function parseAssetId(urlValue: string) {
  try {
    const url = new URL(urlValue)
    if (url.protocol !== 'life-ai-asset:' || url.hostname !== 'asset' || url.search || url.hash) return undefined
    const match = url.pathname.match(/^\/(\d+)$/)
    const id = match ? Number(match[1]) : 0
    return Number.isInteger(id) && id > 0 ? id : undefined
  } catch {
    return undefined
  }
}

async function resolveAssetPath(mediaRoot: string, relativePath: string) {
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.includes('\0')) return undefined
  const root = path.resolve(mediaRoot)
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

function safeMime(value: string) {
  const mime = value.trim().toLowerCase()
  return /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/.test(mime)
    ? mime
    : 'application/octet-stream'
}

export async function handleAIMediaProtocolRequest(input: {
  request: Request
  db: Database.Database
  mediaRoot: string
}) {
  const assetId = parseAssetId(input.request.url)
  if (!assetId || !['GET', 'HEAD'].includes(input.request.method.toUpperCase())) return new Response('Not found', { status: 404 })
  const row = input.db.prepare('SELECT id, mime_type, local_path, status FROM ai_media_assets WHERE id = ?').get(assetId) as AssetRow | undefined
  if (!row || row.status !== 'completed' || !row.local_path) return new Response('Not found', { status: 404 })
  const filePath = await resolveAssetPath(input.mediaRoot, row.local_path)
  if (!filePath) return new Response('Not found', { status: 404 })
  let stats: fs.Stats
  try {
    stats = await fs.promises.stat(filePath)
  } catch {
    return new Response('Not found', { status: 404 })
  }
  if (!stats.isFile()) return new Response('Not found', { status: 404 })
  const range = parseAIMediaRange(input.request.headers.get('range'), stats.size)
  const commonHeaders = {
    'accept-ranges': 'bytes',
    'content-type': safeMime(row.mime_type),
    'x-content-type-options': 'nosniff',
    'cache-control': 'private, max-age=86400',
  }
  if (range === null) {
    return new Response(null, {
      status: 416,
      headers: { ...commonHeaders, 'content-range': `bytes */${stats.size}` },
    })
  }
  const start = range?.start ?? 0
  const end = range?.end ?? Math.max(stats.size - 1, 0)
  const contentLength = stats.size === 0 ? 0 : end - start + 1
  const headers = new Headers({ ...commonHeaders, 'content-length': String(contentLength) })
  if (range) headers.set('content-range', `bytes ${start}-${end}/${stats.size}`)
  try {
    input.db.prepare('UPDATE ai_media_assets SET last_accessed_at = CURRENT_TIMESTAMP WHERE id = ?').run(assetId)
  } catch {
    // Serving a verified local asset should not fail only because access telemetry could not be updated.
  }
  if (input.request.method.toUpperCase() === 'HEAD' || stats.size === 0) {
    return new Response(null, { status: range ? 206 : 200, headers })
  }
  const body = Readable.toWeb(fs.createReadStream(filePath, { start, end })) as ReadableStream<Uint8Array>
  return new Response(body, { status: range ? 206 : 200, headers })
}
