import assert from 'node:assert/strict'
import test from 'node:test'
import Database from 'better-sqlite3'
import { AIConversationService } from '../electron/ai/conversationService.ts'
import { createAIConversationHandlers } from '../electron/ai/ipc.ts'
import { initializeAISchema } from '../electron/ai/schema.ts'

function setup() {
  const db = new Database(':memory:')
  initializeAISchema(db)
  const providerId = Number(
    db
      .prepare(
        `
        INSERT INTO ai_providers (
          name, protocol, base_url, capabilities_json, text_model, enabled
        ) VALUES ('Provider', 'openai_compatible', 'https://api.test/v1', '["text","streaming"]', 'chat', 1)
        `,
      )
      .run().lastInsertRowid,
  )
  const agentId = Number(
    db
      .prepare(
        `
        INSERT INTO ai_agents (
          name, system_prompt, text_provider_id, model_params_json, context_json,
          allowed_tools_json, blocked_tools_json, enabled, configuration_status
        ) VALUES ('Agent', 'Stay concise.', ?, '{}', '{"maxMessages":20}', '[]', '[]', 1, 'ready')
        `,
      )
      .run(providerId).lastInsertRowid,
  )
  const active = new Set()
  const handlers = createAIConversationHandlers({
    getDb: () => db,
    getRuntime: () => ({ isConversationActive: (id) => active.has(id) }),
  })
  return { db, agentId, active, handlers }
}

test('conversation IPC creates snapshot-backed conversations and manages their history state', async () => {
  const context = setup()
  const created = await context.handlers['ai:conversations:create']({}, {
    title: 'Project plan',
    agentId: context.agentId,
    agentSnapshot: { systemPrompt: 'Renderer must not control this.' },
  })
  assert.equal(created.success, true)
  assert.equal(created.data.agentSnapshot.systemPrompt, 'Stay concise.')

  const conversationId = created.data.id
  const service = new AIConversationService(context.db)
  service.createMessage({
    conversationId,
    role: 'user',
    parts: [{ type: 'text', text: 'Draft a plan' }],
  })
  const messages = await context.handlers['ai:conversations:messages']({}, { conversationId, limit: 50 })
  assert.equal(messages.success, true)
  assert.equal(messages.data[0].parts[0].text, 'Draft a plan')

  const event = await context.handlers['ai:conversations:upsertModelSwitchEvent']({}, {
    conversationId,
    afterMessageId: messages.data[0].id,
    payload: {
      fromAgentId: context.agentId,
      fromProvider: 'Provider',
      fromModel: 'chat',
      toAgentId: context.agentId + 1,
      toProvider: 'Provider Two',
      toModel: 'chat-v2',
    },
  })
  assert.equal(event.success, true)
  const events = await context.handlers['ai:conversations:events']({}, { conversationId })
  assert.deepEqual(events.data, [event.data])
  const removedEvent = await context.handlers['ai:conversations:deleteModelSwitchEvent']({}, {
    conversationId,
    afterMessageId: messages.data[0].id,
  })
  assert.deepEqual(removedEvent.data, { deleted: true })

  assert.equal((await context.handlers['ai:conversations:rename']({}, { id: conversationId, title: 'Renamed' })).data.title, 'Renamed')
  assert.equal((await context.handlers['ai:conversations:setPinned']({}, { id: conversationId, pinned: true })).data.isPinned, true)
  assert.equal((await context.handlers['ai:conversations:setArchived']({}, { id: conversationId, archived: true })).data.isArchived, true)
  const archived = await context.handlers['ai:conversations:list']({}, { archived: true })
  assert.deepEqual(archived.data.map((item) => item.id), [conversationId])

  context.active.add(conversationId)
  const blockedDelete = await context.handlers['ai:conversations:delete']({}, { id: conversationId })
  assert.equal(blockedDelete.success, false)
  assert.equal(blockedDelete.error.code, 'invalid_input')
  context.active.delete(conversationId)
  const deleted = await context.handlers['ai:conversations:delete']({}, { id: conversationId })
  assert.deepEqual(deleted.data, { deleted: true, deletedMediaAssets: [], preservedMediaCount: 0 })
  context.db.close()
})
