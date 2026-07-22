import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { initializeUserDatabase } from '../electron/db/schema.ts'
import {
  DouyinFavoritesError,
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
      author_id: 'author-1',
      author_name: 'Author',
      source_url: 'https://www.douyin.com/video/1234567890',
      thumbnail_url: 'https://p3.douyinpic.com/cover.jpg',
      duration_seconds: 63,
      collected_at: '2026-07-23T08:00:00.000Z',
      position: 0,
    },
  ])
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
  assert.ok(progress.some((event) => event.phase === 'writing_folders' && event.foldersDiscovered === 1))
  assert.ok(progress.some((event) => event.phase === 'writing_items' && event.itemsSynced === 1))
  assert.equal(progress.at(-1)?.phase, 'completed')
  assert.equal(progress.every((event) => typeof event.startedAt === 'number'), true)
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
    db.prepare('SELECT diagnostic_message FROM douyin_accounts').get().diagnostic_message.includes('private-session'),
    false,
  )
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
