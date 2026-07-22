import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createDouyinWebFavoritesClient,
  normalizeDouyinAccountProfile,
  normalizeDouyinFolderItemPage,
  normalizeDouyinFolderPage,
} from '../electron/video/douyinWebClient.ts'

test('normalizes authenticated profile data without exposing session details', () => {
  assert.deepEqual(
    normalizeDouyinAccountProfile({ user: { sec_uid: 'sec-user-1', nickname: 'Douyin User' } }),
    { remoteUserId: 'sec-user-1', displayName: 'Douyin User' },
  )
})

test('normalizes a favorites folder page and preserves its cursor', () => {
  assert.deepEqual(
    normalizeDouyinFolderPage({
      collects_list: [{ collects_id: 'folder-1', collects_name: 'Learning', aweme_count: 2 }],
      cursor: 'next-folder-page',
      has_more: 1,
    }),
    {
      entries: [{ remoteId: 'folder-1', title: 'Learning', itemCount: 2 }],
      cursor: 'next-folder-page',
      hasMore: true,
    },
  )
})

test('normalizes favorite video metadata into a canonical Douyin webpage URL', () => {
  assert.deepEqual(
    normalizeDouyinFolderItemPage({
      aweme_list: [
        {
          aweme_id: '1234567890',
          desc: 'Useful video',
          create_time: 1_784_000_000,
          author: { uid: 'author-1', nickname: 'Author' },
          video: { duration: 63_800, cover: { url_list: ['https://p3.douyinpic.com/cover.jpg'] } },
        },
      ],
      has_more: false,
    }),
    {
      entries: [
        {
          remoteId: '1234567890',
          title: 'Useful video',
          sourceUrl: 'https://www.douyin.com/video/1234567890',
          authorId: 'author-1',
          authorName: 'Author',
          thumbnailUrl: 'https://p3.douyinpic.com/cover.jpg',
          durationSeconds: 64,
          collectedAt: '2026-07-14T03:33:20.000Z',
        },
      ],
      hasMore: false,
    },
  )
})

test('web client only executes fixed same-origin favorites requests', async () => {
  const scripts: string[] = []
  const client = createDouyinWebFavoritesClient({
    executeJavaScript: async (script) => {
      scripts.push(script)
      return {
        ok: true,
        status: 200,
        body: { collects_list: [], has_more: false },
      }
    },
  })

  await client.listFolders({ cursor: 'page-2' })
  assert.equal(scripts.length, 1)
  assert.match(scripts[0], /\/aweme\/v1\/web\/collects\/list\//)
  assert.match(scripts[0], /credentials: 'include'/)
  assert.doesNotMatch(scripts[0], /sessionid|cookie\s*:/i)
})
