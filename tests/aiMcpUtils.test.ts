import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildMcpPayload,
  createMcpDraft,
  formatMcpLastConnectedAt,
  getMcpCredentialNames,
  getMcpEndpointLabel,
  mcpToDraft,
  parseMcpArguments,
  parseMcpSecretMap,
  type McpServerSummary,
} from '../src/views/ai/mcpUtils.ts'

const httpServer: McpServerSummary = {
  id: 1,
  name: 'Research',
  description: '',
  transport: 'streamable_http',
  connection: { url: 'https://mcp.example.test', headerNames: ['Authorization'] },
  credentialConfigured: true,
  riskOverrides: { 'files.delete': 'write' },
  timeoutMs: 30000,
  enabled: true,
  connectionStatus: 'connected',
  protocolVersion: '2025-06-18',
  toolCount: 4,
  lastConnectedAt: '2026-07-18T04:00:00Z',
  lastError: { code: null, message: null },
  createdAt: '2026-07-18',
  updatedAt: '2026-07-18',
}

test('MCP drafts preserve masked credential names without exposing values', () => {
  const draft = mcpToDraft(httpServer)
  assert.equal(draft.preserveCredentials, true)
  assert.equal(draft.headersJson, '{}')
  assert.deepEqual(getMcpCredentialNames(httpServer), ['Authorization'])
  assert.deepEqual(buildMcpPayload(draft).connection, {
    transport: 'streamable_http',
    url: 'https://mcp.example.test',
    headers: {},
  })
})

test('MCP HTTP and stdio drafts build normalized payloads', () => {
  const http = buildMcpPayload({
    ...createMcpDraft(),
    name: 'Remote',
    url: 'https://mcp.test',
    headersJson: '{"Authorization":"secret"}',
  })
  assert.deepEqual(http.connection, {
    transport: 'streamable_http',
    url: 'https://mcp.test',
    headers: { Authorization: 'secret' },
  })

  const stdio = buildMcpPayload({
    ...createMcpDraft(),
    name: 'Local',
    transport: 'stdio',
    command: '/usr/bin/tool',
    argsText: '--safe\nvalue with spaces',
    envJson: '{"TOKEN":"secret"}',
  })
  assert.deepEqual(stdio.connection, {
    transport: 'stdio',
    command: '/usr/bin/tool',
    args: ['--safe', 'value with spaces'],
    env: { TOKEN: 'secret' },
  })
})

test('MCP secret maps and argument lines reject malformed input safely', () => {
  assert.deepEqual(parseMcpArguments(' --one \n\n value '), ['--one', 'value'])
  assert.throws(() => parseMcpSecretMap('[]', 'Headers'), /JSON object/)
  assert.throws(() => parseMcpSecretMap('{"X":1}', 'Headers'), /must be a string/)
})

test('MCP endpoint and timestamp summaries support HTTP and stdio', () => {
  assert.equal(getMcpEndpointLabel(httpServer), 'https://mcp.example.test')
  assert.equal(formatMcpLastConnectedAt(null, 'en-US'), null)
  assert.match(formatMcpLastConnectedAt(httpServer.lastConnectedAt, 'en-US') ?? '', /2026/)
  const stdio = {
    ...httpServer,
    transport: 'stdio' as const,
    connection: { command: '/usr/bin/tool', args: ['--safe'], envNames: ['TOKEN'] },
  }
  assert.equal(getMcpEndpointLabel(stdio), '/usr/bin/tool --safe')
  assert.deepEqual(getMcpCredentialNames(stdio), ['TOKEN'])
})
