import assert from 'node:assert/strict'
import test from 'node:test'
import Database from 'better-sqlite3'
import { runDbTransaction } from '../electron/db/transaction.ts'
import {
  buildBookCategoryMigrationStatements,
  buildCategoryStorageAliasMap,
} from '../src/views/bookCategorySidebarUtils.ts'

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
