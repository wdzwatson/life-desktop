import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { initializeUserDatabase } from '../electron/db/schema.ts'

const VIDEO_GROUP_NAME_INDEX = 'video_groups_parent_name_unique'

function assertVideoGroupLocalizationSchema(db) {
  const translationColumns = db
    .prepare('PRAGMA table_info(video_group_translations)')
    .all()
    .map((column) => column.name)
  assert.deepEqual(translationColumns, ['group_id', 'locale', 'translation'])

  const index = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?")
    .get(VIDEO_GROUP_NAME_INDEX)
  assert.ok(index, `missing ${VIDEO_GROUP_NAME_INDEX}`)
  assert.match(index.sql, /UNIQUE INDEX/i)
  assert.match(index.sql.replaceAll(/\s+/g, ''), /COALESCE\(parent_id,-1\).*LOWER\(TRIM\(name\)\)/i)
}

function hasSingleColumnUniqueIndex(db, columnName) {
  const indexes = db
    .prepare('SELECT name, "unique" AS is_unique FROM pragma_index_list(?)')
    .all('video_groups')
  return indexes.some((index) => {
    if (!index.is_unique) return false
    const columns = db.prepare('SELECT name FROM pragma_index_info(?)').all(index.name)
    return columns.length === 1 && columns[0].name === columnName
  })
}

function hasSchemaObject(db, type, name) {
  return Boolean(
    db.prepare('SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?').get(type, name),
  )
}

test('video schema includes stateful list columns, scoped groups, translations, and download batches', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lifeos-video-schema-'))
  initializeUserDatabase(dir)

  const db = new Database(path.join(dir, 'videos.db'))
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
  const tableNames = tables.map((row) => row.name)

  for (const tableName of [
    'video_groups',
    'video_group_translations',
    'video_tags',
    'video_tag_links',
    'video_download_batches',
  ]) {
    assert.ok(tableNames.includes(tableName), `missing ${tableName}`)
  }

  assertVideoGroupLocalizationSchema(db)

  const groupColumns = db
    .prepare('PRAGMA table_info(video_groups)')
    .all()
    .map((column) => column.name)
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

  const batchColumns = db
    .prepare('PRAGMA table_info(video_download_batches)')
    .all()
    .map((row) => row.name)
  for (const column of [
    'id',
    'batch_key',
    'source_url',
    'source',
    'title',
    'item_count',
    'status',
    'created_at',
    'updated_at',
  ]) {
    assert.ok(batchColumns.includes(column), `missing batch column ${column}`)
  }

  assert.doesNotThrow(() => {
    db.prepare("INSERT INTO videos (title, status) VALUES ('Waiting clip', 'queued')").run()
  })

  const insertGroup = db.prepare('INSERT INTO video_groups (name, parent_id) VALUES (?, ?)')
  const parentA = Number(insertGroup.run('Parent A', null).lastInsertRowid)
  const parentB = Number(insertGroup.run('Parent B', null).lastInsertRowid)
  assert.doesNotThrow(() => insertGroup.run('Shared', null))
  assert.doesNotThrow(() => insertGroup.run('Shared', parentA))
  assert.doesNotThrow(() => insertGroup.run('Shared', parentB))
  assert.throws(() => insertGroup.run('  shared  ', parentA), /UNIQUE constraint failed/i)

  db.close()
})

test('legacy video groups migrate without changing hierarchy or video assignments', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lifeos-video-schema-legacy-'))
  const dbPath = path.join(dir, 'videos.db')
  const legacyDb = new Database(dbPath)
  legacyDb.exec(`
    CREATE TABLE video_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      parent_id INTEGER,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      status TEXT CHECK(status IN (
        'unclassified',
        'not_downloaded',
        'queued',
        'downloading',
        'downloaded',
        'download_failed',
        'invalid'
      )) DEFAULT 'not_downloaded',
      group_id INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    INSERT INTO video_groups (id, name, parent_id, sort_order, created_at, updated_at) VALUES
      (1, 'Parent', NULL, 10, '2025-01-01 10:00:00', '2025-01-02 10:00:00'),
      (2, 'Child', 1, 20, '2025-02-01 10:00:00', '2025-02-02 10:00:00');
    INSERT INTO videos (id, title, group_id) VALUES (1, 'Nested video', 2);
    UPDATE sqlite_sequence SET seq = 7 WHERE name = 'video_groups';
  `)
  legacyDb.close()

  initializeUserDatabase(dir)
  initializeUserDatabase(dir)

  const migratedDb = new Database(dbPath)
  assert.deepEqual(
    migratedDb
      .prepare(
        'SELECT id, name, parent_id, sort_order, created_at, updated_at FROM video_groups ORDER BY id',
      )
      .all(),
    [
      {
        id: 1,
        name: 'Parent',
        parent_id: null,
        sort_order: 10,
        created_at: '2025-01-01 10:00:00',
        updated_at: '2025-01-02 10:00:00',
      },
      {
        id: 2,
        name: 'Child',
        parent_id: 1,
        sort_order: 20,
        created_at: '2025-02-01 10:00:00',
        updated_at: '2025-02-02 10:00:00',
      },
    ],
  )
  assert.deepEqual(migratedDb.prepare('SELECT id, title, group_id FROM videos').get(), {
    id: 1,
    title: 'Nested video',
    group_id: 2,
  })
  assertVideoGroupLocalizationSchema(migratedDb)
  assert.equal(
    migratedDb.prepare('SELECT COUNT(*) AS count FROM video_group_translations').get().count,
    0,
  )

  const nextGroup = migratedDb.prepare("INSERT INTO video_groups (name) VALUES ('Next')").run()
  assert.equal(Number(nextGroup.lastInsertRowid), 8)
  assert.equal(migratedDb.pragma('foreign_keys', { simple: true }), 1)

  migratedDb.close()
})

test('legacy video groups without parent_id gain the scoped hierarchy schema', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lifeos-video-schema-no-parent-'))
  const dbPath = path.join(dir, 'videos.db')
  const legacyDb = new Database(dbPath)
  legacyDb.exec(`
    CREATE TABLE video_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO video_groups (id, name, sort_order) VALUES (1, 'Legacy root', 5);
  `)
  legacyDb.close()

  initializeUserDatabase(dir)

  const migratedDb = new Database(dbPath)
  assert.deepEqual(
    migratedDb.prepare('SELECT id, name, parent_id, sort_order FROM video_groups').get(),
    {
      id: 1,
      name: 'Legacy root',
      parent_id: null,
      sort_order: 5,
    },
  )
  assertVideoGroupLocalizationSchema(migratedDb)
  migratedDb.close()
})

test('failed legacy rebuild preserves the original global unique schema atomically', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lifeos-video-schema-conflict-'))
  const dbPath = path.join(dir, 'videos.db')
  const legacyDb = new Database(dbPath)
  legacyDb.exec(`
    CREATE TABLE video_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      parent_id INTEGER,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO video_groups (id, name, parent_id) VALUES
      (1, 'Parent', NULL),
      (2, 'AI', 1),
      (3, ' ai ', 1);
  `)
  legacyDb.close()

  assert.throws(() => initializeUserDatabase(dir), /UNIQUE constraint failed/i)

  const unchangedDb = new Database(dbPath)
  assert.deepEqual(
    unchangedDb.prepare('SELECT id, name, parent_id FROM video_groups ORDER BY id').all(),
    [
      { id: 1, name: 'Parent', parent_id: null },
      { id: 2, name: 'AI', parent_id: 1 },
      { id: 3, name: ' ai ', parent_id: 1 },
    ],
  )
  assert.equal(hasSingleColumnUniqueIndex(unchangedDb, 'name'), true)
  assert.equal(hasSchemaObject(unchangedDb, 'index', VIDEO_GROUP_NAME_INDEX), false)
  assert.equal(hasSchemaObject(unchangedDb, 'table', 'video_group_translations'), false)
  unchangedDb.close()
})

test('failed normalized index creation rolls back no-rebuild group schema changes', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lifeos-video-schema-no-rebuild-conflict-'))
  const dbPath = path.join(dir, 'videos.db')
  const legacyDb = new Database(dbPath)
  legacyDb.exec(`
    CREATE TABLE video_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO video_groups (id, name) VALUES
      (1, 'AI'),
      (2, ' ai ');
  `)
  legacyDb.close()

  assert.throws(() => initializeUserDatabase(dir), /UNIQUE constraint failed/i)

  const unchangedDb = new Database(dbPath)
  const columns = unchangedDb
    .prepare('PRAGMA table_info(video_groups)')
    .all()
    .map((column) => column.name)
  assert.equal(columns.includes('parent_id'), false)
  assert.deepEqual(unchangedDb.prepare('SELECT id, name FROM video_groups ORDER BY id').all(), [
    { id: 1, name: 'AI' },
    { id: 2, name: ' ai ' },
  ])
  assert.equal(hasSchemaObject(unchangedDb, 'index', VIDEO_GROUP_NAME_INDEX), false)
  assert.equal(hasSchemaObject(unchangedDb, 'table', 'video_group_translations'), false)
  unchangedDb.close()
})
