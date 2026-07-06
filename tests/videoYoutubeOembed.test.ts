import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizeYoutubeOEmbedMetadata,
  shouldPreferYoutubeOEmbedMetadata,
} from '../electron/video/youtubeOembed.ts'

test('shouldPreferYoutubeOEmbedMetadata accepts YouTube single video urls only', () => {
  assert.equal(shouldPreferYoutubeOEmbedMetadata('https://www.youtube.com/watch?v=HigBrtgPzKQ'), true)
  assert.equal(
    shouldPreferYoutubeOEmbedMetadata(
      'https://www.youtube.com/watch?v=hLQl3WQQoQ0&list=RDhLQl3WQQoQ0&start_radio=1',
    ),
    true,
  )
  assert.equal(shouldPreferYoutubeOEmbedMetadata('https://youtu.be/HigBrtgPzKQ'), true)
  assert.equal(shouldPreferYoutubeOEmbedMetadata('https://www.youtube.com/playlist?list=abc'), false)
  assert.equal(shouldPreferYoutubeOEmbedMetadata('https://www.bilibili.com/video/BV1G7jJ6nEbV/'), false)
})

test('normalizeYoutubeOEmbedMetadata creates a fast single-video parse result', () => {
  const result = normalizeYoutubeOEmbedMetadata(
    {
      title: 'Adele Ultimate Collection',
      thumbnail_url: 'https://i.ytimg.com/vi/HigBrtgPzKQ/hqdefault.jpg',
    },
    { fallbackUrl: 'https://www.youtube.com/watch?v=HigBrtgPzKQ' },
  )

  assert.equal(result.kind, 'single')
  assert.equal(result.source, 'youtube')
  assert.equal(result.title, 'Adele Ultimate Collection')
  assert.equal(result.sourceId, 'HigBrtgPzKQ')
  assert.equal(result.items.length, 1)
  assert.equal(result.items[0].sourceUrl, 'https://www.youtube.com/watch?v=HigBrtgPzKQ')
  assert.equal(result.items[0].thumbnailUrl, 'https://i.ytimg.com/vi/HigBrtgPzKQ/hqdefault.jpg')
  assert.equal(result.diagnostics[0].code, 'ok')
})

test('normalizeYoutubeOEmbedMetadata uses the current video id for watch urls with playlist params', () => {
  const result = normalizeYoutubeOEmbedMetadata(
    {
      title: 'Adele - Someone Like You',
      thumbnail_url: 'https://i.ytimg.com/vi/hLQl3WQQoQ0/hqdefault.jpg',
    },
    {
      fallbackUrl:
        'https://www.youtube.com/watch?v=hLQl3WQQoQ0&list=RDhLQl3WQQoQ0&start_radio=1',
    },
  )

  assert.equal(result.kind, 'single')
  assert.equal(result.source, 'youtube')
  assert.equal(result.sourceId, 'hLQl3WQQoQ0')
  assert.equal(result.sourceUrl, 'https://www.youtube.com/watch?v=hLQl3WQQoQ0')
  assert.equal(result.items.length, 1)
  assert.equal(result.items[0].sourceId, 'hLQl3WQQoQ0')
  assert.equal(result.items[0].sourceUrl, 'https://www.youtube.com/watch?v=hLQl3WQQoQ0')
})
