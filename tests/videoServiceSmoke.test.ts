import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  resolveCookieConfigFromSettings,
  resolvePlaybackPath,
  resolveVideoToolPath,
} from '../electron/video/service.ts'

test('resolveVideoToolPath prefers configured path over executable name', () => {
  assert.equal(resolveVideoToolPath({ ytDlpPath: '/opt/bin/yt-dlp' }, 'yt-dlp'), '/opt/bin/yt-dlp')
  assert.equal(resolveVideoToolPath({}, 'yt-dlp'), 'yt-dlp')
})

test('resolveCookieConfigFromSettings handles none, browser, and file modes', () => {
  assert.deepEqual(resolveCookieConfigFromSettings({ cookieMode: 'none' }), { mode: 'none' })
  assert.deepEqual(
    resolveCookieConfigFromSettings({ cookieMode: 'browser', cookieBrowser: 'safari' }),
    {
      mode: 'browser',
      browser: 'safari',
    },
  )
  assert.deepEqual(
    resolveCookieConfigFromSettings({ cookieMode: 'file', cookiesPath: '/tmp/c.txt' }),
    {
      mode: 'file',
      cookiesPath: '/tmp/c.txt',
    },
  )
})

test('resolvePlaybackPath allows existing files inside the video directory', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'lifeos-video-playback-'))
  const videoDir = path.join(root, 'videos')
  mkdirSync(videoDir)
  const filePath = path.join(videoDir, 'clip with spaces.mp4')
  writeFileSync(filePath, 'fake')

  const result = resolvePlaybackPath(videoDir, filePath)

  assert.equal(result.success, true)
  assert.equal(result.url, `file://${filePath.replaceAll(' ', '%20')}`)
})

test('resolvePlaybackPath rejects sibling directories with the same prefix', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'lifeos-video-playback-'))
  const videoDir = path.join(root, 'videos')
  const siblingDir = path.join(root, 'videos-other')
  mkdirSync(videoDir)
  mkdirSync(siblingDir)
  const filePath = path.join(siblingDir, 'clip.mp4')
  writeFileSync(filePath, 'fake')

  const result = resolvePlaybackPath(videoDir, filePath)

  assert.equal(result.success, false)
})
