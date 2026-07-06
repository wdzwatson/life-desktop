import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { initializeUserDatabase } from '../electron/db/schema.ts'

test('video schema includes stateful list columns and download batches', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lifeos-video-schema-'))
  initializeUserDatabase(dir)

  const db = new Database(path.join(dir, 'videos.db'))
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
  const tableNames = tables.map((row) => row.name)

  for (const tableName of ['video_groups', 'video_tags', 'video_tag_links', 'video_download_batches']) {
    assert.ok(tableNames.includes(tableName), `missing ${tableName}`)
  }

  const groupColumns = db.prepare('PRAGMA table_info(video_groups)').all().map((column) => column.name)
  assert.ok(groupColumns.includes('parent_id'))

  const videoColumns = db
    .prepare('PRAGMA table_info(videos)')
    .all()
    .map((row) => row.name)
  for (const column of [
    'group_id',
    'source_id',
    'source_cid',
    'source_url',
    'playlist_id',
    'playlist_title',
    'part_index',
    'thumbnail_url',
    'local_path',
    'selected_quality',
    'parse_status',
    'diagnostic_message',
    'duration_seconds',
    'download_progress',
    'download_error',
    'invalid_reason',
    'download_batch_id',
    'download_batch_order',
    'downloaded_at',
    'created_at',
    'updated_at',
  ]) {
    assert.ok(videoColumns.includes(column), `missing ${column}`)
  }

  const batchColumns = db.prepare('PRAGMA table_info(video_download_batches)').all().map((row) => row.name)
  for (const column of ['id', 'batch_key', 'source_url', 'source', 'title', 'item_count', 'status', 'created_at', 'updated_at']) {
    assert.ok(batchColumns.includes(column), `missing batch column ${column}`)
  }

  assert.doesNotThrow(() => {
    db.prepare("INSERT INTO videos (title, status) VALUES ('Waiting clip', 'queued')").run()
  })

  db.close()
})
