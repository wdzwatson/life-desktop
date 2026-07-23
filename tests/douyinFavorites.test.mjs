import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { initializeUserDatabase } from '../electron/db/schema.ts'
import {
  DouyinFavoritesError,
  canDownloadDouyinFavorite,
  clearDouyinFavoriteItems,
  deleteDouyinFavoriteItems,
  getDouyinAccountSyncStatus,
  listDouyinFavoriteFolders,
  listDouyinFavoriteItems,
  normalizeDouyinFavoriteItem,
  sanitizeDouyinDiagnostic,
  syncDouyinFavorites,
} from '../electron/video/douyinFavorites.ts'

function createVideoDb() {
  const dir = mkdtempSync(path.join(tmpdir(), 'lifeos-douyin-favorites-'))
  initializeUserDatabase(dir)
  return new Database(path.join(dir, 'videos.db'))
}

function createClient(overrides = {}) {
  return {
    getAccountProfile: async () => ({ remoteUserId: 'sec-user-1', displayName: 'Douyin User' }),
    listFolders: async () => ({
      entries: [{ remoteId: 'folder-1', title: 'Learning', itemCount: 1 }],
      hasMore: false,
    }),
    listFolderItems: async () => ({
      entries: [
        {
          remoteId: 'aweme-1',
          title: 'Useful video',
          authorId: 'author-1',
          authorName: 'Author',
          sourceUrl: 'https://www.douyin.com/video/1234567890',
          thumbnailUrl: 'https://p3.douyinpic.com/cover.jpg',
          durationSeconds: 63.8,
          collectedAt: '2026-07-23T08:00:00.000Z',
        },
      ],
      hasMore: false,
    }),
    ...overrides,
  }
}

test('Douyin schema creates a local-only normalized favorite mirror', () => {
  const db = createVideoDb()
  const tableNames = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => row.name)

  for (const tableName of [
    'douyin_accounts',
    'douyin_favorite_folders',
    'douyin_favorite_items',
    'douyin_folder_items',
  ]) {
    assert.ok(tableNames.includes(tableName), `missing ${tableName}`)
  }

  const accountColumns = db
    .prepare('PRAGMA table_info(douyin_accounts)')
    .all()
    .map((column) => column.name)
  assert.equal(accountColumns.includes('cookie'), false)
  assert.equal(accountColumns.includes('token'), false)
  const folderColumns = db
    .prepare('PRAGMA table_info(douyin_favorite_folders)')
    .all()
    .map((column) => column.name)
  const itemColumns = db
    .prepare('PRAGMA table_info(douyin_favorite_items)')
    .all()
    .map((column) => column.name)
  assert.equal(folderColumns.includes('last_incremental_added_at'), true)
  assert.equal(itemColumns.includes('favorite_added_at'), true)
  assert.equal(itemColumns.includes('content_type'), true)
  db.close()
})

test('favorite synchronization upserts folders and items without duplication', async () => {
  const db = createVideoDb()
  const client = createClient()

  const first = await syncDouyinFavorites({
    db,
    sessionPartition: 'persist:lifeos-douyin-guest',
    client,
  })
  const second = await syncDouyinFavorites({
    db,
    sessionPartition: 'persist:lifeos-douyin-guest',
    client,
  })

  assert.deepEqual(
    { success: first.success, foldersSynced: first.foldersSynced, itemsSynced: first.itemsSynced },
    { success: true, foldersSynced: 1, itemsSynced: 1 },
  )
  assert.equal(second.success, true)
  assert.equal(second.itemsSynced, 0)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM douyin_accounts').get().count, 1)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM douyin_favorite_folders').get().count, 1)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM douyin_favorite_items').get().count, 1)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM douyin_folder_items').get().count, 1)
  const folders = listDouyinFavoriteFolders(db)
  assert.equal(folders.length, 1)
  assert.equal(folders[0].sync_status, 'synced')
  assert.ok(folders[0].last_sync_at)
  assert.deepEqual(listDouyinFavoriteItems(db, folders[0].id), [
    {
      id: 1,
      remote_id: 'aweme-1',
      title: 'Useful video',
      content_type: 'video',
      author_id: 'author-1',
      author_name: 'Author',
      source_url: 'https://www.douyin.com/video/1234567890',
      thumbnail_url: 'https://p3.douyinpic.com/cover.jpg',
      duration_seconds: 63,
      collected_at: '2026-07-23T08:00:00.000Z',
      favorite_added_at: null,
      position: 0,
      download_status: 'not_downloaded',
      download_progress: 0,
      local_path: null,
      download_error: null,
    },
  ])
  db.close()
})

test('favorite synchronization preserves image-text favorites in their own folder', async () => {
  const db = createVideoDb()
  const result = await syncDouyinFavorites({
    db,
    sessionPartition: 'persist:lifeos-douyin-guest',
    client: createClient({
      listFolders: async () => ({
        entries: [
          { remoteId: 'my-favorite-videos', title: 'My favorite videos' },
          { remoteId: 'my-favorite-notes', title: 'My favorite notes' },
        ],
        hasMore: false,
      }),
      listFolderItems: async ({ folderRemoteId }) => ({
        entries:
          folderRemoteId === 'my-favorite-notes'
            ? [
                {
                  remoteId: 'note-1',
                  title: 'Useful image-text post',
                  authorName: 'Author',
                  sourceUrl: 'https://www.douyin.com/note/456',
                  thumbnailUrl: 'https://p3.douyinpic.com/note-cover.jpg',
                  contentType: 'note',
                },
              ]
            : [
                {
                  remoteId: 'video-1',
                  title: 'Useful video',
                  sourceUrl: 'https://www.douyin.com/video/123',
                  contentType: 'video',
                },
              ],
        hasMore: false,
      }),
    }),
  })

  assert.deepEqual(
    { success: result.success, foldersSynced: result.foldersSynced, itemsSynced: result.itemsSynced },
    { success: true, foldersSynced: 2, itemsSynced: 2 },
  )
  const noteFolder = listDouyinFavoriteFolders(db).find((folder) => folder.remote_id === 'my-favorite-notes')
  assert.ok(noteFolder)
  const [note] = listDouyinFavoriteItems(db, noteFolder.id)
  assert.equal(note.remote_id, 'note-1')
  assert.equal(note.content_type, 'note')
  assert.equal(note.source_url, 'https://www.douyin.com/note/456')
  const allFavorites = listDouyinFavoriteItems(db, null, { offset: 0, limit: 20 })
  assert.equal(allFavorites.total, 2)
  assert.deepEqual(
    new Set(allFavorites.items.map((item) => item.content_type)),
    new Set(['video', 'note']),
  )
  db.close()
})

test('a mixed page persists video and image-text entries by each entry type', async () => {
  const db = createVideoDb()
  const result = await syncDouyinFavorites({
    db,
    sessionPartition: 'persist:lifeos-douyin-guest',
    client: createClient({
      listFolders: async () => ({
        entries: [{ remoteId: 'my-favorites', title: 'My favorites' }],
        hasMore: false,
      }),
      listFolderItems: async () => ({
        entries: [
          {
            remoteId: 'video-1',
            title: 'Useful video',
            sourceUrl: 'https://www.douyin.com/video/123',
          },
          {
            remoteId: 'note-1',
            title: 'Useful image-text post',
            sourceUrl: 'https://www.douyin.com/note/456',
          },
        ],
        hasMore: false,
      }),
    }),
  })

  assert.equal(result.success, true)
  const folder = listDouyinFavoriteFolders(db).find((entry) => entry.remote_id === 'my-favorites')
  assert.ok(folder)
  const all = listDouyinFavoriteItems(db, folder.id)
  assert.deepEqual(all.map((item) => [item.remote_id, item.content_type]), [
    ['video-1', 'video'],
    ['note-1', 'note'],
  ])
  db.close()
})

test('a failed image-text reader makes an otherwise successful sync partial', async () => {
  const db = createVideoDb()
  const result = await syncDouyinFavorites({
    db,
    sessionPartition: 'persist:lifeos-douyin-guest',
    client: createClient({
      listFolders: async () => ({
        entries: [
          { remoteId: 'my-favorite-videos', title: 'My favorite videos' },
          { remoteId: 'my-favorite-notes', title: 'My favorite notes' },
        ],
        hasMore: false,
      }),
      listFolderItems: async ({ folderRemoteId }) => {
        if (folderRemoteId === 'my-favorite-notes') throw new Error('图文 tab unavailable')
        return {
          entries: [
            { remoteId: 'video-1', title: 'Useful video', sourceUrl: 'https://www.douyin.com/video/123' },
          ],
          hasMore: false,
        }
      },
    }),
  })

  assert.equal(result.success, true)
  assert.equal(result.complete, false)
  assert.equal(result.partialFolders, 1)
  assert.equal(result.failedFolders, 1)
  assert.deepEqual(result.stopReasons, ['folder_failed'])
  const noteFolder = listDouyinFavoriteFolders(db).find((folder) => folder.remote_id === 'my-favorite-notes')
  assert.equal(noteFolder.sync_status, 'failed')
  assert.match(noteFolder.diagnostic_message, /图文 tab unavailable/)
  db.close()
})

test('only video favorites are eligible for video downloads', () => {
  assert.equal(canDownloadDouyinFavorite({ content_type: 'video' }), true)
  assert.equal(canDownloadDouyinFavorite({ content_type: 'note' }), false)
  assert.equal(canDownloadDouyinFavorite({ content_type: 'unknown' }), false)
})

test('favorite sync status is scoped to the current Douyin session', async () => {
  const db = createVideoDb()
  const sessionPartition = 'persist:lifeos-douyin-guest'

  assert.deepEqual(getDouyinAccountSyncStatus(db, sessionPartition), { everSyncFinished: false })
  await syncDouyinFavorites({ db, sessionPartition, client: createClient() })

  assert.deepEqual(getDouyinAccountSyncStatus(db, sessionPartition), { everSyncFinished: true })
  assert.deepEqual(getDouyinAccountSyncStatus(db, 'persist:lifeos-douyin-other'), {
    everSyncFinished: false,
  })
  db.close()
})

test('favorite synchronization reports page-level progress after local writes', async () => {
  const db = createVideoDb()
  const progress = []
  const result = await syncDouyinFavorites({
    db,
    sessionPartition: 'persist:lifeos-douyin-guest',
    client: createClient(),
    onProgress: (event) => progress.push(event),
  })

  assert.equal(result.success, true)
  assert.ok(progress.some((event) => event.phase === 'loading_folders'))
  assert.ok(
    progress.some((event) => event.phase === 'writing_folders' && event.foldersDiscovered === 1),
  )
  assert.ok(progress.some((event) => event.phase === 'writing_items' && event.itemsSynced === 1))
  assert.equal(progress.at(-1)?.phase, 'completed')
  assert.equal(
    progress.every((event) => typeof event.startedAt === 'number'),
    true,
  )
  db.close()
})

test('incremental sync stops after a page contains no new videos', async () => {
  const db = createVideoDb()
  const sessionPartition = 'persist:lifeos-douyin-guest'
  const firstClient = createClient({
    listFolderItems: async () => ({
      entries: [
        {
          remoteId: 'aweme-1',
          title: 'Older favorite',
          sourceUrl: 'https://www.douyin.com/video/1',
          favoriteAddedAt: '2026-07-20T00:00:00.000Z',
        },
      ],
      hasMore: false,
      isNewestFirst: true,
    }),
  })
  const first = await syncDouyinFavorites({ db, sessionPartition, client: firstClient })
  assert.equal(first.fullFolders, 1)

  const itemRequests = []
  const secondClient = createClient({
    listFolderItems: async (input) => {
      itemRequests.push(input)
      if (input.cursor) {
        return {
          entries: [
            {
              remoteId: 'aweme-1',
              title: 'Older favorite',
              sourceUrl: 'https://www.douyin.com/video/1',
              favoriteAddedAt: '2026-07-19T00:00:00.000Z',
            },
          ],
          hasMore: true,
          cursor: 'should-not-be-requested',
          isNewestFirst: true,
        }
      }
      return {
        entries: [
          {
            remoteId: 'aweme-2',
            title: 'New favorite',
            sourceUrl: 'https://www.douyin.com/video/2',
            favoriteAddedAt: '2026-07-21T00:00:00.000Z',
          },
        ],
        hasMore: true,
        cursor: 'older-page',
        isNewestFirst: true,
      }
    },
  })
  const second = await syncDouyinFavorites({ db, sessionPartition, client: secondClient })

  assert.equal(second.success, true)
  assert.equal(second.incrementalFolders, 1)
  assert.equal(itemRequests.length, 2)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM douyin_favorite_items').get().count, 2)
  assert.equal(
    db.prepare('SELECT incremental_capability FROM douyin_favorite_folders').get()
      .incremental_capability,
    'available',
  )
  db.close()
})

test('sync keeps scanning fully when the official page does not expose a verifiable favorite time', async () => {
  const db = createVideoDb()
  const sessionPartition = 'persist:lifeos-douyin-guest'
  const result = await syncDouyinFavorites({ db, sessionPartition, client: createClient() })

  assert.equal(result.fullFolders, 1)
  assert.equal(
    db.prepare('SELECT incremental_capability FROM douyin_favorite_folders').get()
      .incremental_capability,
    'unavailable',
  )
  db.close()
})

test('DOM-style sync stops at the first page with no new videos', async () => {
  const db = createVideoDb()
  const sessionPartition = 'persist:lifeos-douyin-guest'
  await syncDouyinFavorites({ db, sessionPartition, client: createClient() })

  const requests = []
  const result = await syncDouyinFavorites({
    db,
    sessionPartition,
    client: createClient({
      listFolderItems: async ({ cursor }) => {
        requests.push(cursor)
        return {
          entries: [
            {
              remoteId: 'aweme-1',
              title: 'Useful video',
              sourceUrl: 'https://www.douyin.com/video/1234567890',
            },
          ],
          hasMore: requests.length < 3,
          ...(requests.length < 3 ? { cursor: `page-${requests.length}` } : {}),
          isNewestFirst: true,
        }
      },
    }),
  })

  assert.equal(result.success, true)
  assert.equal(result.complete, true)
  assert.equal(result.incrementalFolders, 0)
  assert.equal(requests.length, 1)
  db.close()
})

test('explicit end marks ever sync completion and deleting the last item resets it', async () => {
  const db = createVideoDb()
  const result = await syncDouyinFavorites({
    db,
    sessionPartition: 'persist:lifeos-douyin-guest',
    client: createClient({
      listFolderItems: async () => ({
        entries: [
          {
            remoteId: 'ever-1',
            title: 'Ever synced',
            sourceUrl: 'https://www.douyin.com/video/1234567890',
          },
        ],
        hasMore: false,
        complete: true,
        stopReason: 'explicit_end',
      }),
    }),
  })
  assert.equal(result.complete, true)
  assert.equal(db.prepare('SELECT ever_sync_finished FROM douyin_accounts').get().ever_sync_finished, 1)
  const itemId = db.prepare('SELECT id FROM douyin_favorite_items WHERE remote_id = ?').get('ever-1').id
  assert.deepEqual(deleteDouyinFavoriteItems(db, [itemId]), { deleted: 1 })
  assert.equal(db.prepare('SELECT ever_sync_finished FROM douyin_accounts').get().ever_sync_finished, 0)
  db.close()
})

test('ever-complete sync continues through mixed pages and stops at an all-known page', async () => {
  const db = createVideoDb()
  const sessionPartition = 'persist:lifeos-douyin-guest'
  await syncDouyinFavorites({
    db,
    sessionPartition,
    client: createClient({
      listFolderItems: async () => ({
        entries: [
          { remoteId: 'known-1', title: 'Known 1', sourceUrl: 'https://www.douyin.com/video/1' },
          { remoteId: 'known-2', title: 'Known 2', sourceUrl: 'https://www.douyin.com/video/2' },
          { remoteId: 'known-3', title: 'Known 3', sourceUrl: 'https://www.douyin.com/video/3' },
          { remoteId: 'known-4', title: 'Known 4', sourceUrl: 'https://www.douyin.com/video/4' },
          { remoteId: 'known-5', title: 'Known 5', sourceUrl: 'https://www.douyin.com/video/5' },
        ],
        hasMore: false,
        complete: true,
        stopReason: 'explicit_end',
      }),
    }),
  })
  const requests = []
  const result = await syncDouyinFavorites({
    db,
    sessionPartition,
    client: createClient({
      listFolderItems: async ({ cursor }) => {
        requests.push(cursor)
        if (cursor) {
          return {
            entries: [
              {
                remoteId: 'known-3',
                title: 'Known 3',
                sourceUrl: 'https://www.douyin.com/video/3',
              },
              {
                remoteId: 'known-4',
                title: 'Known 4',
                sourceUrl: 'https://www.douyin.com/video/4',
              },
              {
                remoteId: 'known-5',
                title: 'Known 5',
                sourceUrl: 'https://www.douyin.com/video/5',
              },
            ],
            hasMore: true,
            cursor: 'should-not-be-requested',
            isNewestFirst: true,
          }
        }
        return {
          entries: [
            { remoteId: 'known-1', title: 'Known 1', sourceUrl: 'https://www.douyin.com/video/1' },
            { remoteId: 'new-1', title: 'New 1', sourceUrl: 'https://www.douyin.com/video/6' },
            { remoteId: 'known-2', title: 'Known 2', sourceUrl: 'https://www.douyin.com/video/2' },
          ],
          hasMore: true,
          cursor: `page-${requests.length}`,
          isNewestFirst: true,
        }
      },
    }),
  })
  assert.equal(result.complete, true)
  assert.equal(result.itemsSynced, 1)
  assert.deepEqual(requests, [undefined, 'page-1'])
  assert.equal(
    db.prepare('SELECT last_sync_stop_reason FROM douyin_favorite_folders').get()
      .last_sync_stop_reason,
    'known_items_page',
  )
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM douyin_favorite_items').get().count, 6)
  db.close()
})

test('a failed sync retains the last successful local mirror and redacts diagnostics', async () => {
  const db = createVideoDb()
  const sessionPartition = 'persist:lifeos-douyin-guest'
  await syncDouyinFavorites({ db, sessionPartition, client: createClient() })

  const result = await syncDouyinFavorites({
    db,
    sessionPartition,
    client: createClient({
      listFolders: async () => {
        throw new DouyinFavoritesError('rate_limited', 'Retry later; sessionid=private-session')
      },
    }),
  })

  assert.equal(result.success, false)
  assert.equal(result.error?.code, 'rate_limited')
  assert.equal(result.error?.message.includes('private-session'), false)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM douyin_favorite_items').get().count, 1)
  assert.equal(
    db
      .prepare('SELECT diagnostic_message FROM douyin_accounts')
      .get()
      .diagnostic_message.includes('private-session'),
    false,
  )
  db.close()
})

test('a failed My favorites video reader does not report an empty synchronization as successful', async () => {
  const db = createVideoDb()
  const result = await syncDouyinFavorites({
    db,
    sessionPartition: 'persist:lifeos-douyin-guest',
    client: createClient({
      listFolderItems: async () => {
        throw new DouyinFavoritesError('unsupported', 'Favorite video cards did not appear.')
      },
    }),
  })

  assert.equal(result.success, false)
  assert.equal(result.error?.code, 'unsupported')
  db.close()
})

test('normalization rejects non-Douyin and incomplete favorite video metadata', () => {
  assert.throws(
    () =>
      normalizeDouyinFavoriteItem({
        remoteId: 'aweme-1',
        title: 'Video',
        sourceUrl: 'https://example.com/video/1',
      }),
    (error) => error instanceof DouyinFavoritesError && error.code === 'invalid_response',
  )
  assert.equal(
    sanitizeDouyinDiagnostic('Cookie: private; authorization=Bearer-secret; token=abc'),
    'Cookie=[REDACTED]; authorization=[REDACTED]; token=[REDACTED]',
  )
})
