import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { handleVideoProtocolRequest, parseVideoRange } from '../electron/video/protocol.ts'

test('video range parsing supports bounded, open-ended, and suffix requests', () => {
  assert.equal(parseVideoRange(null, 10), undefined)
  assert.deepEqual(parseVideoRange('bytes=2-5', 10), { start: 2, end: 5 })
  assert.deepEqual(parseVideoRange('bytes=7-', 10), { start: 7, end: 9 })
  assert.deepEqual(parseVideoRange('bytes=-3', 10), { start: 7, end: 9 })
  assert.equal(parseVideoRange('bytes=20-30', 10), null)
  assert.equal(parseVideoRange('bytes=1-2,4-5', 10), null)
})

test('video protocol serves complete files and byte ranges for seeking', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeos-video-protocol-'))
  const videoDir = path.join(root, 'videos')
  fs.mkdirSync(videoDir)
  const videoPath = path.join(videoDir, 'clip.mp4')
  fs.writeFileSync(videoPath, '0123456789')
  const url = `life-video://play/${encodeURIComponent(videoPath)}`

  try {
    const complete = await handleVideoProtocolRequest({ request: new Request(url), userVideoDir: videoDir })
    assert.equal(complete.status, 200)
    assert.equal(complete.headers.get('content-type'), 'video/mp4')
    assert.equal(complete.headers.get('accept-ranges'), 'bytes')
    assert.equal(await complete.text(), '0123456789')

    const partial = await handleVideoProtocolRequest({
      request: new Request(url, { headers: { Range: 'bytes=2-5' } }),
      userVideoDir: videoDir,
    })
    assert.equal(partial.status, 206)
    assert.equal(partial.headers.get('content-range'), 'bytes 2-5/10')
    assert.equal(partial.headers.get('content-length'), '4')
    assert.equal(await partial.text(), '2345')

    const invalid = await handleVideoProtocolRequest({
      request: new Request(url, { headers: { Range: 'bytes=20-30' } }),
      userVideoDir: videoDir,
    })
    assert.equal(invalid.status, 416)
    assert.equal(invalid.headers.get('content-range'), 'bytes */10')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
