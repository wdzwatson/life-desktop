import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createDouyinWebFavoritesClient,
  DOUYIN_MY_FAVORITES_FOLDER_ID,
} from '../electron/video/douyinWebClient.ts'

test('web client exposes one typed My favorites collection', async () => {
  const cursors: Array<string | undefined> = []
  const client = createDouyinWebFavoritesClient({
    isLoggedIn: async () => true,
    listFavoriteItems: async ({ cursor }) => {
      cursors.push(cursor)
      return {
        entries: [
          { remoteId: '123', title: 'Useful video', sourceUrl: 'https://www.douyin.com/video/123' },
        ],
        hasMore: false,
        isNewestFirst: true,
      }
    },
  })

  assert.deepEqual(await client.listFolders({}), {
    entries: [{ remoteId: DOUYIN_MY_FAVORITES_FOLDER_ID, title: 'My favorites' }],
    hasMore: false,
  })
  assert.deepEqual(await client.listFolders({ cursor: 'ignored' }), { entries: [], hasMore: false })
  assert.deepEqual(
    await client.listFolderItems({
      folderRemoteId: DOUYIN_MY_FAVORITES_FOLDER_ID,
      cursor: '2',
    }),
    {
      entries: [
        { remoteId: '123', title: 'Useful video', sourceUrl: 'https://www.douyin.com/video/123' },
      ],
      hasMore: false,
      isNewestFirst: true,
    },
  )
  assert.deepEqual(cursors, ['2'])
})

test('web client does not synchronize folder tabs or expired logins', async () => {
  const client = createDouyinWebFavoritesClient({
    isLoggedIn: async () => false,
    listFavoriteItems: async () => ({ entries: [], hasMore: false }),
  })

  await assert.rejects(
    client.getAccountProfile(),
    (error) => (error as { code?: string }).code === 'auth_required',
  )
  await assert.rejects(
    client.listFolderItems({ folderRemoteId: 'a-real-folder', cursor: undefined }),
    (error) => (error as { code?: string }).code === 'unsupported',
  )
})
