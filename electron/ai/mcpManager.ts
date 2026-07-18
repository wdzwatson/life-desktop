import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { AIMcpConfigService, AIMcpServerSummary } from './mcpConfigService'
import { AIServiceError, type AIMcpConnectionConfig } from './types'

export type AIMcpToolSummary = {
  serverId: number
  serverName: string
  name: string
  description: string
  inputSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  annotations: {
    title?: string
    readOnlyHint?: boolean
    destructiveHint?: boolean
    idempotentHint?: boolean
    openWorldHint?: boolean
  }
}

export type AIMcpConnectionInfo = {
  server: AIMcpServerSummary
  tools: AIMcpToolSummary[]
  connected: boolean
  refreshedAt: string | null
}

type McpClientLike = Pick<
  Client,
  'connect' | 'close' | 'listTools' | 'callTool' | 'getServerVersion' | 'getServerCapabilities'
> & {
  onclose?: () => void
  onerror?: (error: Error) => void
  transport?: Transport
}

type ManagedConnection = {
  serverId: number
  serverName: string
  client: McpClientLike
  transport: Transport
  timeoutMs: number
  tools: AIMcpToolSummary[]
  refreshedAt: string | null
  stderr: string
  secrets: string[]
  protocolVersion?: string
  intentionalClose: boolean
}

type PendingConnection = ManagedConnection & { controller: AbortController }

export type AIMcpManagerDependencies = {
  getConfigService: () => Pick<
    AIMcpConfigService,
    'get' | 'getRuntimeConnection' | 'recordConnectionResult'
  >
  createClient?: () => McpClientLike
  createTransport?: (connection: AIMcpConnectionConfig) => Transport
  now?: () => Date
}

function mcpError(
  code: 'invalid_input' | 'configuration_incomplete' | 'cancelled' | 'timeout' | 'mcp_unavailable' | 'tool_failed',
  message: string,
  retryable = false,
) {
  return new AIServiceError({ code, message, retryable })
}

function requireId(value: unknown, field: string) {
  if (!Number.isInteger(value) || Number(value) < 1) throw mcpError('invalid_input', `Invalid ${field}.`)
  return Number(value)
}

function requireToolName(value: unknown) {
  if (typeof value !== 'string' || !value.trim() || value.length > 300) {
    throw mcpError('invalid_input', 'Invalid MCP tool name.')
  }
  return value.trim()
}

function requireArguments(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw mcpError('invalid_input', 'MCP tool arguments must be an object.')
  }
  let serialized: string
  try {
    serialized = JSON.stringify(value)
  } catch {
    throw mcpError('invalid_input', 'MCP tool arguments must be serializable.')
  }
  if (serialized.length > 1_000_000) throw mcpError('invalid_input', 'MCP tool arguments are too large.')
  return JSON.parse(serialized) as Record<string, unknown>
}

function safeSchema(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { type: 'object' }
  try {
    const serialized = JSON.stringify(value)
    if (serialized.length > 100_000) return { type: 'object' }
    return JSON.parse(serialized) as Record<string, unknown>
  } catch {
    return { type: 'object' }
  }
}

export function redactMcpDiagnostic(value: unknown, secrets: string[] = []) {
  let message = value instanceof Error ? value.message : String(value ?? '')
  for (const secret of [...new Set(secrets)].sort((left, right) => right.length - left.length)) {
    if (secret.length >= 3) message = message.split(secret).join('[REDACTED]')
  }
  message = message
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*/gi, '$1 [REDACTED]')
    .replace(/\b(api[_-]?key|token|password|secret|authorization)\b\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .replace(/([?&](?:key|token|secret|signature|auth)=)[^&#\s]+/gi, '$1[REDACTED]')
    .replace(/(https?:\/\/)[^/@\s]+@/gi, '$1')
  return [...message]
    .filter((character) => {
      const code = character.charCodeAt(0)
      return code === 9 || code === 10 || code === 13 || code >= 32
    })
    .join('')
    .slice(-4_000)
}

function errorDetail(error: unknown, signal?: AbortSignal) {
  if (error instanceof AIServiceError) return error
  const message = error instanceof Error ? error.message : String(error)
  if (signal?.aborted || /abort|cancel/i.test(message)) {
    return mcpError('cancelled', 'The MCP operation was cancelled.')
  }
  if (/timed?\s*out|timeout|RequestTimeout/i.test(message)) {
    return mcpError('timeout', 'The MCP server did not respond before the timeout.', true)
  }
  return mcpError('mcp_unavailable', 'The MCP server is unavailable.', true)
}

function configuredSecrets(connection: AIMcpConnectionConfig) {
  return Object.values(connection.transport === 'stdio' ? connection.env : connection.headers).filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  )
}

export class AIMcpManager {
  private readonly connections = new Map<number, ManagedConnection>()
  private readonly pending = new Map<number, PendingConnection>()
  private readonly connectPromises = new Map<number, Promise<AIMcpConnectionInfo>>()
  private readonly createClient: () => McpClientLike
  private readonly createTransport: (connection: AIMcpConnectionConfig) => Transport
  private readonly now: () => Date
  private disposed = false

  constructor(private readonly dependencies: AIMcpManagerDependencies) {
    this.createClient =
      dependencies.createClient ??
      (() => new Client({ name: 'life-desktop', version: '1.0.2' }, { capabilities: {} }))
    this.createTransport = dependencies.createTransport ?? ((connection) => this.buildTransport(connection))
    this.now = dependencies.now ?? (() => new Date())
  }

  async connect(serverIdValue: unknown, options: { refresh?: boolean } = {}) {
    if (this.disposed) throw mcpError('configuration_incomplete', 'The MCP runtime is not available.')
    const serverId = requireId(serverIdValue, 'MCP server ID')
    const active = this.connections.get(serverId)
    if (active && !options.refresh) return this.toInfo(active)
    if (active && options.refresh) await this.disconnect(serverId)
    const inProgress = this.connectPromises.get(serverId)
    if (inProgress) return inProgress
    const promise = this.open(serverId).finally(() => this.connectPromises.delete(serverId))
    this.connectPromises.set(serverId, promise)
    return promise
  }

  async disconnect(serverIdValue: unknown, options: { recordStatus?: boolean } = {}) {
    const serverId = requireId(serverIdValue, 'MCP server ID')
    const pending = this.pending.get(serverId)
    if (pending) {
      pending.intentionalClose = true
      pending.controller.abort()
      this.forceStopStdio(pending.transport)
    }
    const active = this.connections.get(serverId)
    this.connections.delete(serverId)
    if (active) {
      active.intentionalClose = true
      this.forceStopStdio(active.transport)
      try {
        await active.client.close()
      } catch {
        // Closing is best effort; the connection has already been removed from the runtime.
      }
    }
    if (options.recordStatus !== false) this.recordDisconnected(serverId)
    return { disconnected: true, serverId }
  }

  async refreshTools(serverIdValue: unknown) {
    const serverId = requireId(serverIdValue, 'MCP server ID')
    let connection = this.connections.get(serverId)
    if (!connection) {
      await this.connect(serverId)
      connection = this.connections.get(serverId)
    }
    if (!connection) throw mcpError('mcp_unavailable', 'The MCP server connection was not established.', true)
    const tools = await this.discoverTools(connection)
    connection.tools = tools
    connection.refreshedAt = this.now().toISOString()
    this.recordConnected(connection)
    return this.toInfo(connection)
  }

  async listTools(serverIds: number[], options: { connect?: boolean; refresh?: boolean } = {}) {
    if (!Array.isArray(serverIds) || serverIds.length > 100) {
      throw mcpError('invalid_input', 'Invalid MCP server list.')
    }
    const ids = [...new Set(serverIds.map((id) => requireId(id, 'MCP server ID')))]
    const result: AIMcpToolSummary[] = []
    for (const id of ids) {
      let connection = this.connections.get(id)
      if (!connection && options.connect !== false) {
        await this.connect(id)
        connection = this.connections.get(id)
      }
      if (!connection) continue
      if (options.refresh) await this.refreshTools(id)
      result.push(...(this.connections.get(id)?.tools ?? []))
    }
    return result
  }

  async callTool(
    input: { serverId: unknown; toolName: unknown; arguments: unknown },
    options: { signal?: AbortSignal; timeoutMs?: number } = {},
  ) {
    const serverId = requireId(input.serverId, 'MCP server ID')
    const toolName = requireToolName(input.toolName)
    const args = requireArguments(input.arguments)
    await this.connect(serverId)
    const connection = this.connections.get(serverId)
    if (!connection) throw mcpError('mcp_unavailable', 'The MCP server connection was not established.', true)
    if (!connection.tools.some((tool) => tool.name === toolName)) {
      throw mcpError('invalid_input', 'The requested MCP tool is not available from this server.')
    }
    const timeout = Math.min(
      Math.max(options.timeoutMs ?? connection.timeoutMs, 1_000),
      600_000,
    )
    try {
      return await connection.client.callTool(
        { name: toolName, arguments: args },
        undefined,
        { signal: options.signal, timeout, maxTotalTimeout: timeout },
      )
    } catch (error) {
      const mapped = errorDetail(error, options.signal)
      if (mapped.detail.code === 'cancelled' || mapped.detail.code === 'timeout') throw mapped
      throw mcpError('tool_failed', 'The MCP tool call failed.', true)
    }
  }

  getConnectionInfo(serverIdValue: unknown) {
    const serverId = requireId(serverIdValue, 'MCP server ID')
    const active = this.connections.get(serverId)
    if (active) return this.toInfo(active)
    return {
      server: this.dependencies.getConfigService().get(serverId),
      tools: [],
      connected: false,
      refreshedAt: null,
    } satisfies AIMcpConnectionInfo
  }

  async dispose() {
    if (this.disposed) return
    this.disposed = true
    for (const pending of this.pending.values()) {
      pending.intentionalClose = true
      pending.controller.abort()
      this.forceStopStdio(pending.transport)
      this.safeRecord(pending.serverId, { status: 'disconnected', toolCount: 0 })
      void pending.client.close().catch(() => undefined)
    }
    this.pending.clear()
    const closing: Promise<unknown>[] = []
    for (const connection of this.connections.values()) {
      connection.intentionalClose = true
      this.forceStopStdio(connection.transport)
      this.safeRecord(connection.serverId, {
        status: 'disconnected',
        toolCount: 0,
      })
      closing.push(connection.client.close().catch(() => undefined))
    }
    this.connections.clear()
    await Promise.allSettled(closing)
  }

  private async open(serverId: number): Promise<AIMcpConnectionInfo> {
    const config = this.dependencies.getConfigService()
    const server = config.get(serverId)
    if (!server.enabled) throw mcpError('configuration_incomplete', 'The MCP server is disabled.')
    const runtimeConnection = config.getRuntimeConnection(serverId)
    const secrets = configuredSecrets(runtimeConnection)
    const controller = new AbortController()
    const client = this.createClient()
    const transport = this.createTransport(runtimeConnection)
    const connection: PendingConnection = {
      serverId,
      serverName: server.name,
      client,
      transport,
      timeoutMs: server.timeoutMs,
      tools: [],
      refreshedAt: null,
      stderr: '',
      secrets,
      intentionalClose: false,
      controller,
    }
    this.pending.set(serverId, connection)
    const setProtocolVersion = transport.setProtocolVersion?.bind(transport)
    transport.setProtocolVersion = (version) => {
      connection.protocolVersion = version
      setProtocolVersion?.(version)
    }
    this.captureStderr(connection)
    client.onclose = () => this.handleClose(connection)
    client.onerror = (error) => this.handleError(connection, error)
    config.recordConnectionResult(serverId, { status: 'connecting', toolCount: 0 })
    try {
      await client.connect(transport, {
        signal: controller.signal,
        timeout: server.timeoutMs,
        maxTotalTimeout: server.timeoutMs,
      })
      connection.tools = await this.discoverTools(connection)
      connection.refreshedAt = this.now().toISOString()
      this.pending.delete(serverId)
      this.connections.set(serverId, connection)
      this.recordConnected(connection)
      return this.toInfo(connection)
    } catch (error) {
      this.pending.delete(serverId)
      connection.intentionalClose = true
      this.forceStopStdio(transport)
      void client.close().catch(() => undefined)
      const mapped = errorDetail(error, controller.signal)
      const diagnostic = redactMcpDiagnostic(connection.stderr || error, secrets)
      this.safeRecord(serverId, {
        status: controller.signal.aborted ? 'disconnected' : 'failed',
        toolCount: 0,
        errorCode: mapped.detail.code,
        errorMessage: diagnostic || mapped.detail.message,
      })
      throw mapped
    }
  }

  private async discoverTools(connection: ManagedConnection) {
    const tools: AIMcpToolSummary[] = []
    let cursor: string | undefined
    for (let page = 0; page < 100; page += 1) {
      const result = await connection.client.listTools(
        cursor ? { cursor } : undefined,
        { timeout: connection.timeoutMs, maxTotalTimeout: connection.timeoutMs },
      )
      for (const tool of result.tools ?? []) {
        if (tools.length >= 10_000) throw mcpError('mcp_unavailable', 'The MCP server exposes too many tools.')
        tools.push({
          serverId: connection.serverId,
          serverName: connection.serverName,
          name: tool.name,
          description: String(tool.description ?? '').slice(0, 4_000),
          inputSchema: safeSchema(tool.inputSchema),
          ...(tool.outputSchema ? { outputSchema: safeSchema(tool.outputSchema) } : {}),
          annotations: {
            ...(tool.annotations?.title ? { title: tool.annotations.title } : {}),
            ...(typeof tool.annotations?.readOnlyHint === 'boolean'
              ? { readOnlyHint: tool.annotations.readOnlyHint }
              : {}),
            ...(typeof tool.annotations?.destructiveHint === 'boolean'
              ? { destructiveHint: tool.annotations.destructiveHint }
              : {}),
            ...(typeof tool.annotations?.idempotentHint === 'boolean'
              ? { idempotentHint: tool.annotations.idempotentHint }
              : {}),
            ...(typeof tool.annotations?.openWorldHint === 'boolean'
              ? { openWorldHint: tool.annotations.openWorldHint }
              : {}),
          },
        })
      }
      cursor = typeof result.nextCursor === 'string' && result.nextCursor ? result.nextCursor : undefined
      if (!cursor) break
    }
    return tools
  }

  private buildTransport(connection: AIMcpConnectionConfig): Transport {
    if (connection.transport === 'stdio') {
      return new StdioClientTransport({
        command: connection.command,
        args: [...connection.args],
        cwd: connection.cwd,
        env: { ...getDefaultEnvironment(), ...connection.env },
        stderr: 'pipe',
      })
    }
    const requestInit: RequestInit = { headers: new Headers(connection.headers) }
    if (connection.transport === 'sse') {
      return new SSEClientTransport(new URL(connection.url), { requestInit })
    }
    return new StreamableHTTPClientTransport(new URL(connection.url), {
      requestInit,
      reconnectionOptions: {
        initialReconnectionDelay: 500,
        maxReconnectionDelay: 5_000,
        reconnectionDelayGrowFactor: 1.6,
        maxRetries: 2,
      },
    })
  }

  private captureStderr(connection: ManagedConnection) {
    if (!(connection.transport instanceof StdioClientTransport)) return
    connection.transport.stderr?.on('data', (chunk) => {
      connection.stderr = redactMcpDiagnostic(`${connection.stderr}${String(chunk)}`, connection.secrets)
    })
  }

  private handleClose(connection: ManagedConnection) {
    if (connection.intentionalClose || this.disposed) return
    if (this.connections.get(connection.serverId) !== connection) return
    this.connections.delete(connection.serverId)
    this.safeRecord(connection.serverId, {
      status: 'failed',
      toolCount: 0,
      errorCode: 'mcp_unavailable',
      errorMessage:
        connection.stderr || 'The MCP server connection closed unexpectedly.',
    })
  }

  private handleError(connection: ManagedConnection, error: Error) {
    if (connection.intentionalClose || this.disposed) return
    const diagnostic = redactMcpDiagnostic(error, connection.secrets)
    if (this.connections.get(connection.serverId) === connection) {
      this.safeRecord(connection.serverId, {
        status: 'connected',
        protocolVersion: this.protocolLabel(connection),
        toolCount: connection.tools.length,
        errorCode: 'mcp_unavailable',
        errorMessage: diagnostic,
      })
    }
  }

  private recordConnected(connection: ManagedConnection) {
    this.safeRecord(connection.serverId, {
      status: 'connected',
      protocolVersion: this.protocolLabel(connection),
      toolCount: connection.tools.length,
      connectedAt: this.now().toISOString(),
    })
  }

  private recordDisconnected(serverId: number) {
    this.safeRecord(serverId, { status: 'disconnected', toolCount: 0 })
  }

  private protocolLabel(connection: ManagedConnection) {
    return connection.protocolVersion ?? 'unknown'
  }

  private safeRecord(
    serverId: number,
    result: Parameters<AIMcpConfigService['recordConnectionResult']>[1],
  ) {
    try {
      this.dependencies.getConfigService().recordConnectionResult(serverId, result)
    } catch {
      // The user may have switched or deleted the server while an async close was completing.
    }
  }

  private toInfo(connection: ManagedConnection): AIMcpConnectionInfo {
    return {
      server: this.dependencies.getConfigService().get(connection.serverId),
      tools: connection.tools.map((tool) => ({ ...tool, annotations: { ...tool.annotations } })),
      connected: true,
      refreshedAt: connection.refreshedAt,
    }
  }

  private forceStopStdio(transport: Transport) {
    if (!(transport instanceof StdioClientTransport)) return
    const pid = transport.pid
    if (!pid) return
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      // The process may already have exited.
    }
  }
}
