import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import { ensureVideoGroupSchema } from './videoGroupSchema'
import { initializeVaultSchema } from '../vault/schema'
import { initializeAISchema } from '../ai/schema'

const VIDEO_STATUS_CHECK =
  "CHECK(status IN ('unclassified', 'not_downloaded', 'queued', 'downloading', 'downloaded', 'download_failed', 'invalid'))"

const VIDEO_COLUMN_DEFINITIONS: Record<string, string> = {
  id: 'INTEGER PRIMARY KEY AUTOINCREMENT',
  title: 'TEXT NOT NULL',
  url: 'TEXT',
  path: 'TEXT',
  priority: "TEXT CHECK(priority IN ('high', 'mid', 'low')) DEFAULT 'low'",
  duration: 'TEXT',
  source: "TEXT DEFAULT 'local'",
  status: `TEXT ${VIDEO_STATUS_CHECK} DEFAULT 'not_downloaded'`,
  subtitles_path: 'TEXT',
  favorite_time: 'TEXT DEFAULT CURRENT_TIMESTAMP',
  group_id: 'INTEGER',
  source_id: 'TEXT',
  source_cid: 'TEXT',
  source_url: 'TEXT',
  playlist_id: 'TEXT',
  playlist_title: 'TEXT',
  part_index: 'INTEGER',
  thumbnail_url: 'TEXT',
  local_path: 'TEXT',
  selected_quality: "TEXT DEFAULT 'best'",
  parse_status: "TEXT DEFAULT 'ok'",
  diagnostic_message: 'TEXT',
  duration_seconds: 'INTEGER',
  download_progress: 'REAL',
  download_error: 'TEXT',
  invalid_reason: 'TEXT',
  download_batch_id: 'INTEGER',
  download_batch_order: 'INTEGER',
  downloaded_at: 'TEXT',
  created_at: 'TEXT DEFAULT CURRENT_TIMESTAMP',
  updated_at: 'TEXT DEFAULT CURRENT_TIMESTAMP',
}

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
      closed_from_status TEXT,
      due_date TEXT,
      due_time TEXT,
      recur_rule_id INTEGER,
      template_id INTEGER,
      template_version INTEGER,
      instance_key TEXT,
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
      start_date TEXT,
      start_time TEXT DEFAULT '09:00',
      time_slots TEXT,
      template_id INTEGER,
      template_version INTEGER,
      priority TEXT CHECK(priority IN ('high', 'mid', 'low')) DEFAULT 'mid',
      end_condition TEXT,  -- 'never' or 'count:X' or 'date:YYYY-MM-DD'
      missed_policy TEXT DEFAULT 'accumulate', -- 'skip', 'accumulate', 'prompt'
      last_trigger_time TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS recurring_rule_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rule_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      priority TEXT CHECK(priority IN ('high', 'mid', 'low')) DEFAULT 'mid',
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (rule_id) REFERENCES recurring_rules(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS task_templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_key TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT,
      icon TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS task_template_steps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      template_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      priority TEXT CHECK(priority IN ('high', 'mid', 'low')) DEFAULT 'mid',
      sort_order INTEGER DEFAULT 0,
      FOREIGN KEY (template_id) REFERENCES task_templates(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS recurring_rule_occurrence_exceptions (
      recur_rule_id INTEGER NOT NULL,
      instance_key TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (recur_rule_id, instance_key),
      FOREIGN KEY (recur_rule_id) REFERENCES recurring_rules(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS translations (
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      locale TEXT NOT NULL,
      translation TEXT NOT NULL,
      PRIMARY KEY (entity_type, entity_id, locale)
    );

  `)

  try {
    const taskColumns = tasksDb.prepare('PRAGMA table_info(tasks)').all() as { name: string }[]
    const taskColumnNames = new Set(taskColumns.map((column) => column.name))
    if (!taskColumnNames.has('instance_key')) {
      tasksDb.exec('ALTER TABLE tasks ADD COLUMN instance_key TEXT')
    }
    if (!taskColumnNames.has('due_time')) {
      tasksDb.exec('ALTER TABLE tasks ADD COLUMN due_time TEXT')
    }
    if (!taskColumnNames.has('template_id')) {
      tasksDb.exec('ALTER TABLE tasks ADD COLUMN template_id INTEGER')
    }
    if (!taskColumnNames.has('template_version')) {
      tasksDb.exec('ALTER TABLE tasks ADD COLUMN template_version INTEGER')
    }
    if (!taskColumnNames.has('closed_from_status')) {
      tasksDb.exec('ALTER TABLE tasks ADD COLUMN closed_from_status TEXT')
    }

    const ruleColumns = tasksDb.prepare('PRAGMA table_info(recurring_rules)').all() as {
      name: string
    }[]
    const ruleColumnNames = new Set(ruleColumns.map((column) => column.name))
    if (!ruleColumnNames.has('start_date')) {
      tasksDb.exec('ALTER TABLE recurring_rules ADD COLUMN start_date TEXT')
    }
    if (!ruleColumnNames.has('start_time')) {
      tasksDb.exec("ALTER TABLE recurring_rules ADD COLUMN start_time TEXT DEFAULT '09:00'")
    }
    if (!ruleColumnNames.has('priority')) {
      tasksDb.exec("ALTER TABLE recurring_rules ADD COLUMN priority TEXT DEFAULT 'mid'")
    }
    if (!ruleColumnNames.has('time_slots')) {
      tasksDb.exec('ALTER TABLE recurring_rules ADD COLUMN time_slots TEXT')
    }
    if (!ruleColumnNames.has('template_id')) {
      tasksDb.exec('ALTER TABLE recurring_rules ADD COLUMN template_id INTEGER')
    }
    if (!ruleColumnNames.has('template_version')) {
      tasksDb.exec('ALTER TABLE recurring_rules ADD COLUMN template_version INTEGER')
    }

    tasksDb.exec(`
      UPDATE recurring_rules
      SET start_date = COALESCE(start_date, substr(created_at, 1, 10)),
          start_time = COALESCE(start_time, '09:00'),
          priority = COALESCE(priority, 'mid');

      UPDATE tasks
      SET due_time = substr(instance_key, 12, 5)
      WHERE due_time IS NULL AND instance_key GLOB '????-??-??T??:??';

      UPDATE tasks
      SET due_time = due_time || ':00'
      WHERE due_time GLOB '??:??';

      CREATE TABLE IF NOT EXISTS recurring_rule_steps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        rule_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        priority TEXT CHECK(priority IN ('high', 'mid', 'low')) DEFAULT 'mid',
        sort_order INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (rule_id) REFERENCES recurring_rules(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS recurring_rule_occurrence_exceptions (
        recur_rule_id INTEGER NOT NULL,
        instance_key TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (recur_rule_id, instance_key),
        FOREIGN KEY (recur_rule_id) REFERENCES recurring_rules(id) ON DELETE CASCADE
      );

      DROP INDEX IF EXISTS tasks_recur_instance_parent_idx;

      CREATE UNIQUE INDEX tasks_recur_instance_parent_idx
        ON tasks (recur_rule_id, instance_key)
        WHERE recur_rule_id IS NOT NULL AND instance_key IS NOT NULL AND parent_id IS NULL;
    `)
  } catch (err) {
    console.error('Failed to migrate task template schema:', err)
  }

  const tasksTransCount = tasksDb
    .prepare("SELECT count(*) as count FROM translations WHERE entity_type = 'task_status'")
    .get() as { count: number }
  if (tasksTransCount.count === 0) {
    const insertTrans = tasksDb.prepare(
      'INSERT OR REPLACE INTO translations (entity_type, entity_id, locale, translation) VALUES (?, ?, ?, ?)',
    )
    const statusMappings = [
      { id: '待收集', zh: '待收集', en: 'Inbox' },
      { id: '待处理', zh: '待处理', en: 'To Do' },
      { id: '进行中', zh: '进行中', en: 'In Progress' },
      { id: '待验收', zh: '待验收', en: 'Review' },
      { id: '已关闭', zh: '已关闭', en: 'Closed' },
      { id: '已逾期', zh: '已逾期', en: 'Overdue' },
    ]
    for (const mapping of statusMappings) {
      insertTrans.run('task_status', mapping.id, 'zh-CN', mapping.zh)
      insertTrans.run('task_status', mapping.id, 'en-US', mapping.en)
    }
  }
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

    CREATE TABLE IF NOT EXISTS translations (
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      locale TEXT NOT NULL,
      translation TEXT NOT NULL,
      PRIMARY KEY (entity_type, entity_id, locale)
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

  // Seed default translations in notesDb if empty
  try {
    const notesTransCount = notesDb
      .prepare("SELECT count(*) as count FROM translations WHERE entity_type = 'notebook_category'")
      .get() as { count: number }
    if (notesTransCount.count === 0) {
      const insertTrans = notesDb.prepare(
        'INSERT OR REPLACE INTO translations (entity_type, entity_id, locale, translation) VALUES (?, ?, ?, ?)',
      )
      insertTrans.run('notebook_category', '默认', 'zh-CN', '默认')
      insertTrans.run('notebook_category', '默认', 'en-US', 'Default')
    }
  } catch (err) {
    console.error('Failed to seed notebook translations:', err)
  }

  // Seed default notebooks if empty (None seeded per user request)

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

    CREATE TABLE IF NOT EXISTS translations (
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      locale TEXT NOT NULL,
      translation TEXT NOT NULL,
      PRIMARY KEY (entity_type, entity_id, locale)
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

  // Seed default category translations if empty
  try {
    const transCountStmt = booksDb.prepare(
      "SELECT count(*) as count FROM translations WHERE entity_type = 'category'",
    )
    const transResult = transCountStmt.get() as { count: number }
    if (transResult.count === 0) {
      const allCats = booksDb.prepare('SELECT * FROM categories').all() as {
        id: number
        name: string
      }[]
      const defaultMappings = [
        { name: '技术', en: 'Technology', zh: '技术' },
        { name: '设计', en: 'Design', zh: '设计' },
        { name: '商业', en: 'Business', zh: '商业' },
        { name: '待读', en: 'To Read', zh: '待读' },
      ]
      const insertTrans = booksDb.prepare(
        "INSERT OR REPLACE INTO translations (entity_type, entity_id, locale, translation) VALUES ('category', ?, ?, ?)",
      )
      for (const mapping of defaultMappings) {
        const cat = allCats.find((c) => c.name === mapping.name)
        if (cat) {
          insertTrans.run(String(cat.id), 'zh-CN', mapping.zh)
          insertTrans.run(String(cat.id), 'en-US', mapping.en)
        }
      }
      // Also seed Uncategorized
      insertTrans.run('uncategorized', 'zh-CN', '未分类')
      insertTrans.run('uncategorized', 'en-US', 'Uncategorized')
    }
  } catch (err) {
    console.error('Failed to seed category translations:', err)
  }
  booksDb.close()

  // 4. Initialize Videos Database (videos.db)
  const videosDbPath = path.join(userDbDir, 'videos.db')
  const videosDb = new Database(videosDbPath)
  try {
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
        status TEXT ${VIDEO_STATUS_CHECK} DEFAULT 'not_downloaded',
        subtitles_path TEXT,
        favorite_time TEXT DEFAULT CURRENT_TIMESTAMP,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
    `)

    const migrateVideoStatusCheck = () => {
      const createSql = videosDb
        .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'videos'")
        .get() as { sql?: string } | undefined
      if (!createSql?.sql) return
      const hasStatefulStatuses = createSql.sql.includes("'not_downloaded'")
      const hasQueuedStatus = createSql.sql.includes("'queued'")
      if (hasStatefulStatuses && hasQueuedStatus) return

      const currentColumns = videosDb.prepare('PRAGMA table_info(videos)').all() as Array<{
        name: string
      }>
      const columnNames = currentColumns
        .map((column) => column.name)
        .filter((name) => VIDEO_COLUMN_DEFINITIONS[name])
      const columnSql = columnNames
        .map((name) => `${name} ${VIDEO_COLUMN_DEFINITIONS[name]}`)
        .join(',\n')
      const insertColumns = columnNames.join(', ')

      videosDb.exec(`
        PRAGMA foreign_keys = OFF;

        CREATE TABLE videos_new (
          ${columnSql}
        );

        INSERT INTO videos_new (${insertColumns})
        SELECT ${insertColumns}
        FROM videos;

        DROP TABLE videos;
        ALTER TABLE videos_new RENAME TO videos;

        PRAGMA foreign_keys = ON;
      `)
    }

    migrateVideoStatusCheck()

    const videoColumns = videosDb.prepare('PRAGMA table_info(videos)').all() as Array<{
      name: string
    }>
    const videoColumnNames = new Set(videoColumns.map((column) => column.name))
    const addVideoColumn = (name: string, definition: string) => {
      if (!videoColumnNames.has(name)) {
        videosDb.prepare(`ALTER TABLE videos ADD COLUMN ${name} ${definition}`).run()
        videoColumnNames.add(name)
      }
    }

    addVideoColumn('group_id', 'INTEGER')
    addVideoColumn('source_id', 'TEXT')
    addVideoColumn('source_cid', 'TEXT')
    addVideoColumn('source_url', 'TEXT')
    addVideoColumn('playlist_id', 'TEXT')
    addVideoColumn('playlist_title', 'TEXT')
    addVideoColumn('part_index', 'INTEGER')
    addVideoColumn('thumbnail_url', 'TEXT')
    addVideoColumn('local_path', 'TEXT')
    addVideoColumn('selected_quality', "TEXT DEFAULT 'best'")
    addVideoColumn('parse_status', "TEXT DEFAULT 'ok'")
    addVideoColumn('diagnostic_message', 'TEXT')
    addVideoColumn('duration_seconds', 'INTEGER')
    addVideoColumn('download_progress', 'REAL')
    addVideoColumn('download_error', 'TEXT')
    addVideoColumn('invalid_reason', 'TEXT')
    addVideoColumn('download_batch_id', 'INTEGER')
    addVideoColumn('download_batch_order', 'INTEGER')
    addVideoColumn('downloaded_at', 'TEXT')
    addVideoColumn('created_at', 'TEXT DEFAULT CURRENT_TIMESTAMP')
    addVideoColumn('updated_at', 'TEXT DEFAULT CURRENT_TIMESTAMP')

    videosDb.exec(`
      CREATE TABLE IF NOT EXISTS video_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        parent_id INTEGER,
        sort_order INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS video_tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        color TEXT DEFAULT '#64748b',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS video_tag_links (
        video_id INTEGER NOT NULL,
        tag_id INTEGER NOT NULL,
        PRIMARY KEY (video_id, tag_id),
        FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES video_tags(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS video_download_batches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_key TEXT NOT NULL UNIQUE,
        source_url TEXT,
        source TEXT DEFAULT 'other',
        title TEXT,
        item_count INTEGER DEFAULT 0,
        status TEXT DEFAULT 'downloading',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS douyin_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        remote_user_id TEXT,
        display_name TEXT,
        session_partition TEXT NOT NULL UNIQUE,
        auth_status TEXT NOT NULL DEFAULT 'logged_out'
          CHECK(auth_status IN ('logged_out', 'syncing', 'authenticated', 'expired', 'error')),
        ever_sync_finished INTEGER NOT NULL DEFAULT 0,
        last_sync_at TEXT,
        diagnostic_message TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS douyin_favorite_folders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL,
        remote_id TEXT NOT NULL,
        title TEXT NOT NULL,
        item_count INTEGER NOT NULL DEFAULT 0,
        sync_status TEXT NOT NULL DEFAULT 'idle'
          CHECK(sync_status IN ('idle', 'syncing', 'synced', 'failed')),
        last_sync_at TEXT,
        incremental_capability TEXT NOT NULL DEFAULT 'unknown'
          CHECK(incremental_capability IN ('unknown', 'available', 'unavailable')),
        last_incremental_added_at TEXT,
        last_incremental_remote_id TEXT,
        last_sync_complete INTEGER NOT NULL DEFAULT 1,
        last_sync_stop_reason TEXT,
        diagnostic_message TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(account_id, remote_id),
        FOREIGN KEY(account_id) REFERENCES douyin_accounts(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS douyin_favorite_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL,
        remote_id TEXT NOT NULL,
        title TEXT NOT NULL,
        author_id TEXT,
        author_name TEXT,
        source_url TEXT NOT NULL,
        thumbnail_url TEXT,
        duration_seconds INTEGER,
        collected_at TEXT,
        favorite_added_at TEXT,
        availability TEXT NOT NULL DEFAULT 'available'
          CHECK(availability IN ('available', 'unavailable')),
        download_status TEXT NOT NULL DEFAULT 'not_downloaded'
          CHECK(download_status IN ('not_downloaded', 'downloading', 'downloaded', 'failed')),
        download_progress REAL NOT NULL DEFAULT 0,
        local_path TEXT,
        download_error TEXT,
        last_seen_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(account_id, remote_id),
        FOREIGN KEY(account_id) REFERENCES douyin_accounts(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS douyin_folder_items (
        folder_id INTEGER NOT NULL,
        item_id INTEGER NOT NULL,
        position INTEGER NOT NULL DEFAULT 0,
        last_seen_at TEXT,
        PRIMARY KEY(folder_id, item_id),
        FOREIGN KEY(folder_id) REFERENCES douyin_favorite_folders(id) ON DELETE CASCADE,
        FOREIGN KEY(item_id) REFERENCES douyin_favorite_items(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS douyin_favorite_folders_account_title_index
        ON douyin_favorite_folders(account_id, title);
      CREATE INDEX IF NOT EXISTS douyin_favorite_items_account_collected_index
        ON douyin_favorite_items(account_id, collected_at DESC);
      CREATE INDEX IF NOT EXISTS douyin_folder_items_folder_position_index
        ON douyin_folder_items(folder_id, position);
    `)

    const addDouyinColumn = (table: string, column: string, definition: string) => {
      const columns = videosDb.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>
      if (!columns.some((entry) => entry.name === column)) {
        videosDb.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
      }
    }
    addDouyinColumn('douyin_favorite_folders', 'incremental_capability', "TEXT NOT NULL DEFAULT 'unknown'")
    addDouyinColumn('douyin_favorite_folders', 'last_incremental_added_at', 'TEXT')
    addDouyinColumn('douyin_favorite_folders', 'last_incremental_remote_id', 'TEXT')
    addDouyinColumn('douyin_favorite_folders', 'last_sync_complete', 'INTEGER NOT NULL DEFAULT 1')
    addDouyinColumn('douyin_favorite_folders', 'last_sync_stop_reason', 'TEXT')
    addDouyinColumn('douyin_favorite_items', 'favorite_added_at', 'TEXT')
    addDouyinColumn('douyin_accounts', 'ever_sync_finished', 'INTEGER NOT NULL DEFAULT 0')
    addDouyinColumn('douyin_favorite_items', 'download_status', "TEXT NOT NULL DEFAULT 'not_downloaded'")
    addDouyinColumn('douyin_favorite_items', 'download_progress', 'REAL NOT NULL DEFAULT 0')
    addDouyinColumn('douyin_favorite_items', 'local_path', 'TEXT')
    addDouyinColumn('douyin_favorite_items', 'download_error', 'TEXT')

    ensureVideoGroupSchema(videosDb)

    try {
      videosDb
        .prepare(
          `
          UPDATE videos
          SET status = 'not_downloaded'
          WHERE status IS NULL OR status = 'unclassified'
          `,
        )
        .run()
      videosDb
        .prepare(
          `
          UPDATE videos
          SET status = 'download_failed',
              download_error = COALESCE(download_error, 'Download was interrupted. Retry is available.'),
              diagnostic_message = COALESCE(diagnostic_message, 'Download was interrupted. Retry is available.')
          WHERE status IN ('queued', 'downloading')
          `,
        )
        .run()
    } catch (error) {
      console.error('Failed to normalize legacy video statuses:', error)
    }
  } finally {
    videosDb.close()
  }

  // 5. Initialize Vault Database (vault.db)
  const vaultDbPath = path.join(userDbDir, 'vault.db')
  const vaultDb = new Database(vaultDbPath)
  vaultDb.pragma('journal_mode = WAL')

  initializeVaultSchema(vaultDb)
  vaultDb.close()

  // 6. Initialize AI Database (ai.db)
  const aiDbPath = path.join(userDbDir, 'ai.db')
  const aiDb = new Database(aiDbPath)
  try {
    aiDb.pragma('journal_mode = WAL')
    initializeAISchema(aiDb)
  } finally {
    aiDb.close()
  }
}
