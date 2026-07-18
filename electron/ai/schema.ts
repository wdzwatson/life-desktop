import type Database from 'better-sqlite3'

export const AI_SCHEMA_VERSION = 3

function hasColumn(db: Database.Database, table: string, column: string) {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
    .some((item) => item.name === column)
}

function createSchemaObjects(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ai_providers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      protocol TEXT NOT NULL CHECK(protocol IN ('openai_compatible', 'xai', 'custom_http')),
      base_url TEXT NOT NULL,
      credential_ref TEXT,
      default_headers_json TEXT NOT NULL DEFAULT '{}',
      capabilities_json TEXT NOT NULL DEFAULT '[]',
      text_model TEXT,
      text_models_json TEXT NOT NULL DEFAULT '[]',
      image_model TEXT,
      video_model TEXT,
      timeout_ms INTEGER NOT NULL DEFAULT 60000 CHECK(timeout_ms BETWEEN 1000 AND 600000),
      allow_local_network INTEGER NOT NULL DEFAULT 0 CHECK(allow_local_network IN (0, 1)),
      enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
      is_default_text INTEGER NOT NULL DEFAULT 0 CHECK(is_default_text IN (0, 1)),
      is_default_image INTEGER NOT NULL DEFAULT 0 CHECK(is_default_image IN (0, 1)),
      is_default_video INTEGER NOT NULL DEFAULT 0 CHECK(is_default_video IN (0, 1)),
      connection_status TEXT NOT NULL DEFAULT 'untested'
        CHECK(connection_status IN ('untested', 'testing', 'connected', 'failed')),
      last_tested_at TEXT,
      last_success_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE UNIQUE INDEX IF NOT EXISTS ai_providers_default_text_unique
      ON ai_providers(is_default_text) WHERE is_default_text = 1;
    CREATE UNIQUE INDEX IF NOT EXISTS ai_providers_default_image_unique
      ON ai_providers(is_default_image) WHERE is_default_image = 1;
    CREATE UNIQUE INDEX IF NOT EXISTS ai_providers_default_video_unique
      ON ai_providers(is_default_video) WHERE is_default_video = 1;
    CREATE INDEX IF NOT EXISTS ai_providers_enabled_idx ON ai_providers(enabled, name);

    CREATE TABLE IF NOT EXISTS ai_mcp_servers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      transport TEXT NOT NULL CHECK(transport IN ('streamable_http', 'sse', 'stdio')),
      connection_json TEXT NOT NULL,
      credential_ref TEXT,
      risk_overrides_json TEXT NOT NULL DEFAULT '{}',
      timeout_ms INTEGER NOT NULL DEFAULT 30000 CHECK(timeout_ms BETWEEN 1000 AND 600000),
      enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
      connection_status TEXT NOT NULL DEFAULT 'disconnected'
        CHECK(connection_status IN ('disconnected', 'connecting', 'connected', 'failed')),
      protocol_version TEXT,
      tool_count INTEGER NOT NULL DEFAULT 0 CHECK(tool_count >= 0),
      last_connected_at TEXT,
      last_error_code TEXT,
      last_error_message TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS ai_mcp_servers_enabled_idx ON ai_mcp_servers(enabled, name);

    CREATE TABLE IF NOT EXISTS ai_agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      description TEXT NOT NULL DEFAULT '',
      system_prompt TEXT NOT NULL DEFAULT '',
      text_provider_id INTEGER NOT NULL,
      text_model TEXT,
      image_provider_id INTEGER,
      video_provider_id INTEGER,
      model_params_json TEXT NOT NULL DEFAULT '{}',
      context_json TEXT NOT NULL DEFAULT '{}',
      allowed_tools_json TEXT NOT NULL DEFAULT '[]',
      blocked_tools_json TEXT NOT NULL DEFAULT '[]',
      tool_approval_mode TEXT NOT NULL DEFAULT 'confirm_risky'
        CHECK(tool_approval_mode IN ('confirm_all', 'confirm_risky', 'allow_selected', 'allow_all')),
      max_tool_calls INTEGER NOT NULL DEFAULT 8 CHECK(max_tool_calls BETWEEN 0 AND 32),
      enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0, 1)),
      is_default INTEGER NOT NULL DEFAULT 0 CHECK(is_default IN (0, 1)),
      configuration_status TEXT NOT NULL DEFAULT 'ready'
        CHECK(configuration_status IN ('ready', 'incomplete')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (text_provider_id) REFERENCES ai_providers(id) ON DELETE RESTRICT,
      FOREIGN KEY (image_provider_id) REFERENCES ai_providers(id) ON DELETE RESTRICT,
      FOREIGN KEY (video_provider_id) REFERENCES ai_providers(id) ON DELETE RESTRICT
    );

    CREATE UNIQUE INDEX IF NOT EXISTS ai_agents_default_unique
      ON ai_agents(is_default) WHERE is_default = 1;
    CREATE INDEX IF NOT EXISTS ai_agents_enabled_idx ON ai_agents(enabled, name);

    CREATE TABLE IF NOT EXISTS ai_agent_mcp_links (
      agent_id INTEGER NOT NULL,
      mcp_server_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (agent_id, mcp_server_id),
      FOREIGN KEY (agent_id) REFERENCES ai_agents(id) ON DELETE CASCADE,
      FOREIGN KEY (mcp_server_id) REFERENCES ai_mcp_servers(id) ON DELETE RESTRICT
    );

    CREATE TABLE IF NOT EXISTS ai_conversations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      agent_id INTEGER,
      agent_snapshot_json TEXT NOT NULL,
      is_pinned INTEGER NOT NULL DEFAULT 0 CHECK(is_pinned IN (0, 1)),
      is_archived INTEGER NOT NULL DEFAULT 0 CHECK(is_archived IN (0, 1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_message_at TEXT,
      FOREIGN KEY (agent_id) REFERENCES ai_agents(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS ai_conversations_recent_idx
      ON ai_conversations(is_archived, is_pinned DESC, updated_at DESC);

    CREATE TABLE IF NOT EXISTS ai_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'tool', 'system')),
      status TEXT NOT NULL DEFAULT 'completed'
        CHECK(status IN ('pending', 'streaming', 'completed', 'failed', 'cancelled', 'interrupted')),
      parent_message_id INTEGER,
      provider_message_id TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      started_at TEXT,
      completed_at TEXT,
      FOREIGN KEY (conversation_id) REFERENCES ai_conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_message_id) REFERENCES ai_messages(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS ai_messages_conversation_idx
      ON ai_messages(conversation_id, id);

    CREATE TABLE IF NOT EXISTS ai_media_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      provider_id INTEGER,
      run_id INTEGER,
      assistant_message_id INTEGER,
      media_type TEXT NOT NULL CHECK(media_type IN ('image', 'video', 'audio', 'file')),
      mime_type TEXT NOT NULL,
      local_path TEXT,
      source_url_redacted TEXT,
      provider_task_id TEXT,
      original_name TEXT,
      byte_size INTEGER CHECK(byte_size IS NULL OR byte_size >= 0),
      width INTEGER CHECK(width IS NULL OR width > 0),
      height INTEGER CHECK(height IS NULL OR height > 0),
      duration_seconds REAL CHECK(duration_seconds IS NULL OR duration_seconds >= 0),
      sha256 TEXT,
      status TEXT NOT NULL DEFAULT 'queued'
        CHECK(status IN ('queued', 'generating', 'polling', 'downloading', 'processing', 'completed', 'failed', 'cancelled', 'interrupted')),
      error_code TEXT,
      error_message TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_accessed_at TEXT,
      FOREIGN KEY (provider_id) REFERENCES ai_providers(id) ON DELETE SET NULL,
      FOREIGN KEY (run_id) REFERENCES ai_runs(id) ON DELETE SET NULL,
      FOREIGN KEY (assistant_message_id) REFERENCES ai_messages(id) ON DELETE SET NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS ai_media_assets_local_path_unique
      ON ai_media_assets(local_path) WHERE local_path IS NOT NULL;
    CREATE INDEX IF NOT EXISTS ai_media_assets_task_idx
      ON ai_media_assets(provider_task_id) WHERE provider_task_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS ai_media_assets_status_idx ON ai_media_assets(status, updated_at);

    CREATE TABLE IF NOT EXISTS ai_message_parts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message_id INTEGER NOT NULL,
      position INTEGER NOT NULL CHECK(position >= 0),
      content_type TEXT NOT NULL
        CHECK(content_type IN ('text', 'markdown', 'code', 'image', 'video', 'audio', 'file', 'tool_call', 'tool_result', 'media_task', 'error')),
      text_content TEXT,
      metadata_json TEXT NOT NULL DEFAULT '{}',
      media_asset_id INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (message_id, position),
      FOREIGN KEY (message_id) REFERENCES ai_messages(id) ON DELETE CASCADE,
      FOREIGN KEY (media_asset_id) REFERENCES ai_media_assets(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS ai_message_parts_message_idx
      ON ai_message_parts(message_id, position);

    CREATE TABLE IF NOT EXISTS ai_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id INTEGER NOT NULL,
      trigger_message_id INTEGER,
      assistant_message_id INTEGER,
      agent_snapshot_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'queued'
        CHECK(status IN ('queued', 'running', 'waiting_for_tool', 'waiting_for_approval', 'completed', 'failed', 'cancelled', 'interrupted')),
      current_stage TEXT,
      provider_request_id TEXT,
      usage_json TEXT NOT NULL DEFAULT '{}',
      error_code TEXT,
      error_message TEXT,
      started_at TEXT,
      completed_at TEXT,
      last_activity_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (conversation_id) REFERENCES ai_conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (trigger_message_id) REFERENCES ai_messages(id) ON DELETE SET NULL,
      FOREIGN KEY (assistant_message_id) REFERENCES ai_messages(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS ai_runs_conversation_idx ON ai_runs(conversation_id, id DESC);
    CREATE INDEX IF NOT EXISTS ai_runs_status_idx ON ai_runs(status, last_activity_at);

    CREATE TABLE IF NOT EXISTS ai_tool_calls (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id INTEGER NOT NULL,
      tool_call_key TEXT NOT NULL,
      mcp_server_id INTEGER,
      tool_name TEXT NOT NULL,
      risk_level TEXT NOT NULL CHECK(risk_level IN ('read', 'write', 'command', 'external_side_effect')),
      approval_status TEXT NOT NULL DEFAULT 'not_required'
        CHECK(approval_status IN ('not_required', 'waiting', 'approved_once', 'approved_session', 'rejected')),
      status TEXT NOT NULL DEFAULT 'proposed'
        CHECK(status IN ('proposed', 'waiting_for_approval', 'approved', 'running', 'completed', 'failed', 'rejected', 'cancelled')),
      input_json_redacted TEXT NOT NULL DEFAULT '{}',
      result_summary TEXT,
      result_asset_id INTEGER,
      error_code TEXT,
      error_message TEXT,
      started_at TEXT,
      completed_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (run_id, tool_call_key),
      FOREIGN KEY (run_id) REFERENCES ai_runs(id) ON DELETE CASCADE,
      FOREIGN KEY (mcp_server_id) REFERENCES ai_mcp_servers(id) ON DELETE SET NULL,
      FOREIGN KEY (result_asset_id) REFERENCES ai_media_assets(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS ai_tool_calls_run_idx ON ai_tool_calls(run_id, id);
  `)
}

function migrateSchema(db: Database.Database, currentVersion: number) {
  if (currentVersion < 2) {
    if (!hasColumn(db, 'ai_media_assets', 'run_id')) {
      db.exec('ALTER TABLE ai_media_assets ADD COLUMN run_id INTEGER REFERENCES ai_runs(id) ON DELETE SET NULL')
    }
    if (!hasColumn(db, 'ai_media_assets', 'assistant_message_id')) {
      db.exec('ALTER TABLE ai_media_assets ADD COLUMN assistant_message_id INTEGER REFERENCES ai_messages(id) ON DELETE SET NULL')
    }
    db.exec('CREATE INDEX IF NOT EXISTS ai_media_assets_run_idx ON ai_media_assets(run_id) WHERE run_id IS NOT NULL')
  }
  if (currentVersion < 3) {
    if (!hasColumn(db, 'ai_providers', 'text_models_json')) {
      db.exec("ALTER TABLE ai_providers ADD COLUMN text_models_json TEXT NOT NULL DEFAULT '[]'")
    }
    if (!hasColumn(db, 'ai_agents', 'text_model')) {
      db.exec('ALTER TABLE ai_agents ADD COLUMN text_model TEXT')
    }
    const providers = db.prepare('SELECT id, text_model FROM ai_providers').all() as Array<{
      id: number
      text_model: string | null
    }>
    const updateModels = db.prepare('UPDATE ai_providers SET text_models_json = ? WHERE id = ?')
    for (const provider of providers) {
      updateModels.run(JSON.stringify(provider.text_model ? [provider.text_model] : []), provider.id)
    }
  }
}

export function initializeAISchema(db: Database.Database) {
  db.pragma('foreign_keys = ON')
  db.exec('BEGIN IMMEDIATE')
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS ai_schema_meta (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        schema_version INTEGER NOT NULL CHECK(schema_version >= 0),
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `)
    const row = db.prepare('SELECT schema_version FROM ai_schema_meta WHERE id = 1').get() as
      | { schema_version: number }
      | undefined
    const currentVersion = row?.schema_version ?? 0
    if (currentVersion > AI_SCHEMA_VERSION) {
      throw new Error(`Unsupported AI schema version: ${currentVersion}`)
    }
    createSchemaObjects(db)
    migrateSchema(db, currentVersion)
    db.prepare(
      `
      INSERT INTO ai_schema_meta (id, schema_version, updated_at)
      VALUES (1, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        schema_version = excluded.schema_version,
        updated_at = CURRENT_TIMESTAMP
      `,
    ).run(AI_SCHEMA_VERSION)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}
