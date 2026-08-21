import type Database from 'better-sqlite3'

const NOTES_FTS_TRIGGER_NAMES = ['notes_ai', 'notes_ad', 'notes_au'] as const

export function ensurePrivateSafeNotesFts(db: Database.Database) {
  const triggerRows = db
    .prepare(
      `SELECT name, sql
       FROM sqlite_master
       WHERE type = 'trigger' AND name IN ('notes_ai', 'notes_ad', 'notes_au')`,
    )
    .all() as Array<{ name: string; sql: string | null }>
  const privacySafe =
    triggerRows.length === NOTES_FTS_TRIGGER_NAMES.length &&
    triggerRows.every((row) => row.sql?.includes('is_private'))

  if (privacySafe) return false

  db.transaction(() => {
    db.exec(`
      DROP TRIGGER IF EXISTS notes_ai;
      DROP TRIGGER IF EXISTS notes_ad;
      DROP TRIGGER IF EXISTS notes_au;
      DROP TABLE IF EXISTS notes_fts;

      CREATE VIRTUAL TABLE notes_fts USING fts5(
        title,
        content,
        content='notes',
        content_rowid='id'
      );

      INSERT INTO notes_fts(rowid, title, content)
      SELECT id, title, content FROM notes WHERE COALESCE(is_private, 0) = 0;

      CREATE TRIGGER notes_ai AFTER INSERT ON notes
      WHEN COALESCE(new.is_private, 0) = 0 BEGIN
        INSERT INTO notes_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
      END;

      CREATE TRIGGER notes_ad AFTER DELETE ON notes
      WHEN COALESCE(old.is_private, 0) = 0 BEGIN
        INSERT INTO notes_fts(notes_fts, rowid, title, content)
        VALUES('delete', old.id, old.title, old.content);
      END;

      CREATE TRIGGER notes_au AFTER UPDATE ON notes BEGIN
        INSERT INTO notes_fts(notes_fts, rowid, title, content)
        SELECT 'delete', old.id, old.title, old.content
        WHERE COALESCE(old.is_private, 0) = 0;
        INSERT INTO notes_fts(rowid, title, content)
        SELECT new.id, new.title, new.content
        WHERE COALESCE(new.is_private, 0) = 0;
      END;
    `)
  })()

  return true
}
