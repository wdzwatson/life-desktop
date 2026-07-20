import fs from 'fs'
import path from 'path'
import { Readable } from 'stream'
import type { Request } from 'electron'
import { resolveVideoProtocolPath } from './service'

export type VideoByteRange = { start: number; end: number }

export function parseVideoRange(value: string | null, size: number): VideoByteRange | undefined | null {
  if (!value) return undefined
  const match = value.match(/^bytes=(\d*)-(\d*)$/)
  if (!match || size < 1 || (!match[1] && !match[2])) return null

  let start: number
  let end: number
  if (!match[1]) {
    const suffixLength = Number(match[2])
    if (!Number.isInteger(suffixLength) || suffixLength <= 0) return null
    start = Math.max(size - suffixLength, 0)
    end = size - 1
  } else {
    start = Number(match[1])
    end = match[2] ? Number(match[2]) : size - 1
    if (!Number.isInteger(start) || !Number.isInteger(end) || start > end || start >= size) return null
    end = Math.min(end, size - 1)
  }
  return { start, end }
}

function getVideoMimeType(filePath: string) {
  const extension = path.extname(filePath).toLowerCase()
  const mimeTypes: Record<string, string> = {
    '.avi': 'video/x-msvideo',
    '.m4v': 'video/x-m4v',
    '.mkv': 'video/x-matroska',
    '.mov': 'video/quicktime',
    '.mp4': 'video/mp4',
    '.mpeg': 'video/mpeg',
    '.mpg': 'video/mpeg',
    '.webm': 'video/webm',
  }
  return mimeTypes[extension] || 'application/octet-stream'
}

export async function handleVideoProtocolRequest(input: {
  request: Request
  userVideoDir: string
}) {
  const resolved = resolveVideoProtocolPath(input.userVideoDir, input.request.url)
  if (!resolved.success || !resolved.path) {
    return new Response(resolved.error || 'Unable to load video.', { status: 403 })
  }

  let stats: fs.Stats
  try {
    stats = await fs.promises.stat(resolved.path)
  } catch {
    return new Response('Video file not found.', { status: 404 })
  }
  if (!stats.isFile()) return new Response('Video file not found.', { status: 404 })

  const range = parseVideoRange(input.request.headers.get('range'), stats.size)
  const commonHeaders = {
    'accept-ranges': 'bytes',
    'cache-control': 'private, max-age=86400',
    'content-type': getVideoMimeType(resolved.path),
    'x-content-type-options': 'nosniff',
  }
  if (range === null) {
    return new Response(null, {
      status: 416,
      headers: { ...commonHeaders, 'content-range': `bytes */${stats.size}` },
    })
  }

  const start = range?.start ?? 0
  const end = range?.end ?? Math.max(stats.size - 1, 0)
  const headers = new Headers({
    ...commonHeaders,
    'content-length': String(stats.size === 0 ? 0 : end - start + 1),
  })
  if (range) headers.set('content-range', `bytes ${start}-${end}/${stats.size}`)

  if (input.request.method.toUpperCase() === 'HEAD' || stats.size === 0) {
    return new Response(null, { status: range ? 206 : 200, headers })
  }

  const body = Readable.toWeb(fs.createReadStream(resolved.path, { start, end })) as ReadableStream<Uint8Array>
  return new Response(body, { status: range ? 206 : 200, headers })
}
