import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

export function initializeUserDatabase(userDbDir: string) {
  // Ensure database directory exists
  if (!fs.existsSync(userDbDir)) {
    fs.mkdirSync(userDbDir, { recursive: true })
  }

  // 1. Initialize Tasks Database (tasks.db)
  const tasksDbPath = path.join(userDbDir, 'tasks.db')
  const tasksDb = new Database(tasksDbPath)
  tasksDb.pragma('journal_mode = WAL')

  tasksDb.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      priority TEXT CHECK(priority IN ('high', 'mid', 'low')) DEFAULT 'mid',
      status TEXT NOT NULL DEFAULT '待收集',
      due_date TEXT,
      recur_rule_id INTEGER,
      parent_id INTEGER,
      progress INTEGER DEFAULT 0,
      associated_note_id INTEGER,
      is_completed INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS recurring_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      frequency TEXT CHECK(frequency IN ('daily', 'weekday', 'weekly', 'monthly', 'yearly', 'custom', 'cron')) DEFAULT 'daily',
      interval INTEGER DEFAULT 1,
      week_days TEXT,     -- e.g., '1,3,5' for Mon, Wed, Fri
      month_days TEXT,    -- e.g., '1,15,-1' for 1st, 15th, last day
      cron TEXT,          -- standard cron string
      end_condition TEXT,  -- 'never' or 'count:X' or 'date:YYYY-MM-DD'
      missed_policy TEXT DEFAULT 'accumulate', -- 'skip', 'accumulate', 'prompt'
      last_trigger_time TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `)
  tasksDb.close()

  // 2. Initialize Notes Database (notes.db)
  const notesDbPath = path.join(userDbDir, 'notes.db')
  const notesDb = new Database(notesDbPath)
  notesDb.pragma('journal_mode = WAL')

  notesDb.exec(`
    CREATE TABLE IF NOT EXISTS notebooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      category TEXT DEFAULT '默认',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT DEFAULT '',
      notebook TEXT DEFAULT '未分类',
      note_type TEXT DEFAULT 'markdown', -- 'markdown', 'richtext', 'canvas', 'code', 'table'
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS backlinks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id INTEGER NOT NULL,
      target_id INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (source_id) REFERENCES notes(id) ON DELETE CASCADE,
      FOREIGN KEY (target_id) REFERENCES notes(id) ON DELETE CASCADE
    );

    -- Full Text Search FTS5 Table
    CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
      title,
      content,
      content='notes',
      content_rowid='id'
    );

    -- FTS Triggers to keep index in sync
    CREATE TRIGGER IF NOT EXISTS notes_ai AFTER INSERT ON notes BEGIN
      INSERT INTO notes_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
    END;
    
    CREATE TRIGGER IF NOT EXISTS notes_ad AFTER DELETE ON notes BEGIN
      INSERT INTO notes_fts(notes_fts, rowid, title, content) VALUES('delete', old.id, old.title, old.content);
    END;
    
    CREATE TRIGGER IF NOT EXISTS notes_au AFTER UPDATE ON notes BEGIN
      INSERT INTO notes_fts(notes_fts, rowid, title, content) VALUES('delete', old.id, old.title, old.content);
      INSERT INTO notes_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
    END;
  `)

  // Migrate existing notes table if notebook column is missing
  try {
    const pragma = notesDb.prepare('PRAGMA table_info(notes)').all() as { name: string }[]
    const hasNotebook = pragma.some((col) => col.name === 'notebook')
    if (!hasNotebook) {
      notesDb.exec("ALTER TABLE notes ADD COLUMN notebook TEXT DEFAULT '未分类'")
    }
  } catch (err) {
    console.error('Failed to migrate notes table (notebook column):', err)
  }

  // Migrate notebooks table if category column is missing
  try {
    const pragmaNb = notesDb.prepare('PRAGMA table_info(notebooks)').all() as { name: string }[]
    const hasCategory = pragmaNb.some((col) => col.name === 'category')
    if (!hasCategory) {
      notesDb.exec("ALTER TABLE notebooks ADD COLUMN category TEXT DEFAULT '默认'")
    }
  } catch (err) {
    console.error('Failed to migrate notebooks table (category column):', err)
  }

  // Seed default notebooks if empty
  try {
    const nbCountStmt = notesDb.prepare('SELECT count(*) as count FROM notebooks')
    const nbCountResult = nbCountStmt.get() as { count: number }
    if (nbCountResult.count === 0) {
      const insertNb = notesDb.prepare('INSERT INTO notebooks (name, category) VALUES (?, ?)')
      insertNb.run('LifeOS', '生活')
      insertNb.run('产品设计', '工作')
      insertNb.run('技术架构', '工作')
      insertNb.run('Reading', '阅读')
    }
  } catch (err) {
    console.error('Failed to seed default notebooks:', err)
  }

  notesDb.close()

  // 3. Initialize Books Database (books.db)
  const booksDbPath = path.join(userDbDir, 'books.db')
  const booksDb = new Database(booksDbPath)
  booksDb.pragma('journal_mode = WAL')

  booksDb.exec(`
    CREATE TABLE IF NOT EXISTS books (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      author TEXT,
      path TEXT NOT NULL,
      cover TEXT,
      category TEXT DEFAULT '未分类',
      progress REAL DEFAULT 0.0,
      status TEXT CHECK(status IN ('want', 'reading', 'read')) DEFAULT 'want',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS highlights (
      id TEXT PRIMARY KEY, -- UUID/unique string from reader
      book_id INTEGER NOT NULL,
      text TEXT NOT NULL,
      annotation TEXT,
      anchor TEXT NOT NULL, -- JSON location info for PDF/EPUB js
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      sort_order INTEGER DEFAULT 0
    );
  `)

  // Seed default book categories if empty
  const countStmt = booksDb.prepare('SELECT count(*) as count FROM categories')
  const result = countStmt.get() as { count: number }
  if (result.count === 0) {
    const insertCat = booksDb.prepare('INSERT INTO categories (name, sort_order) VALUES (?, ?)')
    insertCat.run('技术', 1)
    insertCat.run('设计', 2)
    insertCat.run('商业', 3)
    insertCat.run('待读', 4)
  }
  booksDb.close()

  // 4. Initialize Videos Database (videos.db)
  const videosDbPath = path.join(userDbDir, 'videos.db')
  const videosDb = new Database(videosDbPath)
  videosDb.pragma('journal_mode = WAL')

  videosDb.exec(`
    CREATE TABLE IF NOT EXISTS videos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      url TEXT,
      path TEXT,
      priority TEXT CHECK(priority IN ('high', 'mid', 'low')) DEFAULT 'low',
      duration TEXT,
      source TEXT DEFAULT 'local', -- 'bilibili', 'youtube', 'local', etc.
      status TEXT CHECK(status IN ('unclassified', 'downloading', 'downloaded')) DEFAULT 'unclassified',
      subtitles_path TEXT,
      favorite_time TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `)
  videosDb.close()

  // 5. Initialize Vault Database (vault.db)
  const vaultDbPath = path.join(userDbDir, 'vault.db')
  const vaultDb = new Database(vaultDbPath)
  vaultDb.pragma('journal_mode = WAL')

  vaultDb.exec(`
    CREATE TABLE IF NOT EXISTS vault (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      website_name TEXT NOT NULL,
      url TEXT,
      username TEXT,
      password_encrypted TEXT NOT NULL,
      notes_encrypted TEXT,
      iv TEXT NOT NULL,
      tag TEXT NOT NULL, -- AES GCM auth tag
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `)
  vaultDb.close()
}
