import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { initializeAISchema } from '../electron/ai/schema.ts'
import {
  AIMediaService,
  assertSafeAIMediaUrl,
  isBlockedAIMediaAddress,
} from '../electron/ai/mediaService.ts'
import { AIServiceError } from '../electron/ai/types.ts'

const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='
const PNG_BYTES = Buffer.from(PNG_BASE64, 'base64')

function setup(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'life-ai-media-'))
  const mediaRoot = path.join(dir, 'media')
  const db = new Database(path.join(dir, 'ai.db'))
  initializeAISchema(db)
  let sequence = 0
  const service = new AIMediaService({
    db,
    mediaRoot,
    createId: () => `asset-${++sequence}`,
    reserveBytes: 0,
    now: () => new Date('2026-07-18T08:00:00.000Z'),
    ...overrides,
  })
  return {
    dir,
    mediaRoot,
    db,
    service,
    close() {
      db.close()
      fs.rmSync(dir, { recursive: true, force: true })
    },
  }
}

test('Base64 images are verified, hashed, atomically stored, and exposed only by asset URL', async () => {
  const context = setup()
  try {
    const asset = await context.service.storeBase64({
      mediaType: 'image',
      base64: `data:image/png;base64,${PNG_BASE64}`,
      originalName: '../unsafe:image.png',
    })
    assert.equal(asset.mimeType, 'image/png')
    assert.equal(asset.width, 1)
    assert.equal(asset.height, 1)
    assert.equal(asset.byteSize, PNG_BYTES.length)
    assert.match(asset.sha256, /^[a-f0-9]{64}$/)
    assert.equal(asset.url, `life-ai-asset://asset/${asset.id}`)
    assert.equal('localPath' in asset, false)
    const row = context.db.prepare('SELECT local_path, original_name, status FROM ai_media_assets WHERE id = ?').get(asset.id)
    assert.equal(path.isAbsolute(row.local_path), false)
    assert.equal(row.original_name, '.._unsafe_image.png')
    assert.equal(row.status, 'completed')
    assert.equal(fs.readFileSync(path.join(context.mediaRoot, row.local_path)).equals(PNG_BYTES), true)
    assert.deepEqual(fs.readdirSync(path.join(context.mediaRoot, '.tmp')), [])
  } finally {
    context.close()
  }
})

test('remote downloads revalidate HTTPS redirects and redact source credentials and query data', async () => {
  const requests = []
  const context = setup({
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    fetchImpl: async (url, init) => {
      requests.push({ url: String(url), redirect: init.redirect, headers: init.headers })
      if (requests.length === 1) {
        return new Response(null, { status: 302, headers: { location: 'https://cdn.example.test/result.png?token=redirect-secret' } })
      }
      return new Response(PNG_BYTES, {
        status: 200,
        headers: { 'content-type': 'text/plain', 'content-length': String(PNG_BYTES.length) },
      })
    },
  })
  try {
    const asset = await context.service.downloadRemote({
      mediaType: 'image',
      url: 'https://media.example.test/create.png?token=source-secret',
      headers: { Authorization: 'Bearer request-secret' },
    })
    assert.equal(asset.mimeType, 'image/png')
    assert.equal(requests.length, 2)
    assert.deepEqual(requests.map((item) => item.redirect), ['manual', 'manual'])
    assert.deepEqual(requests[1].headers, undefined)
    const row = context.db.prepare('SELECT source_url_redacted FROM ai_media_assets WHERE id = ?').get(asset.id)
    assert.equal(row.source_url_redacted, 'https://media.example.test/create.png')
    assert.doesNotMatch(JSON.stringify(context.service.getAsset(asset.id)), /source-secret|redirect-secret|request-secret/)
  } finally {
    context.close()
  }
})

test('SSRF policy rejects local, private, credentialed, non-HTTPS, and redirected private targets', async () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '169.254.10.2', '172.16.0.1', '192.0.2.1', '192.168.1.1', '198.51.100.1', '203.0.113.1', '::1', '::ffff:192.168.1.1', 'fd00::1', 'fe80::1', '2001:db8::1']) {
    assert.equal(isBlockedAIMediaAddress(address), true, address)
  }
  await assert.rejects(() => assertSafeAIMediaUrl('http://example.test/file.png'), permissionDenied)
  await assert.rejects(() => assertSafeAIMediaUrl('https://user:pass@example.test/file.png'), permissionDenied)
  await assert.rejects(() => assertSafeAIMediaUrl('https://localhost/file.png'), permissionDenied)
  await assert.rejects(
    () => assertSafeAIMediaUrl('https://private.example.test/file.png', async () => [{ address: '192.168.1.8', family: 4 }]),
    permissionDenied,
  )

  const context = setup({
    lookup: async (hostname) => [{ address: hostname.startsWith('private') ? '10.0.0.9' : '93.184.216.34', family: 4 }],
    fetchImpl: async () => new Response(null, { status: 302, headers: { location: 'https://private.example.test/secret.png' } }),
  })
  try {
    await assert.rejects(
      () => context.service.downloadRemote({ mediaType: 'image', url: 'https://public.example.test/start.png' }),
      permissionDenied,
    )
    const row = context.db.prepare('SELECT status, error_code FROM ai_media_assets').get()
    assert.deepEqual(row, { status: 'failed', error_code: 'permission_denied' })
  } finally {
    context.close()
  }
})

test('remote download cancellation aborts the request and cleans temporary files', async () => {
  let observedSignal
  const context = setup({
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    fetchImpl: async (_url, init) => new Promise((_, reject) => {
      observedSignal = init.signal
      init.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true })
    }),
  })
  try {
    const controller = new AbortController()
    const pending = context.service.downloadRemote({
      mediaType: 'image',
      url: 'https://example.test/pending.png',
      signal: controller.signal,
    })
    for (let index = 0; index < 50 && !observedSignal; index += 1) await new Promise((resolve) => setImmediate(resolve))
    controller.abort()
    await assert.rejects(
      pending,
      (error) => error instanceof AIServiceError && error.detail.code === 'cancelled',
    )
    assert.equal(observedSignal.aborted, true)
    assert.equal(context.db.prepare('SELECT status, error_code FROM ai_media_assets').get().error_code, 'cancelled')
    assert.deepEqual(fs.readdirSync(path.join(context.mediaRoot, '.tmp')), [])
  } finally {
    context.close()
  }
})

test('invalid MIME and oversized downloads fail without leaving partial completed files', async () => {
  const pdf = Buffer.from('%PDF-1.7\nnot an image')
  const mismatch = setup()
  try {
    await assert.rejects(
      () => mismatch.service.storeBase64({ mediaType: 'image', base64: pdf.toString('base64'), declaredMimeType: 'image/png' }),
      (error) => error instanceof AIServiceError && error.detail.code === 'media_failed',
    )
    assert.equal(mismatch.db.prepare('SELECT status FROM ai_media_assets').get().status, 'failed')
    assert.deepEqual(fs.readdirSync(path.join(mismatch.mediaRoot, '.tmp')), [])
  } finally {
    mismatch.close()
  }

  const oversized = setup({
    maxBytes: { image: 8 },
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    fetchImpl: async () => new Response(PNG_BYTES, { status: 200, headers: { 'content-length': String(PNG_BYTES.length) } }),
  })
  try {
    await assert.rejects(
      () => oversized.service.downloadRemote({ mediaType: 'image', url: 'https://example.test/large.png' }),
      (error) => error instanceof AIServiceError && error.detail.code === 'media_failed',
    )
    assert.equal(oversized.db.prepare('SELECT status FROM ai_media_assets').get().status, 'failed')
  } finally {
    oversized.close()
  }
})

test('asset deletion cannot remove unregistered files or follow registered symlinks outside the media root', async (t) => {
  if (process.platform === 'win32') return t.skip('Symlink creation requires platform-specific privileges on Windows.')
  const context = setup()
  const outside = path.join(context.dir, 'outside.txt')
  try {
    fs.mkdirSync(context.mediaRoot, { recursive: true })
    fs.writeFileSync(outside, 'keep')
    fs.symlinkSync(outside, path.join(context.mediaRoot, 'escape.txt'))
    const result = context.db.prepare(`
      INSERT INTO ai_media_assets (media_type, mime_type, local_path, status) VALUES ('file', 'text/plain', 'escape.txt', 'completed')
    `).run()
    await assert.rejects(
      () => context.service.deleteAsset(Number(result.lastInsertRowid)),
      (error) => error instanceof AIServiceError && error.detail.code === 'permission_denied',
    )
    assert.equal(fs.readFileSync(outside, 'utf8'), 'keep')
    await assert.rejects(() => context.service.deleteAsset(999), (error) => error instanceof AIServiceError && error.detail.code === 'not_found')
  } finally {
    context.close()
  }
})

function permissionDenied(error) {
  return error instanceof AIServiceError && error.detail.code === 'permission_denied'
}
