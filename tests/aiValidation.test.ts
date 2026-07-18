import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AIValidationError,
  parseAIAgentConfigInput,
  parseAIMcpServerInput,
  parseAIProviderConfigInput,
  parseAIStartRunInput,
  parseAIToolApprovalInput,
} from '../electron/ai/validation.ts'

const providerInput = () => ({
  name: 'Primary Provider',
  protocol: 'openai_compatible',
  baseUrl: 'https://api.example.test/v1/',
  apiKey: 'secret-key',
  defaultHeaders: { 'X-Workspace': 'lifeos' },
  capabilities: ['text', 'streaming', 'tool_calling'],
  models: { text: 'chat-model' },
  timeoutMs: 60_000,
  allowLocalNetwork: false,
  enabled: true,
})

test('provider validation normalizes URLs and deduplicates capabilities', () => {
  const parsed = parseAIProviderConfigInput({
    ...providerInput(),
    capabilities: ['text', 'streaming', 'text'],
  })
  assert.equal(parsed.baseUrl, 'https://api.example.test/v1')
  assert.deepEqual(parsed.capabilities, ['text', 'streaming'])
  assert.equal(parsed.models.text, 'chat-model')
})

test('provider validation rejects unknown fields, unsafe URLs, and missing capability models', () => {
  assert.throws(
    () => parseAIProviderConfigInput({ ...providerInput(), rawFetch: true }),
    (error) => error instanceof AIValidationError && error.issues[0].path === 'provider.rawFetch',
  )
  assert.throws(
    () => parseAIProviderConfigInput({ ...providerInput(), baseUrl: 'file:///tmp/model' }),
    /only http and https URLs are allowed/,
  )
  assert.throws(
    () =>
      parseAIProviderConfigInput({
        ...providerInput(),
        capabilities: ['text', 'image'],
      }),
    /provider.models.image/,
  )
})

test('provider validation rejects credentials embedded in URLs and invalid headers', () => {
  assert.throws(
    () => parseAIProviderConfigInput({ ...providerInput(), baseUrl: 'https://user:pass@example.test/v1' }),
    /credentials must not be embedded/,
  )
  assert.throws(
    () => parseAIProviderConfigInput({ ...providerInput(), defaultHeaders: { 'Bad Header': 'value' } }),
    /invalid header name/,
  )
  assert.throws(
    () =>
      parseAIProviderConfigInput({
        ...providerInput(),
        defaultHeaders: { Authorization: 'Bearer safe\r\nX-Injected: true' },
      }),
    /control line breaks/,
  )
})

test('agent validation normalizes IDs, tools, and model parameters', () => {
  const parsed = parseAIAgentConfigInput({
    name: 'Research Agent',
    description: '',
    systemPrompt: 'Use verified sources.',
    textProviderId: 1,
    imageProviderId: 2,
    mcpServerIds: [4, 4, 6],
    allowedTools: ['search', 'search'],
    blockedTools: ['delete'],
    toolApprovalMode: 'confirm_risky',
    maxToolCalls: 8,
    temperature: 0.2,
    context: { maxMessages: 50, maxOutputTokens: 8_000 },
    enabled: true,
    isDefault: true,
  })
  assert.deepEqual(parsed.mcpServerIds, [4, 6])
  assert.deepEqual(parsed.allowedTools, ['search'])
  assert.equal(parsed.context.maxMessages, 50)
})

test('agent validation enforces tool loop and temperature limits', () => {
  const base = {
    name: 'Agent',
    description: '',
    systemPrompt: '',
    textProviderId: 1,
    mcpServerIds: [],
    allowedTools: [],
    blockedTools: [],
    toolApprovalMode: 'confirm_risky',
    maxToolCalls: 8,
    context: { maxMessages: 20 },
    enabled: true,
    isDefault: false,
  }
  assert.throws(() => parseAIAgentConfigInput({ ...base, maxToolCalls: 33 }), /between 0 and 32/)
  assert.throws(() => parseAIAgentConfigInput({ ...base, temperature: 2.5 }), /between 0 and 2/)
})

test('MCP validation supports HTTP and stdio without accepting arbitrary fields', () => {
  assert.deepEqual(
    parseAIMcpServerInput({
      name: 'Remote Tools',
      description: '',
      enabled: true,
      timeoutMs: 30_000,
      connection: {
        transport: 'streamable_http',
        url: 'https://mcp.example.test/',
        headers: { Authorization: 'Bearer token' },
      },
    }).connection,
    {
      transport: 'streamable_http',
      url: 'https://mcp.example.test',
      headers: { Authorization: 'Bearer token' },
    },
  )

  const stdio = parseAIMcpServerInput({
    name: 'Local Tools',
    description: 'Local MCP server',
    enabled: true,
    timeoutMs: 30_000,
    connection: {
      transport: 'stdio',
      command: '/usr/local/bin/mcp-server',
      args: ['--read-only'],
      cwd: '/tmp',
      env: { MCP_TOKEN: 'secret' },
    },
  })
  assert.equal(stdio.connection.transport, 'stdio')
  assert.throws(
    () =>
      parseAIMcpServerInput({
        name: 'Unsafe',
        description: '',
        enabled: true,
        timeoutMs: 30_000,
        connection: {
          transport: 'stdio',
          command: 'server',
          args: [],
          env: {},
          shell: true,
        },
      }),
    /mcp.connection.shell/,
  )
  assert.throws(
    () =>
      parseAIMcpServerInput({
        name: 'Unsafe command',
        description: '',
        enabled: true,
        timeoutMs: 30_000,
        connection: {
          transport: 'stdio',
          command: 'server\nsecond-command',
          args: [],
          env: {},
        },
      }),
    /control line breaks/,
  )
})

test('run and approval validators reject empty or out-of-range payloads', () => {
  assert.deepEqual(
    parseAIStartRunInput({
      conversationId: 10,
      agentId: 2,
      text: 'Hello',
      attachmentAssetIds: [3, 3, 4],
    }),
    { conversationId: 10, agentId: 2, text: 'Hello', attachmentAssetIds: [3, 4] },
  )
  assert.throws(
    () => parseAIStartRunInput({ conversationId: 0, agentId: 2, text: 'Hello', attachmentAssetIds: [] }),
    /run.conversationId/,
  )
  assert.deepEqual(
    parseAIToolApprovalInput({ runId: 1, toolCallId: 'call-1', decision: 'reject' }),
    { runId: 1, toolCallId: 'call-1', decision: 'reject' },
  )
  assert.throws(
    () => parseAIToolApprovalInput({ runId: 1, toolCallId: 'call-1', decision: 'always' }),
    /unsupported decision/,
  )
})
