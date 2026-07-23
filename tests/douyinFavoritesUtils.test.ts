import assert from 'node:assert/strict'
import test from 'node:test'
import {
  filterDouyinFavoriteItems,
  getActiveDouyinFolderId,
  type DouyinFavoriteFolderView,
  type DouyinFavoriteItemView,
} from '../src/views/douyinFavoritesUtils.ts'

const folders: DouyinFavoriteFolderView[] = [
  {
    id: 4,
    remote_id: 'folder-4',
    title: 'Learning',
    item_count: 2,
    sync_status: 'synced',
    last_sync_at: null,
    diagnostic_message: null,
  },
]

const items: DouyinFavoriteItemView[] = [
  {
    id: 1,
    remote_id: 'aweme-1',
    title: 'TypeScript tips',
    content_type: 'video',
    author_id: 'author-1',
    author_name: 'LifeOS',
    source_url: 'https://www.douyin.com/video/1',
    thumbnail_url: null,
    duration_seconds: 30,
    collected_at: null,
    position: 0,
  },
]

test('selects the first available Douyin folder when the active folder disappears', () => {
  assert.equal(getActiveDouyinFolderId(folders, 99), 4)
  assert.equal(getActiveDouyinFolderId(folders, 4), 4)
  assert.equal(getActiveDouyinFolderId([], 4), null)
})

test('filters favorite videos by title and author without changing ordering', () => {
  assert.deepEqual(filterDouyinFavoriteItems(items, 'lifeos'), items)
  assert.deepEqual(filterDouyinFavoriteItems(items, 'missing'), [])
})

test('filters image-text favorites separately from videos', () => {
  const imageText = { ...items[0], id: 2, title: 'Image-text guide', content_type: 'note' as const }
  assert.deepEqual(filterDouyinFavoriteItems([...items, imageText], '', 'note'), [imageText])
  assert.deepEqual(filterDouyinFavoriteItems([...items, imageText], '', 'video'), items)
})

test('filters article favorites separately from videos and image-text posts', () => {
  const article = { ...items[0], id: 3, title: 'Article guide', content_type: 'article' as const }
  assert.deepEqual(filterDouyinFavoriteItems([...items, article], '', 'article'), [article])
})
