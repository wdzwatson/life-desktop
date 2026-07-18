import assert from 'node:assert/strict'
import test from 'node:test'
import Database from 'better-sqlite3'
import { AIMcpConfigService } from '../electron/ai/mcpConfigService.ts'
import { initializeAISchema } from '../electron/ai/schema.ts'
import { AIServiceError } from '../electron/ai/types.ts'

class FakeCredentials {
  entries = new Map()
  sequence = 0
  create(secret) {
    const ref = `cred_00000000-0000-4000-8000-${String(++this.sequence).padStart(12, '0')}`
    this.entries.set(ref, secret)
    return ref
  }
  replace(ref, secret) {
    this.entries.set(ref, secret)
  }
  reveal(ref) {
    return this.entries.get(ref)
  }
  delete(ref) {
    return this.entries.delete(ref)
  }
}

function setup() {
  const db = new Database(':memory:')
  initializeAISchema(db)
  const credentials = new FakeCredentials()
  return { db, credentials, service: new AIMcpConfigService(db, credentials) }
}

const httpInput = (overrides = {}) => ({
  name: 'Remote Tools',
  description: 'Remote MCP',
  enabled: true,
  timeoutMs: 30000,
  connection: {
    transport: 'streamable_http',
    url: 'https://mcp.example.test',
    headers: { Authorization: 'Bearer secret' },
  },
  ...overrides,
})

test('MCP service stores sensitive headers outside SQLite', () => {
  const { db, service } = setup()
  const server = service.create(httpInput())
  assert.equal(server.credentialConfigured, true)
  assert.deepEqual(server.connection, { url: 'https://mcp.example.test', headerNames: ['Authorization'] })
  assert.equal(JSON.stringify(server).includes('Bearer secret'), false)
  assert.deepEqual(service.getRuntimeConnection(server.id), httpInput().connection)
  db.close()
})

test('MCP service supports stdio configuration without exposing environment values', () => {
  const { db, service } = setup()
  const server = service.create({
    name: 'Local Tools',
    description: '',
    enabled: true,
    timeoutMs: 30000,
    connection: { transport: 'stdio', command: '/usr/bin/tool', args: ['--safe'], cwd: '/tmp', env: { TOKEN: 'secret' } },
  })
  assert.deepEqual(server.connection, {
    command: '/usr/bin/tool',
    args: ['--safe'],
    cwd: '/tmp',
    envNames: ['TOKEN'],
  })
  assert.deepEqual(service.getRuntimeConnection(server.id), {
    transport: 'stdio',
    command: '/usr/bin/tool',
    args: ['--safe'],
    cwd: '/tmp',
    env: { TOKEN: 'secret' },
  })
  db.close()
})

test('MCP copy gets independent credentials and starts disabled', () => {
  const { db, credentials, service } = setup()
  const original = service.create(httpInput())
  const copy = service.copy(original.id)
  assert.equal(copy.name, 'Remote Tools Copy')
  assert.equal(copy.enabled, false)
  assert.equal(credentials.entries.size, 2)
  db.close()
})

test('MCP risk overrides can be added, changed, and removed', () => {
  const { db, service } = setup()
  const server = service.create(httpInput())
  assert.deepEqual(service.setRiskOverride(server.id, 'search', 'write').riskOverrides, { search: 'write' })
  assert.deepEqual(service.setRiskOverride(server.id, 'search', null).riskOverrides, {})
  assert.throws(() => service.setRiskOverride(server.id, 'search', 'root'), (error) => {
    return error instanceof AIServiceError && error.detail.code === 'invalid_input'
  })
  db.close()
})

test('MCP connection diagnostics preserve the latest successful timestamp', () => {
  const { db, service } = setup()
  const server = service.create(httpInput())
  const connected = service.recordConnectionResult(server.id, {
    status: 'connected',
    protocolVersion: '2025-06-18',
    toolCount: 4,
    connectedAt: '2026-07-18T04:00:00.000Z',
  })
  assert.equal(connected.toolCount, 4)
  assert.equal(connected.lastConnectedAt, '2026-07-18T04:00:00.000Z')
  const failed = service.recordConnectionResult(server.id, {
    status: 'failed',
    errorCode: 'timeout',
    errorMessage: 'Connection timed out',
  })
  assert.equal(failed.lastConnectedAt, '2026-07-18T04:00:00.000Z')
  assert.deepEqual(failed.lastError, { code: 'timeout', message: 'Connection timed out' })
  assert.throws(() => service.recordConnectionResult(server.id, { status: 'root', toolCount: -1 }), (error) => {
    return error instanceof AIServiceError && error.detail.code === 'invalid_input'
  })
  db.close()
})

test('MCP dependencies block deletion and disabling marks agents incomplete', () => {
  const { db, service } = setup()
  const server = service.create(httpInput())
  const providerId = Number(
    db
      .prepare(
        "INSERT INTO ai_providers (name, protocol, base_url, capabilities_json, text_model) VALUES ('P', 'openai_compatible', 'https://p.test', '[\"text\"]', 'm')",
      )
      .run().lastInsertRowid,
  )
  const agentId = Number(
    db
      .prepare(
        "INSERT INTO ai_agents (name, text_provider_id) VALUES ('Agent', ?)",
      )
      .run(providerId).lastInsertRowid,
  )
  db.prepare('INSERT INTO ai_agent_mcp_links (agent_id, mcp_server_id) VALUES (?, ?)').run(agentId, server.id)
  assert.throws(() => service.delete(server.id), /still used/)
  service.setEnabled(server.id, false)
  assert.equal(db.prepare('SELECT configuration_status FROM ai_agents WHERE id = ?').get(agentId).configuration_status, 'incomplete')
  db.close()
})

test('duplicate MCP names roll back newly created credentials', () => {
  const { db, credentials, service } = setup()
  service.create(httpInput())
  assert.throws(() => service.create(httpInput()), (error) => {
    return error instanceof AIServiceError && error.detail.code === 'invalid_input'
  })
  assert.equal(credentials.entries.size, 1)
  db.close()
})
