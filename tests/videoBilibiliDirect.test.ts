import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  buildBilibiliApiUrl,
  parseBilibiliCookieFile,
  parseFfmpegProgressPercent,
  selectBilibiliDashStreams,
  shouldTryBilibiliDirectDownload,
} from '../electron/video/bilibiliDirect.ts'
import {
  hasBilibiliLoginCookie,
  serializeBilibiliCookiesToNetscape,
} from '../electron/video/bilibiliCookies.ts'

test('buildBilibiliApiUrl creates a playurl request from bvid and cid', () => {
  assert.equal(
    buildBilibiliApiUrl({
      bvid: 'BV1QFTb6nE4L',
      cid: '39625229177',
      quality: '720p',
    }),
    'https://api.bilibili.com/x/player/playurl?bvid=BV1QFTb6nE4L&cid=39625229177&qn=64&fnval=16&fourk=1',
  )
})

test('selectBilibiliDashStreams chooses streams within the requested quality', () => {
  const result = selectBilibiliDashStreams(
    {
      video: [
        { id: 80, bandwidth: 1000, baseUrl: 'https://video-1080' },
        { id: 64, bandwidth: 900, baseUrl: 'https://video-720' },
        { id: 32, bandwidth: 500, baseUrl: 'https://video-480' },
      ],
      audio: [
        { id: 30232, bandwidth: 80, baseUrl: 'https://audio-low' },
        { id: 30280, bandwidth: 120, baseUrl: 'https://audio-high' },
      ],
    },
    '720p',
  )

  assert.equal(result.videoUrl, 'https://video-720')
  assert.equal(result.audioUrl, 'https://audio-high')
})

test('parseBilibiliCookieFile returns a Cookie header for Bilibili domains', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lifeos-bili-cookies-'))
  const filePath = path.join(dir, 'cookies.txt')
  writeFileSync(
    filePath,
    [
      '# Netscape HTTP Cookie File',
      '.bilibili.com\tTRUE\t/\tFALSE\t0\tSESSDATA\tabc',
      '.example.com\tTRUE\t/\tFALSE\t0\tignored\tnope',
      'www.bilibili.com\tFALSE\t/\tFALSE\t0\tbili_jct\tdef',
      '',
    ].join('\n'),
  )

  assert.equal(parseBilibiliCookieFile(filePath), 'SESSDATA=abc; bili_jct=def')
})

test('parseBilibiliCookieFile keeps HttpOnly Bilibili login cookies', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lifeos-bili-cookies-'))
  const filePath = path.join(dir, 'cookies.txt')
  writeFileSync(
    filePath,
    [
      '# Netscape HTTP Cookie File',
      '#HttpOnly_.bilibili.com\tTRUE\t/\tTRUE\t1893456000\tSESSDATA\tsecret',
      '.bilibili.com\tTRUE\t/\tFALSE\t0\tDedeUserID\t123',
      '',
    ].join('\n'),
  )

  assert.equal(parseBilibiliCookieFile(filePath), 'SESSDATA=secret; DedeUserID=123')
})

test('serializeBilibiliCookiesToNetscape writes login cookies for yt-dlp', () => {
  const cookies = [
    {
      domain: '.bilibili.com',
      httpOnly: true,
      name: 'SESSDATA',
      path: '/',
      secure: true,
      expirationDate: 1893456000,
      value: 'secret',
    },
    {
      domain: '.example.com',
      name: 'ignored',
      value: 'nope',
    },
  ]

  assert.equal(hasBilibiliLoginCookie(cookies), true)
  const content = serializeBilibiliCookiesToNetscape(cookies)
  assert.match(content, /#HttpOnly_\.bilibili\.com\tTRUE\t\/\tTRUE\t1893456000\tSESSDATA\tsecret/)
  assert.doesNotMatch(content, /ignored/)
})

test('parseFfmpegProgressPercent reads ffmpeg progress output from duration', () => {
  assert.equal(parseFfmpegProgressPercent('out_time_ms=5000000\nprogress=continue', 10), 50)
  assert.equal(parseFfmpegProgressPercent('out_time_us=2500000\nprogress=continue', 10), 25)
  assert.equal(parseFfmpegProgressPercent('progress=end', 10), 99)
  assert.equal(parseFfmpegProgressPercent('out_time_ms=5000000', undefined), undefined)
})

test('shouldTryBilibiliDirectDownload avoids silent best-quality downgrade with browser cookies', () => {
  assert.equal(
    shouldTryBilibiliDirectDownload({
      url: 'https://www.bilibili.com/video/BV1QFTb6nE4L/?p=3',
      source: 'bilibili',
      quality: 'best',
      cookieConfig: { mode: 'browser', browser: 'chrome' },
    }),
    false,
  )
  assert.equal(
    shouldTryBilibiliDirectDownload({
      url: 'https://www.bilibili.com/video/BV1QFTb6nE4L/?p=3',
      source: 'bilibili',
      quality: '720p',
      cookieConfig: { mode: 'browser', browser: 'chrome' },
    }),
    true,
  )
})
