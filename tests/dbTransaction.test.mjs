import assert from 'node:assert/strict'
import test from 'node:test'
import Database from 'better-sqlite3'
import { runDbTransaction } from '../electron/db/transaction.ts'
import {
  buildBookCategoryMigrationStatements,
  buildCategoryStorageAliasMap,
} from '../src/views/bookCategorySidebarUtils.ts'
import {
  buildCreateVideoGroupStatements,
  buildDeleteVideoGroupStatements,
  buildRenameVideoGroupStatements,
  buildUpdateVideoGroupTranslationsStatements,
} from '../src/views/videoGroupSidebarUtils.ts'

function createDatabase() {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );
    CREATE TABLE translations (
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      locale TEXT NOT NULL,
      translation TEXT NOT NULL,
      PRIMARY KEY (entity_type, entity_id, locale)
    );
    CREATE TABLE books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      category TEXT
    );
  `)
  return db
}

function createVideoGroupDatabase() {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE video_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      parent_id INTEGER,
      sort_order INTEGER NOT NULL DEFAULT 0,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (parent_id) REFERENCES video_groups(id)
    );
    CREATE TABLE video_group_translations (
      group_id INTEGER NOT NULL,
      locale TEXT NOT NULL,
      translation TEXT NOT NULL,
      PRIMARY KEY (group_id, locale),
      FOREIGN KEY (group_id) REFERENCES video_groups(id) ON DELETE CASCADE
    );
    CREATE TABLE videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      group_id INTEGER,
      FOREIGN KEY (group_id) REFERENCES video_groups(id) ON DELETE SET NULL
    );
  `)
  return db
}

function seedVideoGroupTree(db) {
  const insertGroup = db.prepare(
    'INSERT INTO video_groups (id, name, parent_id, sort_order) VALUES (?, ?, ?, ?)',
  )
  insertGroup.run(1, 'Parent', null, 0)
  insertGroup.run(2, 'Target', 1, 1)
  insertGroup.run(3, 'Child', 2, 2)

  const insertTranslation = db.prepare(
    'INSERT INTO video_group_translations (group_id, locale, translation) VALUES (?, ?, ?)',
  )
  insertTranslation.run(2, 'en-US', 'Target')
  insertTranslation.run(3, 'en-US', 'Child')

  const insertVideo = db.prepare('INSERT INTO videos (id, title, group_id) VALUES (?, ?, ?)')
  insertVideo.run(1, 'Target video', 2)
  insertVideo.run(2, 'Child video', 3)
}

test('runDbTransaction commits every statement and returns run results', () => {
  const db = createDatabase()
  try {
    const results = runDbTransaction(db, [
      { sql: 'INSERT INTO categories (name) VALUES (?)', params: ['Design'] },
      {
        sql: `
          INSERT INTO translations (entity_type, entity_id, locale, translation)
          VALUES ('category', CAST(last_insert_rowid() AS TEXT), ?, ?)
        `,
        params: ['en-US', 'Design'],
      },
    ])

    assert.equal(results.length, 2)
    assert.equal(results[0].changes, 1)
    assert.equal(results[1].changes, 1)
    assert.deepEqual(db.prepare('SELECT id, name FROM categories').all(), [
      { id: 1, name: 'Design' },
    ])
    assert.deepEqual(db.prepare('SELECT * FROM translations').all(), [
      {
        entity_type: 'category',
        entity_id: '1',
        locale: 'en-US',
        translation: 'Design',
      },
    ])
  } finally {
    db.close()
  }
})

test('category migration updates only canonical and uniquely owned aliases', () => {
  const db = createDatabase()
  try {
    db.prepare('INSERT INTO categories (id, name) VALUES (?, ?)').run(1, '技术')
    db.prepare('INSERT INTO categories (id, name) VALUES (?, ?)').run(2, 'Design')
    db.prepare(
      `
        INSERT INTO translations (entity_type, entity_id, locale, translation)
        VALUES ('category', ?, ?, ?)
      `,
    ).run('1', 'en-US', 'Technology')
    db.prepare(
      `
        INSERT INTO translations (entity_type, entity_id, locale, translation)
        VALUES ('category', ?, ?, ?)
      `,
    ).run('1', 'other', 'Design')
    const insertBook = db.prepare('INSERT INTO books (title, category) VALUES (?, ?)')
    insertBook.run('Canonical', '技术')
    insertBook.run('Unique translation', 'Technology')
    insertBook.run('Other shelf', 'Design')

    const aliases = buildCategoryStorageAliasMap(
      db.prepare('SELECT id, name FROM categories').all(),
      db.prepare('SELECT * FROM translations').all(),
    )
    const statements = [
      ...buildBookCategoryMigrationStatements(aliases.get('1') ?? [], 'Engineering'),
      {
        sql: 'UPDATE categories SET name = ? WHERE id = ?',
        params: ['Engineering', 1],
      },
      {
        sql: `
          INSERT OR REPLACE INTO translations (entity_type, entity_id, locale, translation)
          VALUES ('category', ?, ?, ?)
        `,
        params: ['1', 'zh-CN', 'Engineering'],
      },
    ]

    runDbTransaction(db, statements)

    assert.deepEqual(db.prepare('SELECT title, category FROM books ORDER BY id').all(), [
      { title: 'Canonical', category: 'Engineering' },
      { title: 'Unique translation', category: 'Engineering' },
      { title: 'Other shelf', category: 'Design' },
    ])
    assert.equal(db.prepare('SELECT name FROM categories WHERE id = 1').get().name, 'Engineering')
  } finally {
    db.close()
  }
})

test('category migration returns no statements for a blank next name', () => {
  assert.deepEqual(buildBookCategoryMigrationStatements(['技术'], '   '), [])
})

test('runDbTransaction rolls back earlier statements when a later statement fails', () => {
  const db = createDatabase()
  try {
    db.prepare(
      `
        INSERT INTO translations (entity_type, entity_id, locale, translation)
        VALUES ('category', 'existing', 'en-US', 'Existing')
      `,
    ).run()

    assert.throws(
      () =>
        runDbTransaction(db, [
          { sql: 'INSERT INTO categories (name) VALUES (?)', params: ['Rollback'] },
          {
            sql: `
              INSERT INTO translations (entity_type, entity_id, locale, translation)
              VALUES ('category', 'existing', 'en-US', 'Duplicate')
            `,
          },
        ]),
      /UNIQUE constraint failed/,
    )

    assert.equal(
      db.prepare('SELECT COUNT(*) AS count FROM categories WHERE name = ?').get('Rollback').count,
      0,
    )
  } finally {
    db.close()
  }
})

test('create video group statements attach the trimmed locale translation to the inserted group', () => {
  const db = createVideoGroupDatabase()
  try {
    db.prepare('INSERT INTO video_groups (id, name) VALUES (?, ?)').run(1, 'Parent')

    runDbTransaction(db, buildCreateVideoGroupStatements('  AI  ', 1, 'en-US', 4))

    assert.deepEqual(
      db.prepare('SELECT id, name, parent_id, sort_order FROM video_groups ORDER BY id').all(),
      [
        { id: 1, name: 'Parent', parent_id: null, sort_order: 0 },
        { id: 2, name: 'AI', parent_id: 1, sort_order: 4 },
      ],
    )
    assert.deepEqual(db.prepare('SELECT * FROM video_group_translations').all(), [
      { group_id: 2, locale: 'en-US', translation: 'AI' },
    ])
  } finally {
    db.close()
  }
})

test('rename video group statements change canonical and current locale translation together', () => {
  const db = createVideoGroupDatabase()
  try {
    db.prepare('INSERT INTO video_groups (id, name) VALUES (?, ?)').run(2, 'AI')
    db.prepare(
      'INSERT INTO video_group_translations (group_id, locale, translation) VALUES (?, ?, ?)',
    ).run(2, 'en-US', 'AI')

    runDbTransaction(
      db,
      buildRenameVideoGroupStatements(2, '  Artificial Intelligence  ', 'en-US'),
    )

    assert.equal(
      db.prepare('SELECT name FROM video_groups WHERE id = ?').get(2).name,
      'Artificial Intelligence',
    )
    assert.equal(
      db.prepare(
        'SELECT translation FROM video_group_translations WHERE group_id = ? AND locale = ?',
      ).get(2, 'en-US').translation,
      'Artificial Intelligence',
    )
  } finally {
    db.close()
  }
})

test('rename video group statements roll back canonical update when translation write fails', () => {
  const db = createVideoGroupDatabase()
  try {
    db.prepare('INSERT INTO video_groups (id, name) VALUES (?, ?)').run(2, 'AI')
    db.prepare(
      'INSERT INTO video_group_translations (group_id, locale, translation) VALUES (?, ?, ?)',
    ).run(2, 'en-US', 'AI')
    db.exec(`
      CREATE TRIGGER block_video_group_translation_rename
      BEFORE INSERT ON video_group_translations
      WHEN NEW.group_id = 2 AND NEW.locale = 'en-US'
      BEGIN
        SELECT RAISE(ABORT, 'blocked video group translation rename');
      END;
    `)

    assert.throws(
      () =>
        runDbTransaction(
          db,
          buildRenameVideoGroupStatements(2, 'Artificial Intelligence', 'en-US'),
        ),
      /blocked video group translation rename/,
    )

    assert.equal(db.prepare('SELECT name FROM video_groups WHERE id = ?').get(2).name, 'AI')
    assert.equal(
      db.prepare(
        'SELECT translation FROM video_group_translations WHERE group_id = ? AND locale = ?',
      ).get(2, 'en-US').translation,
      'AI',
    )
  } finally {
    db.close()
  }
})

test('update video group translation statements replace nonblank locales and delete blank locales', () => {
  const db = createVideoGroupDatabase()
  try {
    db.prepare('INSERT INTO video_groups (id, name) VALUES (?, ?)').run(2, 'AI')
    const insertTranslation = db.prepare(
      'INSERT INTO video_group_translations (group_id, locale, translation) VALUES (?, ?, ?)',
    )
    insertTranslation.run(2, 'en-US', 'Old AI')
    insertTranslation.run(2, 'ja-JP', 'Old Japanese')

    runDbTransaction(
      db,
      buildUpdateVideoGroupTranslationsStatements(2, {
        'en-US': '  Artificial Intelligence  ',
        'ja-JP': '   ',
        'zh-CN': '  人工智能  ',
      }),
    )

    assert.deepEqual(
      db.prepare('SELECT * FROM video_group_translations ORDER BY locale').all(),
      [
        { group_id: 2, locale: 'en-US', translation: 'Artificial Intelligence' },
        { group_id: 2, locale: 'zh-CN', translation: '人工智能' },
      ],
    )
  } finally {
    db.close()
  }
})

test('translation save rolls back canonical and prior locale writes when a later locale fails', () => {
  const db = createVideoGroupDatabase()
  try {
    db.prepare('INSERT INTO video_groups (id, name) VALUES (?, ?)').run(2, 'AI')
    db.prepare(
      'INSERT INTO video_group_translations (group_id, locale, translation) VALUES (?, ?, ?)',
    ).run(2, 'en-US', 'Old AI')
    db.exec(`
      CREATE TRIGGER block_zh_video_group_translation
      BEFORE INSERT ON video_group_translations
      WHEN NEW.group_id = 2 AND NEW.locale = 'zh-CN'
      BEGIN
        SELECT RAISE(ABORT, 'blocked zh video group translation');
      END;
    `)

    assert.throws(
      () =>
        runDbTransaction(db, [
          {
            sql: 'UPDATE video_groups SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            params: ['Artificial Intelligence', 2],
          },
          ...buildUpdateVideoGroupTranslationsStatements(2, {
            'en-US': 'Artificial Intelligence',
            'zh-CN': '人工智能',
          }),
        ]),
      /blocked zh video group translation/,
    )

    assert.equal(db.prepare('SELECT name FROM video_groups WHERE id = ?').get(2).name, 'AI')
    assert.deepEqual(db.prepare('SELECT * FROM video_group_translations').all(), [
      { group_id: 2, locale: 'en-US', translation: 'Old AI' },
    ])
  } finally {
    db.close()
  }
})

test('delete video group statements atomically detach videos, promote children, and delete the target', () => {
  const db = createVideoGroupDatabase()
  try {
    seedVideoGroupTree(db)

    runDbTransaction(db, buildDeleteVideoGroupStatements(2, 1))

    assert.deepEqual(
      db.prepare('SELECT id, name, parent_id FROM video_groups ORDER BY id').all(),
      [
        { id: 1, name: 'Parent', parent_id: null },
        { id: 3, name: 'Child', parent_id: 1 },
      ],
    )
    assert.deepEqual(db.prepare('SELECT id, title, group_id FROM videos ORDER BY id').all(), [
      { id: 1, title: 'Target video', group_id: null },
      { id: 2, title: 'Child video', group_id: 3 },
    ])
    assert.deepEqual(db.prepare('SELECT * FROM video_group_translations ORDER BY group_id').all(), [
      { group_id: 3, locale: 'en-US', translation: 'Child' },
    ])
  } finally {
    db.close()
  }
})

test('delete video group statements roll back every preceding change when the final delete fails', () => {
  const db = createVideoGroupDatabase()
  try {
    seedVideoGroupTree(db)
    db.exec(`
      CREATE TRIGGER block_target_group_delete
      BEFORE DELETE ON video_groups
      WHEN OLD.id = 2
      BEGIN
        SELECT RAISE(ABORT, 'blocked target group deletion');
      END;
    `)

    assert.throws(
      () => runDbTransaction(db, buildDeleteVideoGroupStatements(2, 1)),
      /blocked target group deletion/,
    )

    assert.deepEqual(
      db.prepare('SELECT id, name, parent_id FROM video_groups ORDER BY id').all(),
      [
        { id: 1, name: 'Parent', parent_id: null },
        { id: 2, name: 'Target', parent_id: 1 },
        { id: 3, name: 'Child', parent_id: 2 },
      ],
    )
    assert.deepEqual(db.prepare('SELECT id, title, group_id FROM videos ORDER BY id').all(), [
      { id: 1, title: 'Target video', group_id: 2 },
      { id: 2, title: 'Child video', group_id: 3 },
    ])
    assert.deepEqual(db.prepare('SELECT * FROM video_group_translations ORDER BY group_id').all(), [
      { group_id: 2, locale: 'en-US', translation: 'Target' },
      { group_id: 3, locale: 'en-US', translation: 'Child' },
    ])
  } finally {
    db.close()
  }
})
