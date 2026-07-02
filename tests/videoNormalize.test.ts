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
  assert.equal(result.items[0].sourceId, 'BV15j2LBDEyv')
  assert.equal(result.items[1].sourceUrl, 'https://www.bilibili.com/video/BV15j2LBDEyv?p=2')
})

test('does not use non-webpage flat entry urls as source urls', () => {
  const result = normalizeYtDlpMetadata(
    {
      _type: 'playlist',
      extractor_key: 'BiliBili',
      id: 'BV15j2LBDEyv',
      title: 'Course',
      webpage_url: 'https://www.bilibili.com/video/BV15j2LBDEyv/',
      entries: [
        {
          _type: 'url',
          id: '15j2LBDEyv',
          title: 'P1',
          url: '15j2LBDEyv',
          playlist_index: 1,
          extractor_key: 'BiliBili',
        },
      ],
    },
    {
      fallbackUrl: 'https://www.bilibili.com/video/BV15j2LBDEyv/',
      wasFlatPlaylist: true,
    },
  )

  assert.equal(result.items[0].sourceUrl, 'https://www.bilibili.com/video/BV15j2LBDEyv/')
  assert.equal(result.items[0].sourceId, 'BV15j2LBDEyv')
})

test('does not use direct media urls as canonical source urls', () => {
  const result = normalizeYtDlpMetadata(
    {
      extractor_key: 'Youtube',
      id: 'hLQl3WQQoQ0',
      title: 'Adele - Someone Like You',
      url: 'https://rr2---sn.example.googlevideo.com/videoplayback?id=media',
    },
    {
      fallbackUrl: 'https://www.youtube.com/watch?v=hLQl3WQQoQ0',
      wasFlatPlaylist: false,
    },
  )

  assert.equal(result.sourceUrl, 'https://www.youtube.com/watch?v=hLQl3WQQoQ0')
  assert.equal(result.items[0].sourceUrl, 'https://www.youtube.com/watch?v=hLQl3WQQoQ0')
})

test('does not use generic cdn media file urls as canonical source urls', () => {
  const result = normalizeYtDlpMetadata(
    {
      extractor_key: 'Generic',
      id: 'clip',
      title: 'Clip',
      url: 'https://cdn.example.com/assets/clip.mp4?signature=abc',
    },
    {
      fallbackUrl: 'https://example.com/watch/clip',
      wasFlatPlaylist: false,
    },
  )

  assert.equal(result.sourceUrl, 'https://example.com/watch/clip')
  assert.equal(result.items[0].sourceUrl, 'https://example.com/watch/clip')
})

test('does not trust spoofed youtube or bilibili hostnames as source urls', () => {
  const result = normalizeYtDlpMetadata(
    {
      extractor_key: 'Generic',
      id: 'clip',
      title: 'Clip',
      url: 'https://notyoutube.com/assets/clip.mp4',
    },
    {
      fallbackUrl: 'https://example.com/watch/clip',
      wasFlatPlaylist: false,
    },
  )

  assert.equal(result.sourceUrl, 'https://example.com/watch/clip')
  assert.equal(result.items[0].sourceUrl, 'https://example.com/watch/clip')

  const biliResult = normalizeYtDlpMetadata(
    {
      extractor_key: 'Generic',
      id: 'clip',
      title: 'Clip',
      url: 'https://fakebilibili.com/assets/clip.mp4',
    },
    {
      fallbackUrl: 'https://example.com/watch/bili-clip',
      wasFlatPlaylist: false,
    },
  )

  assert.equal(biliResult.sourceUrl, 'https://example.com/watch/bili-clip')
  assert.equal(biliResult.items[0].sourceUrl, 'https://example.com/watch/bili-clip')
})

test('keeps explicit webpage urls with video path segments', () => {
  const result = normalizeYtDlpMetadata(
    {
      extractor_key: 'Generic',
      id: 'page-video',
      title: 'Page Video',
      webpage_url: 'https://example.com/video/page-video',
      url: 'https://cdn.example.com/assets/page-video.m3u8',
    },
    {
      fallbackUrl: 'https://example.com/collection',
      wasFlatPlaylist: false,
    },
  )

  assert.equal(result.sourceUrl, 'https://example.com/video/page-video')
  assert.equal(result.items[0].sourceUrl, 'https://example.com/video/page-video')
})

test('empty playlists return a warning diagnostic', () => {
  const result = normalizeYtDlpMetadata(
    {
      _type: 'playlist',
      extractor_key: 'Youtube',
      id: 'empty',
      title: 'Empty playlist',
      webpage_url: 'https://www.youtube.com/playlist?list=empty',
      entries: [],
    },
    {
      fallbackUrl: 'https://www.youtube.com/playlist?list=empty',
      wasFlatPlaylist: false,
    },
  )

  assert.equal(result.kind, 'playlist')
  assert.equal(result.items.length, 0)
  assert.equal(result.diagnostics[0].code, 'unknown_error')
  assert.equal(result.diagnostics[0].severity, 'warning')
})

test('maps Bilibili HTTP 412 to auth-aware diagnostic', () => {
  const diagnostic = normalizeYtDlpError(
    'ERROR: [BiliBili] 1G7jJ6nEbV: Unable to download JSON metadata: HTTP Error 412: Precondition Failed',
  )

  assert.equal(diagnostic.code, 'bilibili_412')
  assert.equal(diagnostic.severity, 'warning')
  assert.match(diagnostic.message, /cookies/)
})

test('maps expired cookies to refresh-cookie diagnostic', () => {
  const diagnostic = normalizeYtDlpError('ERROR: cookies have expired, please export new cookies')

  assert.equal(diagnostic.code, 'cookies_expired')
  assert.equal(diagnostic.severity, 'warning')
  assert.match(diagnostic.message, /refresh cookies|re-login/i)
})
