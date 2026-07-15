import type Database from 'better-sqlite3'

const VIDEO_GROUP_NAME_INDEX = 'video_groups_parent_name_unique'

type TableColumn = {
  name: string
  type: string
  notnull: number
  pk: number
}

type IndexListRow = {
  name: string
  is_unique: number
}

type IndexInfoRow = {
  name: string | null
}

type IndexXInfoRow = {
  cid: number
  key: number
}

type SchemaObjectRow = {
  type: string
  sql: string | null
}

type ForeignKeyRow = {
  table: string
  from: string
  to: string
  on_delete: string
}

const VIDEO_GROUP_TRANSLATIONS_TABLE = 'video_group_translations'
const VIDEO_GROUP_TRANSLATIONS_REPLACEMENT = 'video_group_translations_new'

const createVideoGroupNameIndexSql = `
  CREATE UNIQUE INDEX ${VIDEO_GROUP_NAME_INDEX}
  ON video_groups (COALESCE(parent_id, -1), LOWER(TRIM(name)))
`

const createVideoGroupTranslationsSql = (tableName: string) => `
  CREATE TABLE ${tableName} (
    group_id INTEGER NOT NULL,
    locale TEXT NOT NULL,
    translation TEXT NOT NULL,
    PRIMARY KEY (group_id, locale),
    FOREIGN KEY (group_id) REFERENCES video_groups(id) ON DELETE CASCADE
  )
`

function hasLegacyGlobalNameUnique(db: Database.Database) {
  const indexes = db
    .prepare('SELECT name, "unique" AS is_unique FROM pragma_index_list(?)')
    .all('video_groups') as IndexListRow[]

  return indexes.some((index) => {
    if (!index.is_unique) return false
    const columns = db
      .prepare('SELECT name FROM pragma_index_info(?)')
      .all(index.name) as IndexInfoRow[]
    return columns.length === 1 && columns[0]?.name === 'name'
  })
}

function getSchemaObject(db: Database.Database, name: string) {
  return db.prepare('SELECT type, sql FROM sqlite_master WHERE name = ?').get(name) as
    SchemaObjectRow | undefined
}

function normalizeSchemaSql(sql: string) {
  return sql
    .replaceAll(/\s+/g, '')
    .replaceAll('"', '')
    .replaceAll('`', '')
    .replaceAll('[', '')
    .replaceAll(']', '')
    .replace(/;$/, '')
    .replace(/IFNOTEXISTS/gi, '')
    .toLowerCase()
}

function hasCompatibleVideoGroupNameIndex(db: Database.Database) {
  const index = db
    .prepare('SELECT "unique" AS is_unique FROM pragma_index_list(?) WHERE name = ?')
    .get('video_groups', VIDEO_GROUP_NAME_INDEX) as { is_unique: number } | undefined
  const schemaObject = getSchemaObject(db, VIDEO_GROUP_NAME_INDEX)
  if (!index?.is_unique || schemaObject?.type !== 'index' || !schemaObject.sql) return false

  const indexedExpressions = db
    .prepare('SELECT cid, key FROM pragma_index_xinfo(?) WHERE key = 1')
    .all(VIDEO_GROUP_NAME_INDEX) as IndexXInfoRow[]
  if (indexedExpressions.length !== 2 || indexedExpressions.some((row) => row.cid !== -2)) {
    return false
  }

  return normalizeSchemaSql(schemaObject.sql) === normalizeSchemaSql(createVideoGroupNameIndexSql)
}

function ensureVideoGroupNameIndex(db: Database.Database) {
  const schemaObject = getSchemaObject(db, VIDEO_GROUP_NAME_INDEX)
  if (hasCompatibleVideoGroupNameIndex(db)) return
  if (schemaObject && schemaObject.type !== 'index') {
    throw new Error(`${VIDEO_GROUP_NAME_INDEX} exists but is not an index`)
  }
  if (schemaObject) db.exec(`DROP INDEX ${VIDEO_GROUP_NAME_INDEX}`)
  db.exec(createVideoGroupNameIndexSql)
}

function hasCompatibleVideoGroupTranslations(db: Database.Database) {
  const schemaObject = getSchemaObject(db, VIDEO_GROUP_TRANSLATIONS_TABLE)
  if (schemaObject?.type !== 'table') return false

  const columns = db
    .prepare(`PRAGMA table_info(${VIDEO_GROUP_TRANSLATIONS_TABLE})`)
    .all() as TableColumn[]
  const hasExpectedColumns =
    columns.length === 3 &&
    columns[0]?.name === 'group_id' &&
    columns[0]?.type.toUpperCase() === 'INTEGER' &&
    columns[0]?.notnull === 1 &&
    columns[0]?.pk === 1 &&
    columns[1]?.name === 'locale' &&
    columns[1]?.type.toUpperCase() === 'TEXT' &&
    columns[1]?.notnull === 1 &&
    columns[1]?.pk === 2 &&
    columns[2]?.name === 'translation' &&
    columns[2]?.type.toUpperCase() === 'TEXT' &&
    columns[2]?.notnull === 1 &&
    columns[2]?.pk === 0
  if (!hasExpectedColumns) return false

  const foreignKeys = db
    .prepare(`PRAGMA foreign_key_list(${VIDEO_GROUP_TRANSLATIONS_TABLE})`)
    .all() as ForeignKeyRow[]
  return (
    foreignKeys.length === 1 &&
    foreignKeys[0]?.table === 'video_groups' &&
    foreignKeys[0]?.from === 'group_id' &&
    foreignKeys[0]?.to === 'id' &&
    foreignKeys[0]?.on_delete.toUpperCase() === 'CASCADE'
  )
}

function assertTranslationRowsAreSafe(db: Database.Database) {
  const nullRow = db
    .prepare(
      `SELECT 1 FROM ${VIDEO_GROUP_TRANSLATIONS_TABLE}
       WHERE group_id IS NULL OR locale IS NULL OR translation IS NULL
       LIMIT 1`,
    )
    .get()
  const duplicateRow = db
    .prepare(
      `SELECT 1 FROM ${VIDEO_GROUP_TRANSLATIONS_TABLE}
       GROUP BY group_id, locale
       HAVING COUNT(*) > 1
       LIMIT 1`,
    )
    .get()
  const orphanedRow = db
    .prepare(
      `SELECT 1 FROM ${VIDEO_GROUP_TRANSLATIONS_TABLE} translations
       LEFT JOIN video_groups groups ON groups.id = translations.group_id
       WHERE groups.id IS NULL
       LIMIT 1`,
    )
    .get()

  if (nullRow || duplicateRow || orphanedRow) {
    throw new Error('Cannot safely migrate invalid video group translations')
  }
}

function ensureVideoGroupTranslations(db: Database.Database) {
  const schemaObject = getSchemaObject(db, VIDEO_GROUP_TRANSLATIONS_TABLE)
  if (!schemaObject) {
    db.exec(createVideoGroupTranslationsSql(VIDEO_GROUP_TRANSLATIONS_TABLE))
    return
  }
  if (schemaObject.type !== 'table') {
    throw new Error(`${VIDEO_GROUP_TRANSLATIONS_TABLE} exists but is not a table`)
  }

  const columns = db
    .prepare(`PRAGMA table_info(${VIDEO_GROUP_TRANSLATIONS_TABLE})`)
    .all() as TableColumn[]
  const columnNames = new Set(columns.map((column) => column.name))
  const canMapTranslationRows = ['group_id', 'locale', 'translation'].every((name) =>
    columnNames.has(name),
  )
  const rowCount = db
    .prepare(`SELECT COUNT(*) AS count FROM ${VIDEO_GROUP_TRANSLATIONS_TABLE}`)
    .get() as { count: number }

  if (!canMapTranslationRows) {
    if (rowCount.count > 0) {
      throw new Error('Cannot safely migrate video group translations with unknown columns')
    }
    db.exec(`DROP TABLE ${VIDEO_GROUP_TRANSLATIONS_TABLE}`)
    db.exec(createVideoGroupTranslationsSql(VIDEO_GROUP_TRANSLATIONS_TABLE))
    return
  }

  assertTranslationRowsAreSafe(db)
  if (hasCompatibleVideoGroupTranslations(db)) return
  if (getSchemaObject(db, VIDEO_GROUP_TRANSLATIONS_REPLACEMENT)) {
    throw new Error(`${VIDEO_GROUP_TRANSLATIONS_REPLACEMENT} already exists`)
  }

  db.exec(`
    ${createVideoGroupTranslationsSql(VIDEO_GROUP_TRANSLATIONS_REPLACEMENT)};
    INSERT INTO ${VIDEO_GROUP_TRANSLATIONS_REPLACEMENT} (group_id, locale, translation)
    SELECT group_id, locale, translation FROM ${VIDEO_GROUP_TRANSLATIONS_TABLE};
    DROP TABLE ${VIDEO_GROUP_TRANSLATIONS_TABLE};
    ALTER TABLE ${VIDEO_GROUP_TRANSLATIONS_REPLACEMENT} RENAME TO ${VIDEO_GROUP_TRANSLATIONS_TABLE};
  `)
}

function rebuildLegacyVideoGroups(
  db: Database.Database,
  columnNames: Set<string>,
  legacySequence: number | undefined,
) {
  const parentId = columnNames.has('parent_id') ? 'parent_id' : 'NULL'

  db.exec(`
    CREATE TABLE video_groups_new (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      parent_id INTEGER,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    INSERT INTO video_groups_new (id, name, parent_id, sort_order, created_at, updated_at)
    SELECT id, name, ${parentId}, sort_order, created_at, updated_at
    FROM video_groups;

    DROP TABLE video_groups;
    ALTER TABLE video_groups_new RENAME TO video_groups;
  `)

  if (legacySequence !== undefined) {
    const result = db
      .prepare("UPDATE sqlite_sequence SET seq = ? WHERE name = 'video_groups'")
      .run(legacySequence)
    if (result.changes === 0) {
      db.prepare("INSERT INTO sqlite_sequence (name, seq) VALUES ('video_groups', ?)").run(
        legacySequence,
      )
    }
  }
}

export function ensureVideoGroupSchema(db: Database.Database) {
  const columns = db.prepare('PRAGMA table_info(video_groups)').all() as TableColumn[]
  const columnNames = new Set(columns.map((column) => column.name))
  const needsRebuild = hasLegacyGlobalNameUnique(db)
  const sequence = db
    .prepare("SELECT seq FROM sqlite_sequence WHERE name = 'video_groups'")
    .get() as { seq: number } | undefined

  db.pragma('foreign_keys = OFF')
  try {
    db.transaction(() => {
      if (needsRebuild) {
        rebuildLegacyVideoGroups(db, columnNames, sequence?.seq)
      } else if (!columnNames.has('parent_id')) {
        db.prepare('ALTER TABLE video_groups ADD COLUMN parent_id INTEGER').run()
      }

      ensureVideoGroupNameIndex(db)
      ensureVideoGroupTranslations(db)
    })()
  } finally {
    db.pragma('foreign_keys = ON')
  }
}
