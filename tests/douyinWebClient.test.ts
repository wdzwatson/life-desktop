import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createDouyinWebFavoritesClient,
  DOUYIN_MY_FAVORITE_NOTES_FOLDER_ID,
  DOUYIN_MY_FAVORITE_VIDEOS_FOLDER_ID,
} from '../electron/video/douyinWebClient.ts'

test('web client exposes virtual My favorites video and image-text collections', async () => {
  const cursors: Array<string | undefined> = []
  const client = createDouyinWebFavoritesClient({
    isLoggedIn: async () => true,
    listFavoriteVideos: async ({ cursor }) => {
      cursors.push(cursor)
      return {
        entries: [
          { remoteId: '123', title: 'Useful video', sourceUrl: 'https://www.douyin.com/video/123' },
        ],
        hasMore: false,
        isNewestFirst: true,
      }
    },
    listFavoriteNotes: async () => ({
      entries: [{ remoteId: '456', title: 'Useful note', sourceUrl: 'https://www.douyin.com/note/456' }],
      hasMore: false,
    }),
  })

  assert.deepEqual(await client.listFolders({}), {
    entries: [
      { remoteId: DOUYIN_MY_FAVORITE_VIDEOS_FOLDER_ID, title: 'My favorite videos' },
      { remoteId: DOUYIN_MY_FAVORITE_NOTES_FOLDER_ID, title: 'My favorite notes' },
    ],
    hasMore: false,
  })
  assert.deepEqual(await client.listFolders({ cursor: 'ignored' }), { entries: [], hasMore: false })
  assert.deepEqual(
    await client.listFolderItems({
      folderRemoteId: DOUYIN_MY_FAVORITE_VIDEOS_FOLDER_ID,
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
  assert.deepEqual(
    await client.listFolderItems({ folderRemoteId: DOUYIN_MY_FAVORITE_NOTES_FOLDER_ID }),
    {
      entries: [{ remoteId: '456', title: 'Useful note', sourceUrl: 'https://www.douyin.com/note/456' }],
      hasMore: false,
    },
  )
})

test('web client does not synchronize folder tabs or expired logins', async () => {
  const client = createDouyinWebFavoritesClient({
    isLoggedIn: async () => false,
    listFavoriteVideos: async () => ({ entries: [], hasMore: false }),
    listFavoriteNotes: async () => ({ entries: [], hasMore: false }),
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
