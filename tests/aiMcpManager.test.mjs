import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { AIMcpConfigService } from '../electron/ai/mcpConfigService.ts'
import { AIMcpManager, redactMcpDiagnostic, redactMcpToolResult } from '../electron/ai/mcpManager.ts'
import { initializeAISchema } from '../electron/ai/schema.ts'
import { AIServiceError } from '../electron/ai/types.ts'

function credentialStore() {
  const values = new Map()
  let next = 1
  return {
    create(value) {
      const ref = `cred_00000000-0000-4000-8000-${String(next++).padStart(12, '0')}`
      values.set(ref, value)
      return ref
    },
    replace(ref, value) {
      values.set(ref, value)
    },
    reveal(ref) {
      if (!values.has(ref)) throw new Error('missing credential')
      return values.get(ref)
    },
    delete(ref) {
      return values.delete(ref)
    },
  }
}

function setup() {
  const db = new Database(':memory:')
  initializeAISchema(db)
  const config = new AIMcpConfigService(db, credentialStore())
  const manager = new AIMcpManager({ getConfigService: () => config })
  return { db, config, manager }
}

function resultText(result) {
  return result.content?.find((item) => item.type === 'text')?.text ?? ''
}

async function waitFor(check, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) return true
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  return false
}

function registerFixtureTools(server) {
  server.registerTool(
    'fixture.add',
    {
      description: 'Add two numbers.',
      inputSchema: { a: z.number(), b: z.number() },
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
    async ({ a, b }) => ({ content: [{ type: 'text', text: String(a + b) }] }),
  )
}

async function startHttpFixture() {
  const app = createMcpExpressApp()
  app.post('/mcp', async (request, response) => {
    const server = new McpServer({ name: 'http-fixture', version: '1.0.0' })
    registerFixtureTools(server)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    await server.connect(transport)
    await transport.handleRequest(request, response, request.body)
    response.on('close', () => {
      void transport.close()
      void server.close()
    })
  })
  app.get('/mcp', (_request, response) => response.status(405).end())
  app.delete('/mcp', (_request, response) => response.status(405).end())
  const httpServer = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance))
  })
  const address = httpServer.address()
  if (!address || typeof address === 'string') throw new Error('HTTP fixture did not start.')
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    close: () => new Promise((resolve) => httpServer.close(() => resolve())),
  }
}

async function startSseFixture() {
  const app = createMcpExpressApp()
  const transports = new Map()
  app.get('/sse', async (_request, response) => {
    const transport = new SSEServerTransport('/messages', response)
    const server = new McpServer({ name: 'sse-fixture', version: '1.0.0' })
    registerFixtureTools(server)
    transports.set(transport.sessionId, { transport, server })
    transport.onclose = () => transports.delete(transport.sessionId)
    await server.connect(transport)
  })
  app.post('/messages', async (request, response) => {
    const entry = transports.get(String(request.query.sessionId ?? ''))
    if (!entry) return response.status(404).end()
    await entry.transport.handlePostMessage(request, response, request.body)
  })
  const httpServer = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance))
  })
  const address = httpServer.address()
  if (!address || typeof address === 'string') throw new Error('SSE fixture did not start.')
  return {
    url: `http://127.0.0.1:${address.port}/sse`,
    close: async () => {
      await Promise.allSettled(
        [...transports.values()].flatMap(({ transport, server }) => [transport.close(), server.close()]),
      )
      await new Promise((resolve) => httpServer.close(() => resolve()))
    },
  }
}

test('stdio MCP discovery and calls preserve argument arrays and dispose the child process', async () => {
  const context = setup()
  const fixturePath = path.resolve('tests/fixtures/mcpStdioServer.mjs')
  const server = context.config.create({
    name: 'stdio fixture',
    description: '',
    enabled: true,
    timeoutMs: 4_000,
    connection: {
      transport: 'stdio',
      command: process.execPath,
      args: [fixturePath, '--marker', 'value with spaces'],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    },
  })
  const connected = await context.manager.connect(server.id)
  assert.deepEqual(connected.tools.map((tool) => tool.name).sort(), [
    'fixture.echo',
    'fixture.slow',
    'fixture.terminate',
  ])
  const result = await context.manager.callTool({
    serverId: server.id,
    toolName: 'fixture.echo',
    arguments: { text: 'hello' },
  })
  const payload = JSON.parse(resultText(result))
  assert.equal(payload.text, 'hello')
  assert.deepEqual(payload.argv.slice(-2), ['--marker', 'value with spaces'])
  assert.equal(context.config.get(server.id).connectionStatus, 'connected')
  assert.match(context.config.get(server.id).protocolVersion ?? '', /^\d{4}-\d{2}-\d{2}$/)
  await context.manager.dispose()
  assert.equal(await waitFor(() => {
    try {
      process.kill(payload.pid, 0)
      return false
    } catch {
      return true
    }
  }), true)
  context.db.close()
})

test('stdio MCP calls support cancellation, unexpected exit detection, and reconnect', async () => {
  const context = setup()
  const server = context.config.create({
    name: 'stdio reconnect fixture',
    description: '',
    enabled: true,
    timeoutMs: 4_000,
    connection: {
      transport: 'stdio',
      command: process.execPath,
      args: [path.resolve('tests/fixtures/mcpStdioServer.mjs')],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    },
  })
  await context.manager.connect(server.id)
  const controller = new AbortController()
  const slowCall = context.manager.callTool(
    { serverId: server.id, toolName: 'fixture.slow', arguments: { delayMs: 5_000 } },
    { signal: controller.signal },
  )
  setTimeout(() => controller.abort(), 25)
  await assert.rejects(
    slowCall,
    (error) => error instanceof AIServiceError && error.detail.code === 'cancelled',
  )
  await assert.rejects(
    () => context.manager.callTool(
      { serverId: server.id, toolName: 'fixture.slow', arguments: { delayMs: 5_000 } },
      { timeoutMs: 1_000 },
    ),
    (error) => error instanceof AIServiceError && error.detail.code === 'timeout',
  )
  await context.manager.callTool({ serverId: server.id, toolName: 'fixture.terminate', arguments: {} })
  assert.equal(await waitFor(() => context.config.get(server.id).connectionStatus === 'failed'), true)
  const reconnected = await context.manager.connect(server.id)
  assert.equal(reconnected.connected, true)
  assert.equal(reconnected.tools.some((tool) => tool.name === 'fixture.echo'), true)
  await context.manager.dispose()
  context.db.close()
})

test('Streamable HTTP and legacy SSE transports discover and call real MCP tools', async () => {
  const http = await startHttpFixture()
  const sse = await startSseFixture()
  const context = setup()
  try {
    const httpServer = context.config.create({
      name: 'HTTP fixture',
      description: '',
      enabled: true,
      timeoutMs: 4_000,
      connection: { transport: 'streamable_http', url: http.url, headers: {} },
    })
    const sseServer = context.config.create({
      name: 'SSE fixture',
      description: '',
      enabled: true,
      timeoutMs: 4_000,
      connection: { transport: 'sse', url: sse.url, headers: {} },
    })
    for (const server of [httpServer, sseServer]) {
      const connected = await context.manager.connect(server.id)
      assert.deepEqual(connected.tools.map((tool) => tool.name), ['fixture.add'])
      const result = await context.manager.callTool({
        serverId: server.id,
        toolName: 'fixture.add',
        arguments: { a: 4, b: 7 },
      })
      assert.equal(resultText(result), '11')
    }
  } finally {
    await context.manager.dispose()
    context.db.close()
    await http.close()
    await sse.close()
  }
})

test('connection failures redact configured secrets from persisted diagnostics', async () => {
  const context = setup()
  const server = context.config.create({
    name: 'failing fixture',
    description: '',
    enabled: true,
    timeoutMs: 2_000,
    connection: {
      transport: 'stdio',
      command: process.execPath,
      args: [path.resolve('tests/fixtures/mcpStdioServer.mjs'), '--fail'],
      env: { ELECTRON_RUN_AS_NODE: '1', TEST_SECRET: 'fixture-secret-value' },
    },
  })
  await assert.rejects(() => context.manager.connect(server.id))
  const failed = context.config.get(server.id)
  assert.equal(failed.connectionStatus, 'failed')
  assert.doesNotMatch(failed.lastError.message ?? '', /fixture-secret-value/)
  assert.match(failed.lastError.message ?? '', /\[REDACTED\]/)
  const authorizationDiagnostic = redactMcpDiagnostic('Authorization: Bearer abc.def', [])
  assert.match(authorizationDiagnostic, /\[REDACTED\]/)
  assert.doesNotMatch(authorizationDiagnostic, /abc\.def/)
  await context.manager.dispose()
  context.db.close()
})

test('MCP tool results redact configured credentials before leaving the manager', () => {
  const result = redactMcpToolResult({
    content: [{ type: 'text', text: 'Bearer visible-token and configured-value' }],
    structuredContent: { apiKey: 'key-value', nested: 'configured-value' },
  }, ['configured-value'])
  assert.doesNotMatch(JSON.stringify(result), /visible-token|configured-value|key-value/)
  assert.match(JSON.stringify(result), /REDACTED/)
})
