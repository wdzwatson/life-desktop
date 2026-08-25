import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { deleteVideoRecords } from '../electron/video/deleteRecords.ts'

function createContext() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeos-video-delete-'))
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE videos (
      id INTEGER PRIMARY KEY,
      local_path TEXT,
      path TEXT
    )
  `)
  return {
    db,
    directory,
    close() {
      db.close()
      fs.rmSync(directory, { recursive: true, force: true })
    },
  }
}

test('deleting video records keeps local files when file deletion is not selected', () => {
  const context = createContext()
  try {
    const filePath = path.join(context.directory, 'kept.mp4')
    fs.writeFileSync(filePath, 'video')
    context.db.prepare('INSERT INTO videos (id, local_path) VALUES (?, ?)').run(1, filePath)

    const result = deleteVideoRecords(context.db, {
      videoIds: [1],
      deleteLocalFiles: false,
      videoDirectory: context.directory,
    })

    assert.equal(result.deletedRecordCount, 1)
    assert.equal(result.deletedFileCount, 0)
    assert.equal(fs.existsSync(filePath), true)
  } finally {
    context.close()
  }
})

test('deleting video records removes existing files and skips missing files', () => {
  const context = createContext()
  try {
    const existingPath = path.join(context.directory, 'existing.mp4')
    const missingPath = path.join(context.directory, 'missing.mp4')
    fs.writeFileSync(existingPath, 'video')
    context.db.prepare('INSERT INTO videos (id, local_path) VALUES (?, ?)').run(1, existingPath)
    context.db.prepare('INSERT INTO videos (id, path) VALUES (?, ?)').run(2, missingPath)

    const result = deleteVideoRecords(context.db, {
      videoIds: [1, 2],
      deleteLocalFiles: true,
      videoDirectory: context.directory,
    })

    assert.deepEqual(result, {
      deletedRecordCount: 2,
      deletedFileCount: 1,
      missingFileCount: 1,
      retainedSharedFileCount: 0,
    })
    assert.equal(fs.existsSync(existingPath), false)
  } finally {
    context.close()
  }
})

test('file deletion keeps paths that are still referenced by another video record', () => {
  const context = createContext()
  try {
    const sharedPath = path.join(context.directory, 'shared.mp4')
    fs.writeFileSync(sharedPath, 'video')
    const insert = context.db.prepare('INSERT INTO videos (id, local_path) VALUES (?, ?)')
    insert.run(1, sharedPath)
    insert.run(2, sharedPath)

    const result = deleteVideoRecords(context.db, {
      videoIds: [1],
      deleteLocalFiles: true,
      videoDirectory: context.directory,
    })

    assert.equal(result.deletedRecordCount, 1)
    assert.equal(result.retainedSharedFileCount, 1)
    assert.equal(fs.existsSync(sharedPath), true)
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM videos').get().count, 1)
  } finally {
    context.close()
  }
})

test('file deletion rejects paths outside the configured video directory', () => {
  const context = createContext()
  const outsideDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeos-video-outside-'))
  try {
    const outsidePath = path.join(outsideDirectory, 'outside.mp4')
    fs.writeFileSync(outsidePath, 'video')
    context.db.prepare('INSERT INTO videos (id, local_path) VALUES (?, ?)').run(1, outsidePath)

    assert.throws(
      () =>
        deleteVideoRecords(context.db, {
          videoIds: [1],
          deleteLocalFiles: true,
          videoDirectory: context.directory,
        }),
      /outside the video directory/,
    )
    assert.equal(fs.existsSync(outsidePath), true)
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM videos').get().count, 1)
  } finally {
    context.close()
    fs.rmSync(outsideDirectory, { recursive: true, force: true })
  }
})
