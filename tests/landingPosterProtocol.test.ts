import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { handleLandingPosterProtocolRequest } from '../electron/landingPosterProtocol.ts'

test('landing poster protocol serves only the managed current poster', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'lifeos-landing-poster-'))
  try {
    mkdirSync(root, { recursive: true })
    writeFileSync(path.join(root, 'landing-poster.webp'), 'poster-data')
    const response = await handleLandingPosterProtocolRequest({
      request: new Request('life-landing-poster://poster/current?v=1'),
      assetRoot: root,
    })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'image/webp')
    assert.equal(await response.text(), 'poster-data')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('landing poster protocol rejects invalid targets and methods', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'lifeos-landing-poster-'))
  try {
    writeFileSync(path.join(root, 'landing-poster.png'), 'poster-data')
    const traversal = await handleLandingPosterProtocolRequest({
      request: new Request('life-landing-poster://poster/../outside.png'),
      assetRoot: root,
    })
    const post = await handleLandingPosterProtocolRequest({
      request: new Request('life-landing-poster://poster/current', { method: 'POST' }),
      assetRoot: root,
    })
    assert.equal(traversal.status, 404)
    assert.equal(post.status, 405)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
