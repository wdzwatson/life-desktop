export type McpTransport = 'streamable_http' | 'sse' | 'stdio'
export type McpToolRisk = 'read' | 'write' | 'command' | 'external_side_effect'

export type McpHttpSummary = { url: string; headerNames: string[] }
export type McpStdioSummary = { command: string; args: string[]; cwd?: string; envNames: string[] }

export type McpServerSummary = {
  id: number
  name: string
  description: string
  transport: McpTransport
  connection: McpHttpSummary | McpStdioSummary
  credentialConfigured: boolean
  riskOverrides: Record<string, McpToolRisk>
  timeoutMs: number
  enabled: boolean
  connectionStatus: 'disconnected' | 'connecting' | 'connected' | 'failed'
  protocolVersion: string | null
  toolCount: number
  lastConnectedAt: string | null
  lastError: { code: string | null; message: string | null }
  createdAt: string
  updatedAt: string
}

export type McpDraft = {
  name: string
  description: string
  transport: McpTransport
  originalTransport: McpTransport
  url: string
  headersJson: string
  command: string
  argsText: string
  cwd: string
  envJson: string
  preserveCredentials: boolean
  timeoutSeconds: string
  enabled: boolean
}

export function createMcpDraft(): McpDraft {
  return {
    name: '',
    description: '',
    transport: 'streamable_http',
    originalTransport: 'streamable_http',
    url: '',
    headersJson: '{}',
    command: '',
    argsText: '',
    cwd: '',
    envJson: '{}',
    preserveCredentials: false,
    timeoutSeconds: '30',
    enabled: true,
  }
}

export function mcpToDraft(server: McpServerSummary): McpDraft {
  const isStdio = server.transport === 'stdio'
  const connection = server.connection as McpHttpSummary & McpStdioSummary
  return {
    name: server.name,
    description: server.description,
    transport: server.transport,
    originalTransport: server.transport,
    url: isStdio ? '' : connection.url,
    headersJson: '{}',
    command: isStdio ? connection.command : '',
    argsText: isStdio ? connection.args.join('\n') : '',
    cwd: isStdio ? connection.cwd ?? '' : '',
    envJson: '{}',
    preserveCredentials: server.credentialConfigured,
    timeoutSeconds: String(server.timeoutMs / 1000),
    enabled: server.enabled,
  }
}

export function parseMcpSecretMap(value: string, fieldName: string) {
  const parsed = JSON.parse(value || '{}') as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${fieldName} must be a JSON object.`)
  }
  const result: Record<string, string> = {}
  for (const [name, secret] of Object.entries(parsed)) {
    if (typeof secret !== 'string') throw new Error(`${fieldName} value ${name} must be a string.`)
    result[name] = secret
  }
  return result
}

export function parseMcpArguments(value: string) {
  return value
    .split('\n')
    .map((item) => item.trim())
    .filter(Boolean)
}

export function buildMcpPayload(draft: McpDraft) {
  const timeoutSeconds = Number(draft.timeoutSeconds)
  if (!Number.isFinite(timeoutSeconds)) throw new Error('Timeout must be a number.')
  const connection =
    draft.transport === 'stdio'
      ? {
          transport: 'stdio' as const,
          command: draft.command,
          args: parseMcpArguments(draft.argsText),
          ...(draft.cwd.trim() ? { cwd: draft.cwd.trim() } : {}),
          env: draft.preserveCredentials ? {} : parseMcpSecretMap(draft.envJson, 'Environment variables'),
        }
      : {
          transport: draft.transport,
          url: draft.url,
          headers: draft.preserveCredentials ? {} : parseMcpSecretMap(draft.headersJson, 'Headers'),
        }
  return {
    name: draft.name,
    description: draft.description,
    enabled: draft.enabled,
    timeoutMs: Math.round(timeoutSeconds * 1000),
    connection,
  }
}

export function getMcpCredentialNames(server: McpServerSummary) {
  return server.transport === 'stdio'
    ? (server.connection as McpStdioSummary).envNames
    : (server.connection as McpHttpSummary).headerNames
}

export function getMcpEndpointLabel(server: McpServerSummary) {
  if (server.transport === 'stdio') {
    const connection = server.connection as McpStdioSummary
    return [connection.command, ...connection.args].join(' ')
  }
  return (server.connection as McpHttpSummary).url
}

export function formatMcpLastConnectedAt(value: string | null, locale: string) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}
