import type Database from 'better-sqlite3'
import { createHash, randomUUID } from 'node:crypto'
import { promises as dns } from 'node:dns'
import fs from 'node:fs'
import path from 'node:path'
import { isIP } from 'node:net'
import { AIServiceError, type AIErrorDetail } from './types'

export type AIMediaType = 'image' | 'video' | 'audio' | 'file'

export type AIStoredMediaAsset = {
  id: number
  mediaType: AIMediaType
  mimeType: string
  byteSize: number
  width?: number
  height?: number
  durationSeconds?: number
  sha256: string
  originalName?: string
  sourceUrlRedacted?: string
  url: string
  status: 'completed'
}

type LookupResult = { address: string; family: number }
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>

export type AIMediaServiceDependencies = {
  db: Database.Database
  mediaRoot: string
  fetchImpl?: FetchLike
  lookup?: (hostname: string) => Promise<LookupResult[]>
  now?: () => Date
  createId?: () => string
  reserveBytes?: number
  maxBytes?: Partial<Record<AIMediaType, number>>
}

const DEFAULT_MAX_BYTES: Record<AIMediaType, number> = {
  image: 25 * 1024 * 1024,
  video: 1024 * 1024 * 1024,
  audio: 200 * 1024 * 1024,
  file: 100 * 1024 * 1024,
}

const MIME_EXTENSION: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/wav': 'wav',
  'audio/ogg': 'ogg',
  'application/pdf': 'pdf',
}

function mediaError(code: AIErrorDetail['code'], message: string, retryable = false) {
  return new AIServiceError({ code, message, retryable })
}

function cleanMime(value: string | null | undefined) {
  return String(value ?? '').split(';', 1)[0].trim().toLowerCase()
}

function requireMediaType(value: unknown): AIMediaType {
  if (!['image', 'video', 'audio', 'file'].includes(String(value))) {
    throw mediaError('invalid_input', 'Invalid AI media type.')
  }
  return value as AIMediaType
}

function requireOptionalId(value: unknown, field: string) {
  if (value === undefined) return undefined
  if (!Number.isInteger(value) || Number(value) < 1) throw mediaError('invalid_input', `Invalid ${field}.`)
  return Number(value)
}

function requireId(value: unknown, field: string) {
  const id = requireOptionalId(value, field)
  if (id === undefined) throw mediaError('invalid_input', `Invalid ${field}.`)
  return id
}

function safeOriginalName(value: unknown) {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw mediaError('invalid_input', 'Invalid media file name.')
  const normalized = [...value.normalize('NFKC')]
    .map((character) => {
      const code = character.charCodeAt(0)
      return code < 32 || code === 127 || '/\\:'.includes(character) ? '_' : character
    })
    .join('')
    .trim()
    .slice(0, 240)
  return normalized || undefined
}

function redactSourceUrl(value: string) {
  const url = new URL(value)
  url.username = ''
  url.password = ''
  url.search = ''
  url.hash = ''
  return url.toString().slice(0, 8_000)
}

function parseIpv4(value: string) {
  const parts = value.split('.').map(Number)
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return undefined
  return parts
}

export function isBlockedAIMediaAddress(value: string) {
  const normalized = value.trim().toLowerCase().replace(/^\[|\]$/g, '')
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1]
  const ipv4 = parseIpv4(mapped ?? normalized)
  if (ipv4) {
    const [a, b] = ipv4
    return a === 0
      || a === 10
      || a === 127
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 0)
      || (a === 192 && b === 2)
      || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19))
      || (a === 198 && b === 51)
      || (a === 203 && b === 0)
      || a >= 224
  }
  if (isIP(normalized) === 6) {
    return normalized === '::'
      || normalized === '::1'
      || normalized.startsWith('::ffff:')
      || normalized.startsWith('fc')
      || normalized.startsWith('fd')
      || /^fe[89ab]/.test(normalized)
      || normalized.startsWith('2001:db8:')
      || normalized.startsWith('2002:')
  }
  return false
}

export async function assertSafeAIMediaUrl(
  value: string | URL,
  lookup: AIMediaServiceDependencies['lookup'] = async (hostname) =>
    dns.lookup(hostname, { all: true, verbatim: true }),
) {
  let url: URL
  try {
    url = value instanceof URL ? new URL(value) : new URL(value)
  } catch {
    throw mediaError('invalid_input', 'Invalid remote media URL.')
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw mediaError('permission_denied', 'Remote AI media must use an HTTPS URL without embedded credentials.')
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  if (!hostname || hostname.toLowerCase() === 'localhost' || hostname.toLowerCase().endsWith('.localhost')) {
    throw mediaError('permission_denied', 'Remote AI media cannot use a local address.')
  }
  let addresses: LookupResult[]
  try {
    addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await lookup(hostname)
  } catch {
    throw mediaError('network_error', 'The remote media host could not be resolved.', true)
  }
  if (addresses.length === 0 || addresses.some((entry) => isBlockedAIMediaAddress(entry.address))) {
    throw mediaError('permission_denied', 'Remote AI media cannot resolve to a private or local address.')
  }
  url.hash = ''
  return url
}

function detectMime(buffer: Buffer) {
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { mimeType: 'image/png', width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
  }
  if (buffer.length >= 10 && (buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a')) {
    return { mimeType: 'image/gif', width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) }
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return { mimeType: 'image/webp' }
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    for (let offset = 2; offset + 9 < buffer.length;) {
      if (buffer[offset] !== 0xff) { offset += 1; continue }
      const marker = buffer[offset + 1]
      if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue }
      const length = buffer.readUInt16BE(offset + 2)
      if (length < 2 || offset + 2 + length > buffer.length) break
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { mimeType: 'image/jpeg', height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) }
      }
      offset += 2 + length
    }
    return { mimeType: 'image/jpeg' }
  }
  if (buffer.length >= 12 && buffer.subarray(4, 8).toString('ascii') === 'ftyp') {
    return { mimeType: buffer.subarray(8, 12).toString('ascii') === 'qt  ' ? 'video/quicktime' : 'video/mp4' }
  }
  if (buffer.length >= 4 && buffer.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))) return { mimeType: 'video/webm' }
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString('ascii') === '%PDF') return { mimeType: 'application/pdf' }
  if (buffer.length >= 3 && buffer.subarray(0, 3).toString('ascii') === 'ID3') return { mimeType: 'audio/mpeg' }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WAVE') return { mimeType: 'audio/wav' }
  if (buffer.length >= 4 && buffer.subarray(0, 4).toString('ascii') === 'OggS') return { mimeType: 'audio/ogg' }
  return undefined
}

function validateDetectedMedia(mediaType: AIMediaType, detected: ReturnType<typeof detectMime>) {
  if (!detected) throw mediaError('media_failed', 'The downloaded file type could not be verified.')
  if (mediaType !== 'file' && !detected.mimeType.startsWith(`${mediaType}/`)) {
    throw mediaError('media_failed', `The downloaded file is not valid ${mediaType} content.`)
  }
  if (mediaType === 'image' && (!detected.width || !detected.height)) {
    throw mediaError('media_failed', 'The image could not be decoded well enough to determine its dimensions.')
  }
  return detected
}

function parseBase64(value: string, declaredMimeType?: string) {
  const match = value.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/)
  const mimeType = cleanMime(match?.[1] ?? declaredMimeType)
  const encoded = (match?.[2] ?? value).replace(/\s+/g, '')
  if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw mediaError('invalid_input', 'Invalid Base64 AI media payload.')
  }
  const buffer = Buffer.from(encoded, 'base64')
  if (buffer.length === 0 || buffer.toString('base64').replace(/=+$/, '') !== encoded.replace(/=+$/, '')) {
    throw mediaError('invalid_input', 'Invalid Base64 AI media payload.')
  }
  return { buffer, mimeType }
}

export function createAIMediaAssetUrl(assetId: number) {
  if (!Number.isInteger(assetId) || assetId < 1) throw mediaError('invalid_input', 'Invalid AI media asset ID.')
  return `life-ai-asset://asset/${assetId}`
}

export class AIMediaService {
  private readonly fetchImpl: FetchLike
  private readonly lookup: NonNullable<AIMediaServiceDependencies['lookup']>
  private readonly now: () => Date
  private readonly createId: () => string
  private readonly reserveBytes: number
  private readonly maxBytes: Record<AIMediaType, number>

  constructor(private readonly dependencies: AIMediaServiceDependencies) {
    this.fetchImpl = dependencies.fetchImpl ?? fetch
    this.lookup = dependencies.lookup ?? (async (hostname) => dns.lookup(hostname, { all: true, verbatim: true }))
    this.now = dependencies.now ?? (() => new Date())
    this.createId = dependencies.createId ?? randomUUID
    this.reserveBytes = dependencies.reserveBytes ?? 64 * 1024 * 1024
    this.maxBytes = { ...DEFAULT_MAX_BYTES, ...dependencies.maxBytes }
    dependencies.db.pragma('foreign_keys = ON')
  }

  async storeBase64(input: {
    mediaType: AIMediaType
    base64: string
    declaredMimeType?: string
    providerId?: number
    providerTaskId?: string
    originalName?: string
  }) {
    const mediaType = requireMediaType(input.mediaType)
    const decoded = parseBase64(input.base64, input.declaredMimeType)
    const recordId = this.createRecord({ ...input, mediaType, mimeType: decoded.mimeType || 'application/octet-stream' })
    return this.storeBuffer(recordId, mediaType, decoded.buffer, input.originalName)
  }

  async storeLocalFile(input: {
    mediaType: AIMediaType
    filePath: string
    declaredMimeType?: string
    providerId?: number
    providerTaskId?: string
    originalName?: string
  }) {
    const mediaType = requireMediaType(input.mediaType)
    if (typeof input.filePath !== 'string' || !path.isAbsolute(input.filePath)) {
      throw mediaError('invalid_input', 'Invalid local AI media file path.')
    }
    const recordId = this.createRecord({
      ...input,
      mediaType,
      mimeType: cleanMime(input.declaredMimeType) || 'application/octet-stream',
    })
    const tempPath = await this.createTempPath()
    try {
      const stats = await fs.promises.stat(input.filePath)
      if (!stats.isFile() || stats.size <= 0) throw mediaError('media_failed', 'The local AI media file is empty or invalid.')
      if (stats.size > this.maxBytes[mediaType]) throw mediaError('media_failed', 'The AI media exceeds the configured size limit.')
      await this.ensureDiskSpace(stats.size)
      await fs.promises.copyFile(input.filePath, tempPath, fs.constants.COPYFILE_EXCL)
      const detected = validateDetectedMedia(mediaType, detectMime(await this.readHead(tempPath)))
      return await this.finalizeFile(recordId, mediaType, tempPath, stats.size, detected, input.originalName)
    } catch (error) {
      await fs.promises.rm(tempPath, { force: true }).catch(() => undefined)
      const mapped = error instanceof AIServiceError ? error : mediaError('storage_error', 'The local AI media file could not be stored.')
      this.failRecord(recordId, mapped.detail)
      throw mapped
    }
  }

  async downloadRemote(input: {
    mediaType: AIMediaType
    url: string
    headers?: Record<string, string>
    providerId?: number
    providerTaskId?: string
    originalName?: string
    timeoutMs?: number
    signal?: AbortSignal
    preserveOnAbort?: boolean
  }) {
    const mediaType = requireMediaType(input.mediaType)
    const initialUrl = await assertSafeAIMediaUrl(input.url, this.lookup)
    const recordId = this.createRecord({
      ...input,
      mediaType,
      mimeType: 'application/octet-stream',
      sourceUrl: initialUrl.toString(),
    })
    const tempPath = await this.createTempPath()
    const controller = new AbortController()
    const timeoutMs = Math.min(Math.max(input.timeoutMs ?? 120_000, 1_000), 600_000)
    let timedOut = false
    const timeout = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
    const onAbort = () => controller.abort(input.signal?.reason)
    input.signal?.addEventListener('abort', onAbort, { once: true })
    if (input.signal?.aborted) controller.abort(input.signal.reason)
    try {
      let currentUrl = initialUrl
      let requestHeaders = input.headers
      let response: Response | undefined
      for (let redirect = 0; redirect <= 5; redirect += 1) {
        response = await this.fetchImpl(currentUrl, {
          method: 'GET',
          headers: requestHeaders,
          redirect: 'manual',
          signal: controller.signal,
        })
        if (![301, 302, 303, 307, 308].includes(response.status)) break
        if (redirect === 5) throw mediaError('network_error', 'The media download exceeded the redirect limit.', true)
        const location = response.headers.get('location')
        void response.body?.cancel().catch(() => undefined)
        if (!location) throw mediaError('network_error', 'The media redirect did not include a destination.', true)
        const nextUrl = await assertSafeAIMediaUrl(new URL(location, currentUrl), this.lookup)
        if (nextUrl.origin !== currentUrl.origin) requestHeaders = undefined
        currentUrl = nextUrl
      }
      if (!response?.ok || !response.body) throw mediaError('network_error', `The media download failed with HTTP ${response?.status ?? 0}.`, true)
      const contentLength = Number(response.headers.get('content-length'))
      if (Number.isFinite(contentLength) && contentLength > this.maxBytes[mediaType]) {
        throw mediaError('media_failed', 'The remote media exceeds the configured size limit.')
      }
      await this.ensureDiskSpace(Number.isFinite(contentLength) ? contentLength : 1024 * 1024)
      const file = await fs.promises.open(tempPath, 'wx')
      const reader = response.body.getReader()
      let byteSize = 0
      try {
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) break
          byteSize += chunk.value.byteLength
          if (byteSize > this.maxBytes[mediaType]) {
            controller.abort()
            throw mediaError('media_failed', 'The remote media exceeds the configured size limit.')
          }
          await file.write(chunk.value)
        }
      } finally {
        reader.releaseLock()
        await file.close()
      }
      const head = await this.readHead(tempPath)
      const detected = validateDetectedMedia(mediaType, detectMime(head))
      const stored = await this.finalizeFile(recordId, mediaType, tempPath, byteSize, detected, input.originalName)
      return stored
    } catch (error) {
      await fs.promises.rm(tempPath, { force: true }).catch(() => undefined)
      const fileCode = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
      const mapped = error instanceof AIServiceError
        ? error
        : /^(ENOSPC|EACCES|EPERM|EROFS|EDQUOT)$/.test(fileCode)
          ? mediaError('storage_error', 'The AI media file could not be written to disk.')
          : mediaError(
            timedOut ? 'timeout' : controller.signal.aborted ? 'cancelled' : 'network_error',
            timedOut ? 'The media download timed out.' : controller.signal.aborted ? 'The media download was cancelled.' : 'The media download failed.',
            !controller.signal.aborted,
          )
      this.failRecord(recordId, mapped.detail)
      throw mapped
    } finally {
      clearTimeout(timeout)
      input.signal?.removeEventListener('abort', onAbort)
    }
  }

  async downloadRemoteToAsset(input: {
    assetId: number
    mediaType: AIMediaType
    url: string
    headers?: Record<string, string>
    providerTaskId?: string
    declaredMimeType?: string
    durationSeconds?: number
    originalName?: string
    timeoutMs?: number
    signal?: AbortSignal
  }) {
    const assetId = requireId(input.assetId, 'media asset ID')
    const mediaType = requireMediaType(input.mediaType)
    const row = this.dependencies.db.prepare('SELECT id, media_type, status FROM ai_media_assets WHERE id = ?').get(assetId) as { id: number; media_type: string; status: string } | undefined
    if (!row) throw mediaError('not_found', 'AI media asset was not found.')
    if (row.media_type !== mediaType) throw mediaError('invalid_input', 'The AI media asset type does not match the download.')
    if (!['queued', 'generating', 'polling', 'downloading', 'processing'].includes(row.status)) {
      throw mediaError('invalid_input', 'The AI media asset cannot be overwritten.')
    }
    const initialUrl = await assertSafeAIMediaUrl(input.url, this.lookup)
    this.dependencies.db.prepare(`
      UPDATE ai_media_assets
      SET status = 'downloading',
        source_url_redacted = ?,
        provider_task_id = COALESCE(?, provider_task_id),
        mime_type = COALESCE(NULLIF(?, ''), mime_type),
        duration_seconds = COALESCE(?, duration_seconds),
        original_name = COALESCE(?, original_name),
        updated_at = ?
      WHERE id = ?
    `).run(
      redactSourceUrl(initialUrl.toString()),
      typeof input.providerTaskId === 'string' && input.providerTaskId.trim() ? input.providerTaskId.trim().slice(0, 1_000) : null,
      cleanMime(input.declaredMimeType),
      typeof input.durationSeconds === 'number' && Number.isFinite(input.durationSeconds) && input.durationSeconds >= 0 ? input.durationSeconds : null,
      safeOriginalName(input.originalName) ?? null,
      this.now().toISOString(),
      assetId,
    )
    const tempPath = await this.createTempPath()
    const controller = new AbortController()
    const timeoutMs = Math.min(Math.max(input.timeoutMs ?? 120_000, 1_000), 600_000)
    let timedOut = false
    const timeout = setTimeout(() => { timedOut = true; controller.abort() }, timeoutMs)
    const onAbort = () => controller.abort(input.signal?.reason)
    input.signal?.addEventListener('abort', onAbort, { once: true })
    if (input.signal?.aborted) controller.abort(input.signal.reason)
    try {
      let currentUrl = initialUrl
      let requestHeaders = input.headers
      let response: Response | undefined
      for (let redirect = 0; redirect <= 5; redirect += 1) {
        response = await this.fetchImpl(currentUrl, {
          method: 'GET',
          headers: requestHeaders,
          redirect: 'manual',
          signal: controller.signal,
        })
        if (![301, 302, 303, 307, 308].includes(response.status)) break
        if (redirect === 5) throw mediaError('network_error', 'The media download exceeded the redirect limit.', true)
        const location = response.headers.get('location')
        void response.body?.cancel().catch(() => undefined)
        if (!location) throw mediaError('network_error', 'The media redirect did not include a destination.', true)
        const nextUrl = await assertSafeAIMediaUrl(new URL(location, currentUrl), this.lookup)
        if (nextUrl.origin !== currentUrl.origin) requestHeaders = undefined
        currentUrl = nextUrl
      }
      if (!response?.ok || !response.body) throw mediaError('network_error', `The media download failed with HTTP ${response?.status ?? 0}.`, true)
      const contentLength = Number(response.headers.get('content-length'))
      if (Number.isFinite(contentLength) && contentLength > this.maxBytes[mediaType]) {
        throw mediaError('media_failed', 'The remote media exceeds the configured size limit.')
      }
      await this.ensureDiskSpace(Number.isFinite(contentLength) ? contentLength : 1024 * 1024)
      const file = await fs.promises.open(tempPath, 'wx')
      const reader = response.body.getReader()
      let byteSize = 0
      try {
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) break
          byteSize += chunk.value.byteLength
          if (byteSize > this.maxBytes[mediaType]) {
            controller.abort()
            throw mediaError('media_failed', 'The remote media exceeds the configured size limit.')
          }
          await file.write(chunk.value)
        }
      } finally {
        reader.releaseLock()
        await file.close()
      }
      const head = await this.readHead(tempPath)
      const detected = validateDetectedMedia(mediaType, detectMime(head))
      return await this.finalizeFile(assetId, mediaType, tempPath, byteSize, detected, input.originalName)
    } catch (error) {
      await fs.promises.rm(tempPath, { force: true }).catch(() => undefined)
      const fileCode = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
      const mapped = error instanceof AIServiceError
        ? error
        : /^(ENOSPC|EACCES|EPERM|EROFS|EDQUOT)$/.test(fileCode)
          ? mediaError('storage_error', 'The AI media file could not be written to disk.')
          : mediaError(
            timedOut ? 'timeout' : controller.signal.aborted ? 'cancelled' : 'network_error',
            timedOut ? 'The media download timed out.' : controller.signal.aborted ? 'The media download was cancelled.' : 'The media download failed.',
            !controller.signal.aborted,
          )
      if (!(input.preserveOnAbort && input.signal?.aborted)) this.failRecord(assetId, mapped.detail)
      throw mapped
    } finally {
      clearTimeout(timeout)
      input.signal?.removeEventListener('abort', onAbort)
    }
  }

  getAsset(assetIdValue: unknown) {
    const assetId = requireId(assetIdValue, 'media asset ID')
    const row = this.dependencies.db.prepare('SELECT * FROM ai_media_assets WHERE id = ?').get(assetId) as any
    if (!row) throw mediaError('not_found', 'AI media asset was not found.')
    return {
      id: row.id,
      mediaType: row.media_type,
      mimeType: row.mime_type,
      byteSize: row.byte_size,
      width: row.width,
      height: row.height,
      durationSeconds: row.duration_seconds,
      sha256: row.sha256,
      originalName: row.original_name,
      sourceUrlRedacted: row.source_url_redacted,
      status: row.status,
      ...(row.status === 'completed' && row.local_path ? { url: createAIMediaAssetUrl(row.id) } : {}),
      error: row.error_code || row.error_message ? { code: row.error_code, message: row.error_message } : null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  async deleteAsset(assetIdValue: unknown) {
    const assetId = requireId(assetIdValue, 'media asset ID')
    const row = this.dependencies.db.prepare('SELECT local_path FROM ai_media_assets WHERE id = ?').get(assetId) as { local_path: string | null } | undefined
    if (!row) throw mediaError('not_found', 'AI media asset was not found.')
    let sourcePath: string | undefined
    let trashPath: string | undefined
    if (row.local_path) {
      sourcePath = await this.resolveRegisteredPath(row.local_path)
      const trashDir = path.join(this.dependencies.mediaRoot, '.trash')
      await fs.promises.mkdir(trashDir, { recursive: true, mode: 0o700 })
      trashPath = path.join(trashDir, `${this.createId()}.trash`)
      await fs.promises.rename(sourcePath, trashPath)
    }
    try {
      this.dependencies.db.prepare('DELETE FROM ai_media_assets WHERE id = ?').run(assetId)
    } catch {
      if (sourcePath && trashPath) {
        await fs.promises.mkdir(path.dirname(sourcePath), { recursive: true, mode: 0o700 }).catch(() => undefined)
        await fs.promises.rename(trashPath, sourcePath).catch(() => undefined)
      }
      throw mediaError('storage_error', 'The AI media record could not be deleted.')
    }
    if (trashPath) await fs.promises.rm(trashPath, { force: true }).catch(() => undefined)
    return { deleted: true, assetId }
  }

  async getRegisteredFilePath(assetIdValue: unknown, includeProcessing = false) {
    const assetId = requireId(assetIdValue, 'media asset ID')
    const row = this.dependencies.db.prepare(`
      SELECT local_path FROM ai_media_assets
      WHERE id = ? AND status IN (${includeProcessing ? "'completed', 'processing'" : "'completed'"})
    `).get(assetId) as { local_path: string | null } | undefined
    if (!row?.local_path) throw mediaError('not_found', 'Completed AI media asset was not found.')
    return this.resolveRegisteredPath(row.local_path)
  }

  async copyAssetTo(assetIdValue: unknown, destination: string) {
    if (typeof destination !== 'string' || !path.isAbsolute(destination)) throw mediaError('invalid_input', 'Invalid AI media export path.')
    const source = await this.getRegisteredFilePath(assetIdValue)
    const root = path.resolve(this.dependencies.mediaRoot)
    const relation = path.relative(root, path.resolve(destination))
    if (!relation.startsWith('..') && !path.isAbsolute(relation)) {
      throw mediaError('permission_denied', 'Managed AI media files cannot be overwritten through export.')
    }
    await fs.promises.copyFile(source, destination)
    return { saved: true, path: destination }
  }

  private createRecord(input: {
    mediaType: AIMediaType
    mimeType: string
    providerId?: number
    providerTaskId?: string
    originalName?: string
    sourceUrl?: string
  }) {
    const providerId = requireOptionalId(input.providerId, 'provider ID')
    const originalName = safeOriginalName(input.originalName)
    const providerTaskId = typeof input.providerTaskId === 'string' ? input.providerTaskId.trim().slice(0, 1_000) : null
    const now = this.now().toISOString()
    try {
      const result = this.dependencies.db.prepare(`
        INSERT INTO ai_media_assets (
          provider_id, media_type, mime_type, source_url_redacted, provider_task_id,
          original_name, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'downloading', ?, ?)
      `).run(
        providerId ?? null,
        input.mediaType,
        cleanMime(input.mimeType) || 'application/octet-stream',
        input.sourceUrl ? redactSourceUrl(input.sourceUrl) : null,
        providerTaskId || null,
        originalName ?? null,
        now,
        now,
      )
      return Number(result.lastInsertRowid)
    } catch {
      throw mediaError('storage_error', 'The AI media record could not be created.')
    }
  }

  private async storeBuffer(recordId: number, mediaType: AIMediaType, buffer: Buffer, originalName?: string) {
    const tempPath = await this.createTempPath()
    try {
      if (buffer.length > this.maxBytes[mediaType]) throw mediaError('media_failed', 'The AI media exceeds the configured size limit.')
      await this.ensureDiskSpace(buffer.length)
      await fs.promises.writeFile(tempPath, buffer, { flag: 'wx' })
      const detected = validateDetectedMedia(mediaType, detectMime(buffer.subarray(0, 128 * 1024)))
      return await this.finalizeFile(recordId, mediaType, tempPath, buffer.length, detected, originalName)
    } catch (error) {
      await fs.promises.rm(tempPath, { force: true }).catch(() => undefined)
      const mapped = error instanceof AIServiceError ? error : mediaError('storage_error', 'The AI media file could not be stored.')
      this.failRecord(recordId, mapped.detail)
      throw mapped
    }
  }

  private async createTempPath() {
    const tempDir = path.join(this.dependencies.mediaRoot, '.tmp')
    await fs.promises.mkdir(tempDir, { recursive: true, mode: 0o700 })
    return path.join(tempDir, `${this.createId()}.part`)
  }

  private async finalizeFile(
    recordId: number,
    mediaType: AIMediaType,
    tempPath: string,
    byteSize: number,
    detected: NonNullable<ReturnType<typeof detectMime>>,
    originalName?: string,
  ): Promise<AIStoredMediaAsset> {
    const extension = MIME_EXTENSION[detected.mimeType]
    if (!extension) throw mediaError('media_failed', 'The verified media type is not supported.')
    const date = this.now()
    const relativePath = path.join(mediaType, String(date.getUTCFullYear()), String(date.getUTCMonth() + 1).padStart(2, '0'), `${this.createId()}.${extension}`)
    const finalPath = path.join(this.dependencies.mediaRoot, relativePath)
    await fs.promises.mkdir(path.dirname(finalPath), { recursive: true, mode: 0o700 })
    const hash = createHash('sha256')
    const file = await fs.promises.open(tempPath, 'r')
    try {
      const buffer = Buffer.allocUnsafe(1024 * 1024)
      while (true) {
        const chunk = await file.read(buffer, 0, buffer.length, null)
        if (chunk.bytesRead === 0) break
        hash.update(buffer.subarray(0, chunk.bytesRead))
      }
    } finally {
      await file.close()
    }
    await fs.promises.rename(tempPath, finalPath)
    const now = this.now().toISOString()
    try {
      this.dependencies.db.prepare(`
        UPDATE ai_media_assets SET local_path = ?, mime_type = ?, byte_size = ?, width = ?, height = ?,
          sha256 = ?, original_name = COALESCE(?, original_name), status = 'completed',
          error_code = NULL, error_message = NULL, updated_at = ?
        WHERE id = ?
      `).run(
        relativePath,
        detected.mimeType,
        byteSize,
        detected.width ?? null,
        detected.height ?? null,
        hash.digest('hex'),
        safeOriginalName(originalName) ?? null,
        now,
        recordId,
      )
    } catch {
      await fs.promises.rm(finalPath, { force: true }).catch(() => undefined)
      throw mediaError('storage_error', 'The AI media record could not be completed.')
    }
    return this.getAsset(recordId) as AIStoredMediaAsset
  }

  private failRecord(recordId: number, detail: AIErrorDetail) {
    try {
      this.dependencies.db.prepare(`
        UPDATE ai_media_assets SET status = 'failed', error_code = ?, error_message = ?, updated_at = ? WHERE id = ?
      `).run(detail.code, detail.message.slice(0, 20_000), this.now().toISOString(), recordId)
    } catch {
      // The original failure remains the actionable error.
    }
  }

  private async ensureDiskSpace(byteSize: number) {
    try {
      await fs.promises.mkdir(this.dependencies.mediaRoot, { recursive: true, mode: 0o700 })
    } catch {
      throw mediaError('storage_error', 'The AI media directory could not be created.')
    }
    let stats: Awaited<ReturnType<typeof fs.promises.statfs>>
    try {
      stats = await fs.promises.statfs(this.dependencies.mediaRoot)
    } catch {
      throw mediaError('storage_error', 'Available disk space could not be checked.')
    }
    const available = Number(stats.bavail) * Number(stats.bsize)
    if (available < byteSize + this.reserveBytes) throw mediaError('storage_error', 'There is not enough disk space to store this AI media file.')
  }

  private async readHead(filePath: string) {
    const file = await fs.promises.open(filePath, 'r')
    try {
      const buffer = Buffer.alloc(128 * 1024)
      const result = await file.read(buffer, 0, buffer.length, 0)
      return buffer.subarray(0, result.bytesRead)
    } finally {
      await file.close()
    }
  }

  private async resolveRegisteredPath(relativePath: string) {
    if (!relativePath || path.isAbsolute(relativePath) || relativePath.includes('\0')) {
      throw mediaError('permission_denied', 'The AI media path is invalid.')
    }
    const root = path.resolve(this.dependencies.mediaRoot)
    const resolved = path.resolve(root, relativePath)
    const relation = path.relative(root, resolved)
    if (!relation || relation.startsWith('..') || path.isAbsolute(relation)) throw mediaError('permission_denied', 'The AI media path escapes its storage directory.')
    const realRoot = await fs.promises.realpath(root)
    const realFile = await fs.promises.realpath(resolved)
    const realRelation = path.relative(realRoot, realFile)
    if (!realRelation || realRelation.startsWith('..') || path.isAbsolute(realRelation)) throw mediaError('permission_denied', 'The AI media file resolves outside its storage directory.')
    return realFile
  }
}
