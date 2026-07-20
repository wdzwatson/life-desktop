import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { AI_SCHEMA_VERSION, DEFAULT_MODEL_CATALOG, initializeAISchema } from '../electron/ai/schema.ts'
import { initializeUserDatabase } from '../electron/db/schema.ts'

const EXPECTED_TABLES = [
  'ai_schema_meta',
  'ai_providers',
  'ai_mcp_servers',
  'ai_agents',
  'ai_agent_mcp_links',
  'ai_conversations',
  'ai_messages',
  'ai_conversation_events',
  'ai_media_assets',
  'ai_message_parts',
  'ai_runs',
  'ai_tool_calls',
]

function createProvider(db, name, defaults = {}) {
  return Number(
    db
      .prepare(
        `
        INSERT INTO ai_providers (
          name, protocol, base_url, capabilities_json, text_model,
          is_default_text, is_default_image, is_default_video
        ) VALUES (?, 'openai_compatible', 'https://api.example.test/v1', '["text"]', 'model', ?, ?, ?)
        `,
      )
      .run(
        name,
        defaults.text ? 1 : 0,
        defaults.image ? 1 : 0,
        defaults.video ? 1 : 0,
      ).lastInsertRowid,
  )
}

function expectedCatalogRows() {
  return [...DEFAULT_MODEL_CATALOG]
    .map((model) => ({
      name: model.name,
      category: model.category,
      capabilities_json: JSON.stringify(model.capabilities),
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
}

test('AI schema creates the complete isolated database with required indexes', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lifeos-ai-schema-'))
  initializeUserDatabase(dir)

  const db = new Database(path.join(dir, 'ai.db'))
  db.pragma('foreign_keys = ON')
  const tableNames = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((row) => row.name)
  for (const tableName of EXPECTED_TABLES) {
    assert.ok(tableNames.includes(tableName), `missing ${tableName}`)
  }
  assert.equal(
    db.prepare('SELECT schema_version FROM ai_schema_meta WHERE id = 1').get().schema_version,
    AI_SCHEMA_VERSION,
  )
  for (const indexName of [
    'ai_providers_default_text_unique',
    'ai_providers_default_image_unique',
    'ai_providers_default_video_unique',
    'ai_agents_default_unique',
    'ai_conversations_recent_idx',
    'ai_conversation_events_conversation_idx',
    'ai_conversation_events_anchor_unique',
    'ai_runs_status_idx',
    'ai_media_assets_run_idx',
  ]) {
    assert.ok(
      db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ?").get(indexName),
      `missing ${indexName}`,
    )
  }
  assert.deepEqual(
    db.prepare('SELECT name, category, capabilities_json FROM ai_model_catalog ORDER BY name COLLATE NOCASE').all(),
    expectedCatalogRows(),
  )
  assert.ok(db.prepare('PRAGMA table_info(ai_providers)').all().some((column) => column.name === 'request_body_json'))
  db.close()
})

test('AI schema migrates version 1 media assets with recoverable run linkage', () => {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE ai_schema_meta (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      schema_version INTEGER NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO ai_schema_meta (id, schema_version) VALUES (1, 1);
    CREATE TABLE ai_media_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_id INTEGER,
      media_type TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      local_path TEXT,
      source_url_redacted TEXT,
      provider_task_id TEXT,
      original_name TEXT,
      byte_size INTEGER,
      width INTEGER,
      height INTEGER,
      duration_seconds REAL,
      sha256 TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      error_code TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_accessed_at TEXT
    );
    INSERT INTO ai_media_assets (media_type, mime_type, provider_task_id, status)
    VALUES ('video', 'video/mp4', 'legacy-task', 'polling');
  `)
  initializeAISchema(db)
  const columns = db.prepare('PRAGMA table_info(ai_media_assets)').all().map((row) => row.name)
  assert.ok(columns.includes('run_id'))
  assert.ok(columns.includes('assistant_message_id'))
  assert.equal(db.prepare('SELECT provider_task_id, status FROM ai_media_assets').get().provider_task_id, 'legacy-task')
  assert.equal(db.prepare('SELECT schema_version FROM ai_schema_meta WHERE id = 1').get().schema_version, AI_SCHEMA_VERSION)
  db.close()
})

test('AI schema migrates version 2 providers into text model catalogs', () => {
  const db = new Database(':memory:')
  initializeAISchema(db)
  const providerId = createProvider(db, 'Legacy provider')
  db.prepare(
    `
    INSERT INTO ai_agents (
      name, text_provider_id, model_params_json, context_json,
      allowed_tools_json, blocked_tools_json
    ) VALUES ('Legacy agent', ?, '{}', '{}', '[]', '[]')
    `,
  ).run(providerId)
  db.exec('ALTER TABLE ai_providers DROP COLUMN text_models_json')
  db.exec('ALTER TABLE ai_agents DROP COLUMN text_model')
  db.prepare('UPDATE ai_schema_meta SET schema_version = 2 WHERE id = 1').run()

  initializeAISchema(db)

  assert.equal(db.prepare('SELECT text_models_json FROM ai_providers WHERE id = ?').get(providerId).text_models_json, '["model"]')
  assert.equal(db.prepare('SELECT text_model FROM ai_agents WHERE name = ?').get('Legacy agent').text_model, null)
  db.close()
})

test('AI schema migrates version 3 before creating the managed model index', () => {
  const db = new Database(':memory:')
  initializeAISchema(db)
  db.exec('DROP INDEX ai_agents_managed_model_unique')
  db.exec('ALTER TABLE ai_agents DROP COLUMN managed_model_key')
  db.prepare('UPDATE ai_schema_meta SET schema_version = 3 WHERE id = 1').run()

  initializeAISchema(db)

  const columns = db.prepare('PRAGMA table_info(ai_agents)').all().map((row) => row.name)
  assert.ok(columns.includes('managed_model_key'))
  assert.ok(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'ai_agents_managed_model_unique'",
  ).get())
  assert.equal(db.prepare('SELECT schema_version FROM ai_schema_meta WHERE id = 1').get().schema_version, AI_SCHEMA_VERSION)
  db.close()
})

test('AI schema migrates version 4 media models into multi-select catalogs', () => {
  const db = new Database(':memory:')
  initializeAISchema(db)
  const providerId = createProvider(db, 'Legacy media')
  db.prepare("UPDATE ai_providers SET image_model = 'image-1', video_model = 'video-1' WHERE id = ?").run(providerId)
  db.exec('ALTER TABLE ai_providers DROP COLUMN image_models_json')
  db.exec('ALTER TABLE ai_providers DROP COLUMN video_models_json')
  db.exec('DROP TABLE ai_model_catalog')
  db.prepare('UPDATE ai_schema_meta SET schema_version = 4 WHERE id = 1').run()

  initializeAISchema(db)

  const provider = db.prepare('SELECT image_models_json, video_models_json FROM ai_providers WHERE id = ?').get(providerId)
  assert.equal(provider.image_models_json, '["image-1"]')
  assert.equal(provider.video_models_json, '["video-1"]')
  assert.deepEqual(
    db.prepare('SELECT name, category, capabilities_json FROM ai_model_catalog ORDER BY name COLLATE NOCASE').all(),
    expectedCatalogRows(),
  )
  db.close()
})

test('AI schema migrates version 5 catalog rows into composite capabilities', () => {
  const db = new Database(':memory:')
  initializeAISchema(db)
  db.exec(`
    DROP TABLE ai_model_catalog;
    CREATE TABLE ai_model_catalog (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL COLLATE NOCASE,
      capability TEXT NOT NULL CHECK(capability IN ('text', 'image', 'video')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(name, capability)
    );
    INSERT INTO ai_model_catalog (name, capability) VALUES
      ('omni-model', 'text'), ('omni-model', 'image'), ('video-model', 'video');
  `)
  db.prepare('UPDATE ai_schema_meta SET schema_version = 5 WHERE id = 1').run()

  initializeAISchema(db)

  assert.deepEqual(
    db.prepare('SELECT name, category, capabilities_json FROM ai_model_catalog ORDER BY name COLLATE NOCASE').all(),
    expectedCatalogRows(),
  )
  assert.equal(db.prepare('SELECT schema_version FROM ai_schema_meta WHERE id = 1').get().schema_version, AI_SCHEMA_VERSION)
  db.close()
})

test('AI schema clears existing catalog rows and seeds the curated model list', () => {
  const db = new Database(':memory:')
  initializeAISchema(db)
  db.prepare(`
    UPDATE ai_model_catalog
    SET category = 'other', capabilities_json = '["video"]'
    WHERE name = 'gpt-5.4'
  `).run()
  db.prepare(`
    INSERT INTO ai_model_catalog (name, category, capabilities_json)
    VALUES ('custom-model', 'other', '["text"]')
  `).run()
  db.prepare('UPDATE ai_schema_meta SET schema_version = 11 WHERE id = 1').run()

  initializeAISchema(db)

  assert.deepEqual(
    db.prepare('SELECT name, category, capabilities_json FROM ai_model_catalog ORDER BY name COLLATE NOCASE').all(),
    expectedCatalogRows(),
  )
  db.close()
})

test('AI schema initialization is idempotent and preserves existing rows', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lifeos-ai-schema-idempotent-'))
  initializeUserDatabase(dir)
  const dbPath = path.join(dir, 'ai.db')
  const firstDb = new Database(dbPath)
  firstDb.pragma('foreign_keys = ON')
  const providerId = createProvider(firstDb, 'Primary')
  firstDb
    .prepare(
      `
      INSERT INTO ai_agents (
        name, text_provider_id, model_params_json, context_json,
        allowed_tools_json, blocked_tools_json
      ) VALUES ('Assistant', ?, '{}', '{}', '[]', '[]')
      `,
    )
    .run(providerId)
  firstDb.close()

  initializeUserDatabase(dir)
  initializeUserDatabase(dir)

  const reopened = new Database(dbPath)
  assert.equal(reopened.prepare('SELECT COUNT(*) AS count FROM ai_providers').get().count, 1)
  assert.equal(reopened.prepare('SELECT COUNT(*) AS count FROM ai_agents').get().count, 1)
  assert.equal(
    reopened.prepare('SELECT schema_version FROM ai_schema_meta WHERE id = 1').get().schema_version,
    AI_SCHEMA_VERSION,
  )
  reopened.close()
})

test('AI schema enforces default provider uniqueness, foreign keys, and state checks', () => {
  const db = new Database(':memory:')
  initializeAISchema(db)
  const firstProvider = createProvider(db, 'Primary', { text: true })
  assert.throws(() => createProvider(db, 'Second default', { text: true }), /UNIQUE constraint failed/i)
  const secondProvider = createProvider(db, 'Secondary')

  db.prepare(
    `
    INSERT INTO ai_agents (
      name, text_provider_id, model_params_json, context_json,
      allowed_tools_json, blocked_tools_json, is_default
    ) VALUES ('Default agent', ?, '{}', '{}', '[]', '[]', 1)
    `,
  ).run(firstProvider)
  assert.throws(
    () =>
      db
        .prepare(
          `
          INSERT INTO ai_agents (
            name, text_provider_id, model_params_json, context_json,
            allowed_tools_json, blocked_tools_json, is_default
          ) VALUES ('Second default agent', ?, '{}', '{}', '[]', '[]', 1)
          `,
        )
        .run(secondProvider),
    /UNIQUE constraint failed/i,
  )
  assert.throws(() => db.prepare('DELETE FROM ai_providers WHERE id = ?').run(firstProvider), /FOREIGN KEY constraint failed/i)
  assert.throws(
    () =>
      db
        .prepare(
          "INSERT INTO ai_messages (conversation_id, role, status) VALUES (999, 'invalid', 'completed')",
        )
        .run(),
    /CHECK constraint failed|FOREIGN KEY constraint failed/i,
  )
  db.close()
})

test('AI message parts keep stable order and cascade with their conversation', () => {
  const db = new Database(':memory:')
  initializeAISchema(db)
  const providerId = createProvider(db, 'Provider')
  const agentId = Number(
    db
      .prepare(
        `
        INSERT INTO ai_agents (
          name, text_provider_id, model_params_json, context_json,
          allowed_tools_json, blocked_tools_json
        ) VALUES ('Agent', ?, '{}', '{}', '[]', '[]')
        `,
      )
      .run(providerId).lastInsertRowid,
  )
  const conversationId = Number(
    db
      .prepare(
        "INSERT INTO ai_conversations (title, agent_id, agent_snapshot_json) VALUES ('Chat', ?, '{}')",
      )
      .run(agentId).lastInsertRowid,
  )
  const messageId = Number(
    db
      .prepare("INSERT INTO ai_messages (conversation_id, role) VALUES (?, 'user')")
      .run(conversationId).lastInsertRowid,
  )
  db.prepare(
    "INSERT INTO ai_message_parts (message_id, position, content_type, text_content) VALUES (?, 0, 'text', 'Hello')",
  ).run(messageId)
  assert.throws(
    () =>
      db
        .prepare(
          "INSERT INTO ai_message_parts (message_id, position, content_type, text_content) VALUES (?, 0, 'text', 'Duplicate')",
        )
        .run(messageId),
    /UNIQUE constraint failed/i,
  )
  db.prepare('DELETE FROM ai_conversations WHERE id = ?').run(conversationId)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM ai_messages').get().count, 0)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM ai_message_parts').get().count, 0)
  db.close()
})

test('unsupported AI schema versions fail without creating current tables', () => {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE ai_schema_meta (
      id INTEGER PRIMARY KEY CHECK(id = 1),
      schema_version INTEGER NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO ai_schema_meta (id, schema_version) VALUES (1, 99);
  `)
  assert.throws(() => initializeAISchema(db), /Unsupported AI schema version: 99/)
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'ai_providers'").get().count,
    0,
  )
  assert.equal(db.prepare('SELECT schema_version FROM ai_schema_meta WHERE id = 1').get().schema_version, 99)
  db.close()
})
