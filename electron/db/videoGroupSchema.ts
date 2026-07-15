import type Database from 'better-sqlite3'

const VIDEO_GROUP_NAME_INDEX = 'video_groups_parent_name_unique'

type TableColumn = {
  name: string
}

type IndexListRow = {
  name: string
  is_unique: number
}

type IndexInfoRow = {
  name: string | null
}

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

      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS ${VIDEO_GROUP_NAME_INDEX}
        ON video_groups (COALESCE(parent_id, -1), LOWER(TRIM(name)));

        CREATE TABLE IF NOT EXISTS video_group_translations (
          group_id INTEGER NOT NULL,
          locale TEXT NOT NULL,
          translation TEXT NOT NULL,
          PRIMARY KEY (group_id, locale),
          FOREIGN KEY (group_id) REFERENCES video_groups(id) ON DELETE CASCADE
        );
      `)
    })()
  } finally {
    db.pragma('foreign_keys = ON')
  }
}
