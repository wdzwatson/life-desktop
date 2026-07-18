import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import Database from 'better-sqlite3'
import { AIConversationService } from '../electron/ai/conversationService.ts'
import { initializeAISchema } from '../electron/ai/schema.ts'
import { AIServiceError } from '../electron/ai/types.ts'

function setup() {
  const db = new Database(':memory:')
  initializeAISchema(db)
  const providerId = Number(
    db
      .prepare(
        `
        INSERT INTO ai_providers (
          name, protocol, base_url, capabilities_json, text_model, image_model, enabled
        ) VALUES ('Provider', 'openai_compatible', 'https://api.test/v1', '["text","image"]', 'chat', 'image', 1)
        `,
      )
      .run().lastInsertRowid,
  )
  const agentId = Number(
    db
      .prepare(
        `
        INSERT INTO ai_agents (
          name, text_provider_id, image_provider_id, model_params_json, context_json,
          allowed_tools_json, blocked_tools_json
        ) VALUES ('Agent', ?, ?, '{}', '{}', '[]', '[]')
        `,
      )
      .run(providerId, providerId).lastInsertRowid,
  )
  const mcpId = Number(
    db
      .prepare("INSERT INTO ai_mcp_servers (name, transport, connection_json) VALUES ('Tools', 'stdio', '{}')")
      .run().lastInsertRowid,
  )
  let now = new Date('2026-07-18T01:00:00.000Z')
  const service = new AIConversationService(db, () => now)
  const advance = (iso) => {
    now = new Date(iso)
  }
  return { db, service, providerId, agentId, mcpId, advance }
}

function createConversation(context, overrides = {}) {
  return context.service.createConversation({
    title: 'Project chat',
    agentId: context.agentId,
    agentSnapshot: { name: 'Agent', providers: { text: { id: context.providerId, model: 'chat' } } },
    ...overrides,
  })
}

test('conversation lifecycle preserves immutable agent snapshots and supports search', () => {
  const context = setup()
  const snapshot = { name: 'Agent', nested: { model: 'chat' } }
  const first = createConversation(context, { title: 'Research plan', agentSnapshot: snapshot })
  snapshot.nested.model = 'changed'
  context.advance('2026-07-18T02:00:00.000Z')
  const second = createConversation(context, { title: 'Draft notes' })
  context.service.createMessage({
    conversationId: second.id,
    role: 'user',
    parts: [{ type: 'text', text: 'Find the launch checklist' }],
  })

  assert.equal(context.service.getConversation(first.id).agentSnapshot.nested.model, 'chat')
  assert.deepEqual(context.service.listConversations({ search: 'research' }).map((item) => item.id), [first.id])
  assert.deepEqual(context.service.listConversations({ search: 'launch checklist' }).map((item) => item.id), [second.id])
  assert.equal(context.service.renameConversation(first.id, 'Renamed').title, 'Renamed')
  assert.equal(context.service.setConversationPinned(first.id, true).isPinned, true)
  assert.equal(context.service.listConversations()[0].id, first.id)
  assert.equal(context.service.setConversationArchived(first.id, true).isArchived, true)
  assert.equal(context.service.listConversations().some((item) => item.id === first.id), false)
  assert.equal(context.service.listConversations({ archived: true })[0].id, first.id)
  context.db.close()
})

test('messages preserve ordered heterogeneous content blocks and paginate chronologically', () => {
  const context = setup()
  const conversation = createConversation(context)
  const asset = context.service.createMediaAssetRecord({
    providerId: context.providerId,
    mediaType: 'image',
    mimeType: 'image/png',
    localPath: '/tmp/image.png',
    status: 'completed',
  })
  const first = context.service.createMessage({
    conversationId: conversation.id,
    role: 'user',
    parts: [
      { type: 'text', text: 'Hello' },
      { type: 'image', assetId: asset.id, mimeType: 'image/png', alt: 'Preview' },
    ],
  })
  const second = context.service.createMessage({
    conversationId: conversation.id,
    role: 'assistant',
    status: 'streaming',
    parts: [{ type: 'markdown', text: '**Ready**' }],
  })
  context.service.appendMessageParts(second.id, [
    { type: 'error', code: 'timeout', message: 'Retry later', retryable: true },
  ])
  context.service.transitionMessage(second.id, 'completed')
  const third = context.service.createMessage({
    conversationId: conversation.id,
    role: 'user',
    parts: [{ type: 'text', text: 'Continue' }],
  })

  assert.deepEqual(context.service.getMessage(first.id).parts.map((part) => part.type), ['text', 'image'])
  assert.deepEqual(context.service.getMessage(second.id).parts.map((part) => part.type), ['markdown', 'error'])
  assert.deepEqual(context.service.listMessages(conversation.id, { limit: 2 }).map((item) => item.id), [second.id, third.id])
  assert.deepEqual(context.service.listMessages(conversation.id, { beforeId: third.id, limit: 2 }).map((item) => item.id), [first.id, second.id])
  assert.equal(context.service.getConversation(conversation.id).messageCount, 3)
  context.db.close()
})

test('message transitions cannot reopen terminal messages', () => {
  const context = setup()
  const conversation = createConversation(context)
  const message = context.service.createMessage({
    conversationId: conversation.id,
    role: 'assistant',
    status: 'pending',
  })
  context.advance('2026-07-18T01:01:00.000Z')
  const streaming = context.service.transitionMessage(message.id, 'streaming', 'provider-message')
  assert.equal(streaming.startedAt, '2026-07-18T01:01:00.000Z')
  context.advance('2026-07-18T01:02:00.000Z')
  const completed = context.service.transitionMessage(message.id, 'completed')
  assert.equal(completed.providerMessageId, 'provider-message')
  assert.equal(completed.completedAt, '2026-07-18T01:02:00.000Z')
  assert.throws(() => context.service.transitionMessage(message.id, 'streaming'), /Invalid message transition/)
  context.db.close()
})

test('run transitions save usage and enforce one-way terminal states', () => {
  const context = setup()
  const conversation = createConversation(context)
  const user = context.service.createMessage({ conversationId: conversation.id, role: 'user' })
  const assistant = context.service.createMessage({ conversationId: conversation.id, role: 'assistant', status: 'pending' })
  const run = context.service.createRun({
    conversationId: conversation.id,
    triggerMessageId: user.id,
    assistantMessageId: assistant.id,
    agentSnapshot: { version: 1, model: 'chat' },
  })
  context.advance('2026-07-18T01:03:00.000Z')
  assert.equal(context.service.transitionRun(run.id, 'running', { currentStage: 'provider_request' }).startedAt, '2026-07-18T01:03:00.000Z')
  context.advance('2026-07-18T01:04:00.000Z')
  const completed = context.service.transitionRun(run.id, 'completed', {
    usage: { inputTokens: 10, outputTokens: 20, apiKey: 'must-not-persist' },
    providerRequestId: 'request-1',
  })
  assert.deepEqual(completed.usage, { inputTokens: 10, outputTokens: 20, apiKey: '[REDACTED]' })
  assert.equal(completed.completedAt, '2026-07-18T01:04:00.000Z')
  assert.throws(() => context.service.transitionRun(run.id, 'running'), /Invalid AI run transition/)
  context.db.close()
})

test('tool calls store redacted inputs and follow approval execution transitions', () => {
  const context = setup()
  const conversation = createConversation(context)
  const run = context.service.createRun({ conversationId: conversation.id, agentSnapshot: { version: 1 }, status: 'running' })
  const toolCall = context.service.createToolCall({
    runId: run.id,
    toolCallKey: 'call-1',
    mcpServerId: context.mcpId,
    toolName: 'research.publish',
    riskLevel: 'external_side_effect',
    approvalStatus: 'waiting',
    status: 'waiting_for_approval',
    input: { topic: 'release', Authorization: 'Bearer secret', nested: { apiKey: 'secret' } },
  })
  assert.deepEqual(toolCall.input, {
    topic: 'release',
    Authorization: '[REDACTED]',
    nested: { apiKey: '[REDACTED]' },
  })
  context.service.transitionToolCall(toolCall.id, 'approved', { approvalStatus: 'approved_once' })
  context.service.transitionToolCall(toolCall.id, 'running')
  const completed = context.service.transitionToolCall(toolCall.id, 'completed', { resultSummary: 'Published' })
  assert.equal(completed.resultSummary, 'Published')
  assert.throws(() => context.service.transitionToolCall(toolCall.id, 'running'), /Invalid tool call transition/)
  assert.equal(context.service.listToolCalls(run.id).length, 1)
  context.db.close()
})

test('conversation deletion optionally removes only media that lost every reference', () => {
  const context = setup()
  const first = createConversation(context, { title: 'First' })
  const second = createConversation(context, { title: 'Second' })
  const shared = context.service.createMediaAssetRecord({
    mediaType: 'image',
    mimeType: 'image/png',
    localPath: '/tmp/shared.png',
    sourceUrl: 'https://user:pass@example.test/image.png?token=secret#fragment',
  })
  const unique = context.service.createMediaAssetRecord({
    mediaType: 'video',
    mimeType: 'video/mp4',
    localPath: '/tmp/unique.mp4',
  })
  context.service.createMessage({
    conversationId: first.id,
    role: 'assistant',
    parts: [
      { type: 'image', assetId: shared.id, mimeType: 'image/png' },
      { type: 'video', assetId: unique.id, mimeType: 'video/mp4' },
    ],
  })
  context.service.createMessage({
    conversationId: second.id,
    role: 'assistant',
    parts: [{ type: 'image', assetId: shared.id, mimeType: 'image/png' }],
  })
  assert.equal(context.service.getMediaAsset(shared.id).sourceUrlRedacted, 'https://example.test/image.png')
  const result = context.service.deleteConversation(first.id, { deleteUnreferencedMedia: true })
  assert.deepEqual(result.deletedMediaAssets.map((asset) => asset.id), [unique.id])
  assert.equal(result.preservedMediaCount, 1)
  assert.equal(context.service.getMediaAsset(shared.id).id, shared.id)
  assert.throws(() => context.service.getMediaAsset(unique.id), (error) => error instanceof AIServiceError && error.detail.code === 'not_found')
  context.db.close()
})

test('conversation deletion preserves media by default for later cleanup', () => {
  const context = setup()
  const conversation = createConversation(context)
  const asset = context.service.createMediaAssetRecord({ mediaType: 'file', mimeType: 'application/pdf' })
  context.service.createMessage({
    conversationId: conversation.id,
    role: 'user',
    parts: [{ type: 'file', assetId: asset.id, mimeType: 'application/pdf' }],
  })
  const result = context.service.deleteConversation(conversation.id)
  assert.equal(result.deletedMediaAssets.length, 0)
  assert.equal(result.preservedMediaCount, 1)
  assert.equal(context.service.getMediaAsset(asset.id).id, asset.id)
  context.db.close()
})

test('cross-conversation message and run references are rejected', () => {
  const context = setup()
  const first = createConversation(context, { title: 'First' })
  const second = createConversation(context, { title: 'Second' })
  const message = context.service.createMessage({ conversationId: first.id, role: 'user' })
  assert.throws(
    () => context.service.createMessage({ conversationId: second.id, role: 'assistant', parentMessageId: message.id }),
    /does not belong/,
  )
  assert.throws(
    () => context.service.createRun({ conversationId: second.id, triggerMessageId: message.id, agentSnapshot: {} }),
    /does not belong/,
  )
  context.db.close()
})

test('conversation structure remains recoverable after reopening the AI database', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'lifeos-ai-conversation-'))
  const databasePath = path.join(directory, 'ai.db')
  const firstDb = new Database(databasePath)
  initializeAISchema(firstDb)
  const firstService = new AIConversationService(firstDb, () => new Date('2026-07-18T05:00:00Z'))
  const conversation = firstService.createConversation({ title: 'Persistent chat', agentSnapshot: { version: 1 } })
  firstService.createMessage({
    conversationId: conversation.id,
    role: 'user',
    parts: [{ type: 'text', text: 'Persist this message' }],
  })
  firstDb.close()

  const reopenedDb = new Database(databasePath)
  initializeAISchema(reopenedDb)
  const reopenedService = new AIConversationService(reopenedDb)
  assert.equal(reopenedService.getConversation(conversation.id).title, 'Persistent chat')
  assert.equal(reopenedService.listMessages(conversation.id)[0].parts[0].text, 'Persist this message')
  reopenedDb.close()
})
