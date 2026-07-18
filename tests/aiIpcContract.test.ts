import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import {
  AI_CONFIG_CHANNELS,
  AI_CONVERSATION_CHANNELS,
  AI_MCP_RUNTIME_CHANNELS,
  AI_RUNTIME_CHANNELS,
  createAIConfigHandlers,
  createAIConversationHandlers,
  createAIMcpRuntimeHandlers,
  createAIRuntimeHandlers,
} from '../electron/ai/ipc.ts'

test('AI configuration IPC exposes only the approved channel whitelist', () => {
  assert.equal(AI_CONFIG_CHANNELS.length, 28)
  assert.equal(new Set(AI_CONFIG_CHANNELS).size, AI_CONFIG_CHANNELS.length)
  assert.equal(
    AI_CONFIG_CHANNELS.some((channel) => /runtime|credential:reveal|shell|sql/i.test(channel)),
    false,
  )
})

test('preload exposes structured AI methods without runtime credentials or generic execution', () => {
  const preload = readFileSync(path.resolve('electron/preload.ts'), 'utf8')
  for (const method of [
    'listAIProviders',
    'createAIProvider',
    'listAIAgents',
    'listAIMcpServers',
    'connectAIMcpServer',
    'disconnectAIMcpServer',
    'refreshAIMcpTools',
    'listAIConversations',
    'listAIConversationMessages',
    'startAIRun',
    'cancelAIRun',
    'approveAITool',
    'onAIRunEvent',
  ]) {
    assert.match(preload, new RegExp(`${method}:`))
  }
  assert.doesNotMatch(preload, /getAIMcpRuntime|getAIProviderCredential|executeAICommand|callAIMcpTool|ai:sql/)
})

test('MCP runtime IPC exposes connection diagnostics without a renderer tool execution channel', async () => {
  assert.deepEqual(AI_MCP_RUNTIME_CHANNELS, [
    'ai:mcpRuntime:connect',
    'ai:mcpRuntime:disconnect',
    'ai:mcpRuntime:refreshTools',
  ])
  let opened = 0
  const handlers = createAIMcpRuntimeHandlers({
    getManager: () => {
      opened += 1
      throw new Error('should not create manager')
    },
  })
  const invalid = await handlers['ai:mcpRuntime:connect']({}, { id: 0 })
  assert.equal(invalid.success, false)
  assert.equal(invalid.error.code, 'invalid_input')
  assert.equal(opened, 0)
})

test('AI conversation IPC validates identifiers before opening the isolated database', async () => {
  let opened = 0
  const handlers = createAIConversationHandlers({
    getDb: () => {
      opened += 1
      throw new Error('should not open database')
    },
    getRuntime: () => ({ isConversationActive: () => false }),
  })
  assert.equal(AI_CONVERSATION_CHANNELS.length, 9)
  assert.equal(new Set(AI_CONVERSATION_CHANNELS).size, AI_CONVERSATION_CHANNELS.length)
  const result = await handlers['ai:conversations:messages']({}, { conversationId: 0 })
  assert.equal(result.success, false)
  assert.equal(result.error.code, 'invalid_input')
  assert.equal(opened, 0)
})

test('AI runtime IPC is isolated from configuration and exposes only scoped run commands', async () => {
  assert.deepEqual(AI_RUNTIME_CHANNELS, ['ai:runs:start', 'ai:runs:cancel', 'ai:runs:approveTool'])
  assert.equal(AI_RUNTIME_CHANNELS.some((channel) => AI_CONFIG_CHANNELS.includes(channel as any)), false)
  const calls: unknown[] = []
  const handlers = createAIRuntimeHandlers({
    getRuntime: () => ({
      start: (payload) => {
        calls.push(payload)
        return { runId: 4 }
      },
      cancel: (conversationId, runId) => {
        calls.push({ conversationId, runId })
        return { cancelled: true }
      },
      approve: (payload) => {
        calls.push(payload)
        return { accepted: true }
      },
    }) as any,
  })
  const started = await handlers['ai:runs:start']({}, {
    conversationId: 1,
    agentId: 2,
    text: 'Hello',
    attachmentAssetIds: [],
  })
  const cancelled = await handlers['ai:runs:cancel']({}, { conversationId: 1, runId: 4 })
  const approved = await handlers['ai:runs:approveTool']({}, {
    runId: 4,
    toolCallId: 'call-1',
    decision: 'approve_once',
  })
  assert.deepEqual(started, { success: true, data: { runId: 4 } })
  assert.deepEqual(cancelled, { success: true, data: { cancelled: true } })
  assert.deepEqual(approved, { success: true, data: { accepted: true } })
  assert.equal(calls.length, 3)
})

test('AI IPC serializes invalid IDs and capabilities instead of invoking services', async () => {
  let opened = 0
  const handlers = createAIConfigHandlers({
    getDb: () => {
      opened += 1
      throw new Error('should not open database')
    },
    getCredentialFilePath: () => '/tmp/unused',
    getCredentialCryptoAdapter: () => ({
      isAvailable: () => true,
      encrypt: (value) => Buffer.from(value),
      decrypt: (value) => value.toString(),
    }),
  })
  const invalidId = await handlers['ai:providers:get']({}, { id: 0 })
  assert.deepEqual(invalidId, {
    success: false,
    error: { code: 'invalid_input', message: 'Invalid id.', retryable: false },
  })
  const invalidCapability = await handlers['ai:providers:setDefault'](
    {},
    { id: 1, capability: 'sql' },
  )
  assert.equal(invalidCapability.success, false)
  assert.equal(invalidCapability.error.code, 'invalid_input')
  assert.equal(opened, 0)
})

test('AI IPC returns actionable validation issues without leaking credential fields', async () => {
  const fakeDb = { pragma: () => undefined } as any
  const handlers = createAIConfigHandlers({
    getDb: () => fakeDb,
    getCredentialFilePath: () => '/tmp/unused',
    getCredentialCryptoAdapter: () => ({
      isAvailable: () => true,
      encrypt: (value) => Buffer.from(value),
      decrypt: (value) => value.toString(),
    }),
  })
  const result = await handlers['ai:providers:create']({}, { name: '' })
  assert.equal(result.success, false)
  assert.equal(result.error.code, 'invalid_input')
  assert.equal(Array.isArray(result.error.issues), true)
  assert.doesNotMatch(JSON.stringify(result), /apiKey|Authorization/)
})
