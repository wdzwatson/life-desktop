import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import {
  AI_CONFIG_CHANNELS,
  AI_CONVERSATION_CHANNELS,
  AI_MCP_RUNTIME_CHANNELS,
  AI_IMAGE_CHANNELS,
  AI_VIDEO_CHANNELS,
  AI_STORAGE_CHANNELS,
  AI_RUNTIME_CHANNELS,
  createAIConfigHandlers,
  createAIConversationHandlers,
  createAIImageHandlers,
  createAIMcpRuntimeHandlers,
  createAIRuntimeHandlers,
  createAIVideoHandlers,
  createAIStorageHandlers,
} from '../electron/ai/ipc.ts'

test('AI configuration IPC exposes only the approved channel whitelist', () => {
  assert.equal(AI_CONFIG_CHANNELS.length, 33)
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
    'listAIModels',
    'createAIModel',
    'updateAIModel',
    'deleteAIModel',
    'syncAIModels',
    'listAIAgents',
    'listAIMcpServers',
    'connectAIMcpServer',
    'disconnectAIMcpServer',
    'refreshAIMcpTools',
    'listAIConversations',
    'listAIConversationMessages',
    'listAIConversationEvents',
    'upsertAIModelSwitchEvent',
    'deleteAIModelSwitchEvent',
    'startAIRun',
    'cancelAIRun',
    'approveAITool',
    'onAIRunEvent',
    'generateAIImages',
    'cancelAIImageGeneration',
    'generateAIVideos',
    'cancelAIVideoGeneration',
    'getAIStorageUsage',
    'previewAIStorageCleanup',
    'cleanAIStorage',
    'saveAIAsset',
    'revealAIAsset',
  ]) {
    assert.match(preload, new RegExp(`${method}:`))
  }
  assert.doesNotMatch(preload, /getAIMcpRuntime|getAIProviderCredential|executeAICommand|callAIMcpTool|ai:sql/)
})

test('image runtime exposes only generation while media files remain behind asset IDs', () => {
  assert.deepEqual(AI_IMAGE_CHANNELS, ['ai:images:generate', 'ai:images:cancel'])
  assert.deepEqual(AI_VIDEO_CHANNELS, ['ai:videos:generate', 'ai:videos:cancel'])
  const preload = readFileSync(path.resolve('electron/preload.ts'), 'utf8')
  assert.doesNotMatch(preload, /getAIAssetPath|readAIAssetFile|downloadRemoteAIAsset|getAIVideoUrl/)
})

test('image and video generation expose scoped cancellation by conversation', async () => {
  for (const mediaType of ['images', 'videos'] as const) {
    const controller = new AbortController()
    let observedAbort = false
    const dependencies = {
      getService: () => ({
        generate: async ({ signal }: { signal?: AbortSignal }) => new Promise((resolve) => {
          signal?.addEventListener('abort', () => {
            observedAbort = true
            resolve({ aborted: true })
          }, { once: true })
        }),
      }),
      createAbortScope: () => ({
        signal: controller.signal,
        abort: () => controller.abort(),
        dispose: () => undefined,
      }),
    }
    const handlers = mediaType === 'images'
      ? createAIImageHandlers(dependencies as any)
      : createAIVideoHandlers(dependencies as any)
    const generate = handlers[`ai:${mediaType}:generate`]({}, {
      conversationId: 7,
      agentId: 3,
      prompt: 'A calm landscape',
    })
    await Promise.resolve()
    const cancelled = await handlers[`ai:${mediaType}:cancel`]({}, { conversationId: 7 })
    const completed = await generate

    assert.equal(cancelled.success, true)
    assert.equal(cancelled.data.cancelled, true)
    assert.equal(completed.success, true)
    assert.equal(observedAbort, true)
  }
})

test('video generation IPC validates identifiers before creating a provider service', async () => {
  let opened = 0
  const handlers = createAIVideoHandlers({
    getService: () => {
      opened += 1
      throw new Error('should not create service')
    },
  })
  const invalid = await handlers['ai:videos:generate']({}, {
    conversationId: 0,
    agentId: 2,
    prompt: 'A moving landscape',
  })
  assert.equal(invalid.success, false)
  assert.equal(invalid.error.code, 'invalid_input')
  assert.equal(opened, 0)
})

test('AI storage IPC exposes preview-gated cleanup and validates scope before opening storage', async () => {
  assert.deepEqual(AI_STORAGE_CHANNELS, [
    'ai:storage:usage',
    'ai:storage:previewCleanup',
    'ai:storage:cleanup',
  ])
  let opened = 0
  const handlers = createAIStorageHandlers({
    getService: () => {
      opened += 1
      throw new Error('should not create service')
    },
  })
  const invalidScope = await handlers['ai:storage:previewCleanup']({}, { scope: 'filesystem' })
  assert.equal(invalidScope.success, false)
  assert.equal(invalidScope.error.code, 'invalid_input')
  const missingPreview = await handlers['ai:storage:cleanup']({}, { scope: 'all_media' })
  assert.equal(missingPreview.success, false)
  assert.equal(missingPreview.error.code, 'invalid_input')
  assert.equal(opened, 0)
  const preload = readFileSync(path.resolve('electron/preload.ts'), 'utf8')
  assert.doesNotMatch(preload, /deleteAIFile|cleanDirectory|listAIFilePaths|ai:storage:execute/)
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
  assert.equal(AI_CONVERSATION_CHANNELS.length, 12)
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
