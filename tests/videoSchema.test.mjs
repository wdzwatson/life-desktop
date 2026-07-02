import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { initializeUserDatabase } from '../electron/db/schema.ts'

test('video schema includes groups, tags, links, and additive video metadata columns', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lifeos-video-schema-'))
  initializeUserDatabase(dir)

  const db = new Database(path.join(dir, 'videos.db'))
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
  const tableNames = tables.map((row) => row.name)

  assert.ok(tableNames.includes('video_groups'))
  assert.ok(tableNames.includes('video_tags'))
  assert.ok(tableNames.includes('video_tag_links'))

  const columns = db
    .prepare('PRAGMA table_info(videos)')
    .all()
    .map((row) => row.name)
  for (const column of [
    'group_id',
    'source_id',
    'source_url',
    'playlist_id',
    'playlist_title',
    'part_index',
    'thumbnail_url',
    'local_path',
    'selected_quality',
    'parse_status',
    'diagnostic_message',
  ]) {
    assert.ok(columns.includes(column), `missing ${column}`)
  }

  db.close()
})
