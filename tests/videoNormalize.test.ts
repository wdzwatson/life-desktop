import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { normalizeYtDlpError, normalizeYtDlpMetadata } from '../electron/video/normalize.ts'

function fixture(name: string) {
  return JSON.parse(readFileSync(new URL(`./fixtures/video/${name}`, import.meta.url), 'utf-8'))
}

test('normalizes YouTube playlist metadata', () => {
  const result = normalizeYtDlpMetadata(fixture('youtube-playlist.json'), {
    fallbackUrl: 'https://www.youtube.com/watch?v=hLQl3WQQoQ0&list=RDhLQl3WQQoQ0',
    wasFlatPlaylist: false,
  })

  assert.equal(result.kind, 'playlist')
  assert.equal(result.source, 'youtube')
  assert.equal(result.playlistId, 'RDhLQl3WQQoQ0')
  assert.equal(result.items.length, 1)
  assert.equal(result.items[0].sourceId, 'hLQl3WQQoQ0')
  assert.equal(result.items[0].durationLabel, '4:45')
  assert.equal(result.diagnostics[0].code, 'ok')
})

test('normalizes Bilibili flat playlist entries as selectable parts', () => {
  const result = normalizeYtDlpMetadata(fixture('bilibili-flat-playlist.json'), {
    fallbackUrl: 'https://www.bilibili.com/video/BV15j2LBDEyv/',
    wasFlatPlaylist: true,
  })

  assert.equal(result.kind, 'playlist')
  assert.equal(result.source, 'bilibili')
  assert.equal(result.playlistId, 'BV15j2LBDEyv')
  assert.equal(result.items.length, 2)
  assert.equal(result.items[0].partIndex, 1)
  assert.equal(result.items[1].sourceUrl, 'https://www.bilibili.com/video/BV15j2LBDEyv?p=2')
})

test('maps Bilibili HTTP 412 to auth-aware diagnostic', () => {
  const diagnostic = normalizeYtDlpError(
    'ERROR: [BiliBili] 1G7jJ6nEbV: Unable to download JSON metadata: HTTP Error 412: Precondition Failed',
  )

  assert.equal(diagnostic.code, 'bilibili_412')
  assert.equal(diagnostic.severity, 'warning')
  assert.match(diagnostic.message, /cookies/)
})
