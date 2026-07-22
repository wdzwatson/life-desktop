import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createDouyinWebFavoritesClient,
  getDouyinResponseError,
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

test('web client asks the official page to load favorites data instead of issuing its own request', async () => {
  const requests: Array<{ pathname: string; params: Record<string, string | undefined> }> = []
  const client = createDouyinWebFavoritesClient({
    isLoggedIn: async () => true,
    request: async (pathname, params = {}) => {
      requests.push({ pathname, params })
      return {
        ok: true,
        status: 200,
        body: { collects_list: [], has_more: false },
      }
    },
  })

  await client.listFolders({ cursor: 'page-2' })
  assert.deepEqual(requests, [
    { pathname: '/aweme/v1/web/collects/list/', params: { count: '20', cursor: 'page-2' } },
  ])
})

test('a forbidden favorites response does not falsely report that a saved login expired', () => {
  const error = getDouyinResponseError({ ok: false, status: 403, body: { status_msg: 'request blocked' } })
  assert.equal(error.code, 'unsupported')
  assert.doesNotMatch(error.message, /expired/i)
})
