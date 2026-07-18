import type Database from 'better-sqlite3'
import type { AICredentialService } from './credentialService'
import { AIServiceError, type AIMcpConnectionConfig, type AIMcpServerInput, type AIToolRisk } from './types'
import { parseAIMcpServerInput } from './validation'

type CredentialStore = Pick<AICredentialService, 'create' | 'replace' | 'reveal' | 'delete'>

type McpRow = {
  id: number
  name: string
  description: string
  transport: AIMcpServerInput['connection']['transport']
  connection_json: string
  credential_ref: string | null
  risk_overrides_json: string
  timeout_ms: number
  enabled: number
  connection_status: 'disconnected' | 'connecting' | 'connected' | 'failed'
  protocol_version: string | null
  tool_count: number
  last_connected_at: string | null
  last_error_code: string | null
  last_error_message: string | null
  created_at: string
  updated_at: string
}

type McpCredentialBundle = {
  headers?: Record<string, string>
  env?: Record<string, string>
}

type StoredHttpConnection = { url: string; headerNames: string[] }
type StoredStdioConnection = { command: string; args: string[]; cwd?: string; envNames: string[] }

export type AIMcpServerSummary = {
  id: number
  name: string
  description: string
  transport: McpRow['transport']
  connection: StoredHttpConnection | StoredStdioConnection
  credentialConfigured: boolean
  riskOverrides: Record<string, AIToolRisk>
  timeoutMs: number
  enabled: boolean
  connectionStatus: McpRow['connection_status']
  protocolVersion: string | null
  toolCount: number
  lastConnectedAt: string | null
  lastError: { code: string | null; message: string | null }
  createdAt: string
  updatedAt: string
}

export type AIMcpDependency = { agentId: number; agentName: string }

function serviceError(
  code: 'invalid_input' | 'not_found' | 'configuration_incomplete' | 'storage_error',
  message: string,
  retryable = false,
) {
  return new AIServiceError({ code, message, retryable })
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function serializeSecrets(bundle: McpCredentialBundle) {
  return JSON.stringify(bundle)
}

function deserializeSecrets(value: string): McpCredentialBundle {
  try {
    const parsed = JSON.parse(value) as McpCredentialBundle
    return {
      ...(parsed.headers && typeof parsed.headers === 'object' ? { headers: parsed.headers } : {}),
      ...(parsed.env && typeof parsed.env === 'object' ? { env: parsed.env } : {}),
    }
  } catch {
    throw serviceError('storage_error', 'MCP credentials are corrupt.')
  }
}

export class AIMcpConfigService {
  constructor(
    private readonly db: Database.Database,
    private readonly credentials: CredentialStore,
  ) {
    this.db.pragma('foreign_keys = ON')
  }

  list() {
    return (this.db.prepare('SELECT * FROM ai_mcp_servers ORDER BY name COLLATE NOCASE, id').all() as McpRow[]).map(
      (row) => this.toSummary(row),
    )
  }

  get(id: number) {
    return this.toSummary(this.requireRow(id))
  }

  create(value: unknown) {
    const input = parseAIMcpServerInput(value)
    const secrets = this.extractSecrets(input.connection)
    const credentialRef = this.hasSecrets(secrets) ? this.credentials.create(serializeSecrets(secrets)) : null
    try {
      const result = this.db
        .prepare(
          `
          INSERT INTO ai_mcp_servers (
            name, description, transport, connection_json, credential_ref, timeout_ms, enabled
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          input.name,
          input.description,
          input.connection.transport,
          JSON.stringify(this.toStoredConnection(input.connection)),
          credentialRef,
          input.timeoutMs,
          input.enabled ? 1 : 0,
        )
      return this.get(Number(result.lastInsertRowid))
    } catch (error) {
      if (credentialRef) this.credentials.delete(credentialRef)
      throw this.mapDbError(error)
    }
  }

  update(id: number, value: unknown, options: { preserveCredentials?: boolean } = {}) {
    const row = this.requireRow(id)
    const input = parseAIMcpServerInput(value)
    const oldSecret = row.credential_ref ? this.credentials.reveal(row.credential_ref) : null
    const oldCredentials = oldSecret ? deserializeSecrets(oldSecret) : {}
    const preserveCredentials = options.preserveCredentials === true && row.transport === input.connection.transport
    const secrets = preserveCredentials ? oldCredentials : this.extractSecrets(input.connection)
    let nextRef = row.credential_ref
    let createdRef: string | null = null
    try {
      if (this.hasSecrets(secrets)) {
        const serialized = serializeSecrets(secrets)
        if (nextRef && !preserveCredentials) this.credentials.replace(nextRef, serialized)
        else {
          if (!nextRef) {
            createdRef = this.credentials.create(serialized)
            nextRef = createdRef
          }
        }
      } else nextRef = null

      this.db.transaction(() => {
        this.db
          .prepare(
            `
            UPDATE ai_mcp_servers SET
              name = ?, description = ?, transport = ?, connection_json = ?,
              credential_ref = ?, timeout_ms = ?, enabled = ?,
              connection_status = 'disconnected', protocol_version = NULL,
              tool_count = 0, last_error_code = NULL, last_error_message = NULL,
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            `,
          )
          .run(
            input.name,
            input.description,
            input.connection.transport,
            JSON.stringify(this.toStoredConnection(input.connection, secrets)),
            nextRef,
            input.timeoutMs,
            input.enabled ? 1 : 0,
            id,
          )
        if (!input.enabled) this.markDependentAgentsIncomplete(id)
      })()
    } catch (error) {
      if (createdRef) this.credentials.delete(createdRef)
      if (row.credential_ref && oldSecret !== null) this.credentials.replace(row.credential_ref, oldSecret)
      throw this.mapDbError(error)
    }
    if (row.credential_ref && !nextRef) this.credentials.delete(row.credential_ref)
    return this.get(id)
  }

  copy(id: number, requestedName?: string) {
    const runtime = this.getRuntimeConnection(id)
    const source = this.get(id)
    return this.create({
      name: requestedName?.trim() || this.nextCopyName(source.name),
      description: source.description,
      enabled: false,
      timeoutMs: source.timeoutMs,
      connection: runtime,
    })
  }

  setEnabled(id: number, enabled: boolean) {
    this.requireRow(id)
    this.db.transaction(() => {
      this.db
        .prepare(
          `
          UPDATE ai_mcp_servers SET enabled = ?, connection_status = 'disconnected',
            updated_at = CURRENT_TIMESTAMP WHERE id = ?
          `,
        )
        .run(enabled ? 1 : 0, id)
      if (!enabled) this.markDependentAgentsIncomplete(id)
    })()
    return { server: this.get(id), dependencies: this.getDependencies(id) }
  }

  setRiskOverride(id: number, toolName: string, risk: AIToolRisk | null) {
    const row = this.requireRow(id)
    if (!toolName.trim() || toolName.length > 300) throw serviceError('invalid_input', 'Invalid MCP tool name.')
    if (risk !== null && !['read', 'write', 'command', 'external_side_effect'].includes(risk)) {
      throw serviceError('invalid_input', 'Invalid MCP tool risk.')
    }
    const overrides = parseJson<Record<string, AIToolRisk>>(row.risk_overrides_json, {})
    if (risk === null) delete overrides[toolName]
    else overrides[toolName] = risk
    this.db
      .prepare('UPDATE ai_mcp_servers SET risk_overrides_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(JSON.stringify(overrides), id)
    return this.get(id)
  }

  recordConnectionResult(
    id: number,
    result: {
      status: 'connecting' | 'connected' | 'failed' | 'disconnected'
      protocolVersion?: string
      toolCount?: number
      errorCode?: string
      errorMessage?: string
      connectedAt?: string
    },
  ) {
    this.requireRow(id)
    if (!['connecting', 'connected', 'failed', 'disconnected'].includes(result.status)) {
      throw serviceError('invalid_input', 'Invalid MCP connection status.')
    }
    if (result.toolCount !== undefined && (!Number.isInteger(result.toolCount) || result.toolCount < 0 || result.toolCount > 100_000)) {
      throw serviceError('invalid_input', 'Invalid MCP tool count.')
    }
    const toolCount = Math.max(0, Math.floor(result.toolCount ?? 0))
    this.db
      .prepare(
        `
        UPDATE ai_mcp_servers SET
          connection_status = ?, protocol_version = ?, tool_count = ?,
          last_connected_at = CASE WHEN ? = 'connected' THEN ? ELSE last_connected_at END,
          last_error_code = ?, last_error_message = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        `,
      )
      .run(
        result.status,
        result.protocolVersion ?? null,
        toolCount,
        result.status,
        result.connectedAt ?? new Date().toISOString(),
        result.errorCode ?? null,
        result.errorMessage ?? null,
        id,
      )
    return this.get(id)
  }

  getRuntimeConnection(id: number): AIMcpConnectionConfig {
    const row = this.requireRow(id)
    const stored = parseJson<StoredHttpConnection | StoredStdioConnection>(row.connection_json, {} as StoredHttpConnection)
    const secrets = row.credential_ref ? deserializeSecrets(this.credentials.reveal(row.credential_ref)) : {}
    if (row.transport === 'stdio') {
      const config = stored as StoredStdioConnection
      return { transport: 'stdio', command: config.command, args: config.args, cwd: config.cwd, env: secrets.env ?? {} }
    }
    const config = stored as StoredHttpConnection
    return { transport: row.transport, url: config.url, headers: secrets.headers ?? {} }
  }

  getDependencies(id: number): AIMcpDependency[] {
    this.requireRow(id)
    return this.db
      .prepare(
        `
        SELECT a.id AS agentId, a.name AS agentName
        FROM ai_agent_mcp_links l
        JOIN ai_agents a ON a.id = l.agent_id
        WHERE l.mcp_server_id = ?
        ORDER BY a.name COLLATE NOCASE, a.id
        `,
      )
      .all(id) as AIMcpDependency[]
  }

  delete(id: number) {
    const row = this.requireRow(id)
    if (this.getDependencies(id).length > 0) {
      throw serviceError('configuration_incomplete', 'MCP server is still used by one or more agents.')
    }
    this.db.prepare('DELETE FROM ai_mcp_servers WHERE id = ?').run(id)
    if (row.credential_ref) this.credentials.delete(row.credential_ref)
    return true
  }

  private toSummary(row: McpRow): AIMcpServerSummary {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      transport: row.transport,
      connection: parseJson(row.connection_json, {} as StoredHttpConnection),
      credentialConfigured: Boolean(row.credential_ref),
      riskOverrides: parseJson(row.risk_overrides_json, {}),
      timeoutMs: row.timeout_ms,
      enabled: Boolean(row.enabled),
      connectionStatus: row.connection_status,
      protocolVersion: row.protocol_version,
      toolCount: row.tool_count,
      lastConnectedAt: row.last_connected_at,
      lastError: { code: row.last_error_code, message: row.last_error_message },
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  private toStoredConnection(
    connection: AIMcpConnectionConfig,
    credentials: McpCredentialBundle = this.extractSecrets(connection),
  ): StoredHttpConnection | StoredStdioConnection {
    if (connection.transport === 'stdio') {
      return {
        command: connection.command,
        args: connection.args,
        cwd: connection.cwd,
        envNames: Object.keys(credentials.env ?? {}).sort(),
      }
    }
    return { url: connection.url, headerNames: Object.keys(credentials.headers ?? {}).sort() }
  }

  private extractSecrets(connection: AIMcpConnectionConfig): McpCredentialBundle {
    return connection.transport === 'stdio' ? { env: connection.env } : { headers: connection.headers }
  }

  private hasSecrets(bundle: McpCredentialBundle) {
    return Object.keys(bundle.headers ?? {}).length > 0 || Object.keys(bundle.env ?? {}).length > 0
  }

  private markDependentAgentsIncomplete(serverId: number) {
    this.db
      .prepare(
        `
        UPDATE ai_agents SET configuration_status = 'incomplete', updated_at = CURRENT_TIMESTAMP
        WHERE id IN (SELECT agent_id FROM ai_agent_mcp_links WHERE mcp_server_id = ?)
        `,
      )
      .run(serverId)
  }

  private requireRow(id: number) {
    if (!Number.isInteger(id) || id < 1) throw serviceError('invalid_input', 'Invalid MCP server ID.')
    const row = this.db.prepare('SELECT * FROM ai_mcp_servers WHERE id = ?').get(id) as McpRow | undefined
    if (!row) throw serviceError('not_found', 'MCP server was not found.')
    return row
  }

  private nextCopyName(name: string) {
    const base = `${name} Copy`
    let candidate = base
    let suffix = 2
    while (this.db.prepare('SELECT 1 FROM ai_mcp_servers WHERE name = ? COLLATE NOCASE').get(candidate)) {
      candidate = `${base} ${suffix++}`
    }
    return candidate
  }

  private mapDbError(error: unknown) {
    if (error instanceof AIServiceError) return error
    const message = error instanceof Error ? error.message : String(error)
    if (/UNIQUE constraint failed: ai_mcp_servers\.name/i.test(message)) {
      return serviceError('invalid_input', 'An MCP server with this name already exists.')
    }
    return serviceError('storage_error', 'MCP configuration could not be saved.', true)
  }
}
