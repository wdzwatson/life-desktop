import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildMetadataArgs,
  buildDownloadArgs,
  type VideoCookieConfig,
  type VideoQualityPreference,
} from '../electron/video/ytDlpArgs.ts'

test('metadata args request full JSON without shell interpolation', () => {
  const args = buildMetadataArgs({
    url: 'https://www.youtube.com/watch?v=hLQl3WQQoQ0&list=RDhLQl3WQQoQ0',
    flatPlaylist: false,
    cookieConfig: { mode: 'none' },
  })

  assert.deepEqual(args, [
    '--skip-download',
    '--dump-single-json',
    '--no-warnings',
    'https://www.youtube.com/watch?v=hLQl3WQQoQ0&list=RDhLQl3WQQoQ0',
  ])
})

test('metadata args can request flat playlist preview', () => {
  const args = buildMetadataArgs({
    url: 'https://www.bilibili.com/video/BV15j2LBDEyv/',
    flatPlaylist: true,
    playlistEnd: 50,
    cookieConfig: { mode: 'none' },
  })

  assert.deepEqual(args, [
    '--skip-download',
    '--flat-playlist',
    '--dump-single-json',
    '--playlist-end',
    '50',
    '--no-warnings',
    'https://www.bilibili.com/video/BV15j2LBDEyv/',
  ])
})

test('metadata args support browser cookies', () => {
  const cookieConfig: VideoCookieConfig = { mode: 'browser', browser: 'chrome' }
  const args = buildMetadataArgs({
    url: 'https://www.bilibili.com/video/BV1G7jJ6nEbV/',
    flatPlaylist: false,
    cookieConfig,
  })

  assert.deepEqual(args, [
    '--skip-download',
    '--dump-single-json',
    '--cookies-from-browser',
    'chrome',
    '--no-warnings',
    'https://www.bilibili.com/video/BV1G7jJ6nEbV/',
  ])
})

test('metadata args support cookies file', () => {
  const cookieConfig: VideoCookieConfig = { mode: 'file', cookiesPath: '/Users/me/bili.txt' }
  const args = buildMetadataArgs({
    url: 'https://www.bilibili.com/video/BV1G7jJ6nEbV/',
    flatPlaylist: false,
    cookieConfig,
  })

  assert.deepEqual(args, [
    '--skip-download',
    '--dump-single-json',
    '--cookies',
    '/Users/me/bili.txt',
    '--no-warnings',
    'https://www.bilibili.com/video/BV1G7jJ6nEbV/',
  ])
})

test('download args select playable best quality with ffmpeg available', () => {
  const quality: VideoQualityPreference = 'best'
  const args = buildDownloadArgs({
    url: 'https://www.youtube.com/watch?v=hLQl3WQQoQ0',
    outputTemplate: '/Users/me/LifeOS/users/guest/files/videos/%(title)s.%(ext)s',
    cookieConfig: { mode: 'none' },
    quality,
    ffmpegPath: '/opt/homebrew/bin/ffmpeg',
  })

  assert.deepEqual(args, [
    '--newline',
    '--progress',
    '--no-playlist',
    '--print',
    'after_move:filepath:%(filepath)j',
    '-f',
    'bv*+ba/b',
    '--merge-output-format',
    'mp4',
    '--ffmpeg-location',
    '/opt/homebrew/bin/ffmpeg',
    '-o',
    '/Users/me/LifeOS/users/guest/files/videos/%(title)s.%(ext)s',
    'https://www.youtube.com/watch?v=hLQl3WQQoQ0',
  ])
})

test('download args keep progress visible when printing final filepath', () => {
  const args = buildDownloadArgs({
    url: 'https://www.youtube.com/watch?v=hLQl3WQQoQ0',
    outputTemplate: '/tmp/%(title)s.%(ext)s',
    cookieConfig: { mode: 'none' },
    quality: 'best',
  })

  assert.equal(args.includes('--print'), true)
  assert.equal(args.includes('--progress'), true)
  assert.equal(args.indexOf('--progress') < args.indexOf('--print'), true)
})

test('download args prevent playlist downloads for a single video item', () => {
  const args = buildDownloadArgs({
    url: 'https://www.bilibili.com/video/BV1QFTb6nE4L/?p=1',
    outputTemplate: '/tmp/%(title)s.%(ext)s',
    cookieConfig: { mode: 'none' },
    quality: 'best',
  })

  assert.equal(args.includes('--no-playlist'), true)
  assert.equal(args.indexOf('--no-playlist') < args.indexOf('-o'), true)
})
