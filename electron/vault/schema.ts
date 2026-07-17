import type Database from 'better-sqlite3'

const VAULT_COLUMN_DEFINITIONS: Record<string, string> = {
  secret_ciphertext: 'TEXT',
  secret_iv: 'TEXT',
  secret_tag: 'TEXT',
  secret_version: 'INTEGER',
  updated_at: 'TEXT DEFAULT CURRENT_TIMESTAMP',
}

export function initializeVaultSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vault (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      website_name TEXT NOT NULL,
      url TEXT,
      username TEXT,
      password_encrypted TEXT NOT NULL DEFAULT '',
      notes_encrypted TEXT,
      iv TEXT NOT NULL DEFAULT '',
      tag TEXT NOT NULL DEFAULT '',
      secret_ciphertext TEXT,
      secret_iv TEXT,
      secret_tag TEXT,
      secret_version INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS vault_meta (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      schema_version INTEGER NOT NULL,
      cipher_version INTEGER NOT NULL,
      kdf_name TEXT NOT NULL,
      kdf_salt TEXT NOT NULL,
      kdf_n INTEGER NOT NULL,
      kdf_r INTEGER NOT NULL,
      kdf_p INTEGER NOT NULL,
      kdf_maxmem INTEGER NOT NULL,
      vault_id TEXT NOT NULL,
      verifier_ciphertext TEXT NOT NULL,
      verifier_iv TEXT NOT NULL,
      verifier_tag TEXT NOT NULL,
      migration_state TEXT NOT NULL CHECK(migration_state IN ('legacy', 'ready', 'failed')),
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `)

  const existingColumns = new Set(
    (db.prepare('PRAGMA table_info(vault)').all() as Array<{ name: string }>).map(
      (column) => column.name,
    ),
  )
  for (const [name, definition] of Object.entries(VAULT_COLUMN_DEFINITIONS)) {
    if (!existingColumns.has(name)) {
      db.exec(`ALTER TABLE vault ADD COLUMN ${name} ${definition}`)
    }
  }
}
