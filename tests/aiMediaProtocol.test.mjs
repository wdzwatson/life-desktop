import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { handleAIMediaProtocolRequest, parseAIMediaRange } from '../electron/ai/mediaProtocol.ts'
import { initializeAISchema } from '../electron/ai/schema.ts'

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'life-ai-protocol-'))
  const mediaRoot = path.join(dir, 'media')
  fs.mkdirSync(path.join(mediaRoot, 'video'), { recursive: true })
  const db = new Database(path.join(dir, 'ai.db'))
  initializeAISchema(db)
  const relativePath = path.join('video', 'sample.mp4')
  fs.writeFileSync(path.join(mediaRoot, relativePath), '0123456789')
  const result = db.prepare(`
    INSERT INTO ai_media_assets (media_type, mime_type, local_path, byte_size, status)
    VALUES ('video', 'video/mp4', ?, 10, 'completed')
  `).run(relativePath)
  return {
    dir,
    mediaRoot,
    db,
    assetId: Number(result.lastInsertRowid),
    close() {
      db.close()
      fs.rmSync(dir, { recursive: true, force: true })
    },
  }
}

test('range parsing supports full, bounded, open-ended, and suffix requests', () => {
  assert.equal(parseAIMediaRange(null, 10), undefined)
  assert.deepEqual(parseAIMediaRange('bytes=2-5', 10), { start: 2, end: 5 })
  assert.deepEqual(parseAIMediaRange('bytes=7-', 10), { start: 7, end: 9 })
  assert.deepEqual(parseAIMediaRange('bytes=-3', 10), { start: 7, end: 9 })
  assert.equal(parseAIMediaRange('bytes=20-30', 10), null)
  assert.equal(parseAIMediaRange('bytes=1-2,4-5', 10), null)
})

test('asset protocol serves complete files, HEAD, and video byte ranges', async () => {
  const context = setup()
  try {
    const url = `life-ai-asset://asset/${context.assetId}`
    const complete = await handleAIMediaProtocolRequest({ request: new Request(url), db: context.db, mediaRoot: context.mediaRoot })
    assert.equal(complete.status, 200)
    assert.equal(complete.headers.get('content-type'), 'video/mp4')
    assert.equal(complete.headers.get('accept-ranges'), 'bytes')
    assert.equal(complete.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(await complete.text(), '0123456789')

    const partial = await handleAIMediaProtocolRequest({
      request: new Request(url, { headers: { Range: 'bytes=2-5' } }),
      db: context.db,
      mediaRoot: context.mediaRoot,
    })
    assert.equal(partial.status, 206)
    assert.equal(partial.headers.get('content-range'), 'bytes 2-5/10')
    assert.equal(partial.headers.get('content-length'), '4')
    assert.equal(await partial.text(), '2345')

    const head = await handleAIMediaProtocolRequest({ request: new Request(url, { method: 'HEAD' }), db: context.db, mediaRoot: context.mediaRoot })
    assert.equal(head.status, 200)
    assert.equal(head.headers.get('content-length'), '10')
    assert.equal(await head.text(), '')
    assert.ok(context.db.prepare('SELECT last_accessed_at FROM ai_media_assets WHERE id = ?').get(context.assetId).last_accessed_at)
  } finally {
    context.close()
  }
})

test('asset protocol rejects invalid ranges, unknown assets, traversal rows, and symlink escapes', async (t) => {
  const context = setup()
  try {
    const invalidRange = await handleAIMediaProtocolRequest({
      request: new Request(`life-ai-asset://asset/${context.assetId}`, { headers: { Range: 'bytes=99-100' } }),
      db: context.db,
      mediaRoot: context.mediaRoot,
    })
    assert.equal(invalidRange.status, 416)
    assert.equal(invalidRange.headers.get('content-range'), 'bytes */10')
    assert.equal((await handleAIMediaProtocolRequest({ request: new Request('life-ai-asset://asset/999'), db: context.db, mediaRoot: context.mediaRoot })).status, 404)
    assert.equal((await handleAIMediaProtocolRequest({ request: new Request('life-ai-asset://other/1'), db: context.db, mediaRoot: context.mediaRoot })).status, 404)

    const traversal = context.db.prepare(`
      INSERT INTO ai_media_assets (media_type, mime_type, local_path, status) VALUES ('file', 'text/plain', '../outside.txt', 'completed')
    `).run()
    assert.equal((await handleAIMediaProtocolRequest({
      request: new Request(`life-ai-asset://asset/${traversal.lastInsertRowid}`),
      db: context.db,
      mediaRoot: context.mediaRoot,
    })).status, 404)

    if (process.platform !== 'win32') {
      const outside = path.join(context.dir, 'outside.txt')
      fs.writeFileSync(outside, 'private')
      fs.symlinkSync(outside, path.join(context.mediaRoot, 'escape.txt'))
      const symlink = context.db.prepare(`
        INSERT INTO ai_media_assets (media_type, mime_type, local_path, status) VALUES ('file', 'text/plain', 'escape.txt', 'completed')
      `).run()
      assert.equal((await handleAIMediaProtocolRequest({
        request: new Request(`life-ai-asset://asset/${symlink.lastInsertRowid}`),
        db: context.db,
        mediaRoot: context.mediaRoot,
      })).status, 404)
    } else t.diagnostic('Symlink escape check skipped on Windows.')
  } finally {
    context.close()
  }
})
