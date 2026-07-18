import assert from 'node:assert/strict'
import test from 'node:test'
import Database from 'better-sqlite3'
import { AIAgentService } from '../electron/ai/agentService.ts'
import { initializeAISchema } from '../electron/ai/schema.ts'
import { AIServiceError } from '../electron/ai/types.ts'

function setup() {
  const db = new Database(':memory:')
  initializeAISchema(db)
  const insertProvider = db.prepare(
    `
    INSERT INTO ai_providers (
      name, protocol, base_url, capabilities_json, text_model, image_model, video_model, enabled
    ) VALUES (?, 'openai_compatible', 'https://api.example.test/v1', ?, ?, ?, ?, ?)
    `,
  )
  const textProviderId = Number(insertProvider.run('Text', '["text","tool_calling"]', 'chat', null, null, 1).lastInsertRowid)
  const imageProviderId = Number(insertProvider.run('Image', '["image"]', null, 'image', null, 1).lastInsertRowid)
  const disabledVideoProviderId = Number(insertProvider.run('Video', '["video"]', null, null, 'video', 0).lastInsertRowid)
  const mcpId = Number(
    db
      .prepare(
        "INSERT INTO ai_mcp_servers (name, transport, connection_json) VALUES ('Tools', 'stdio', '{}')",
      )
      .run().lastInsertRowid,
  )
  const service = new AIAgentService(db, () => new Date('2026-07-18T03:00:00.000Z'))
  return { db, service, textProviderId, imageProviderId, disabledVideoProviderId, mcpId }
}

function agentInput(ids, overrides = {}) {
  return {
    name: 'Assistant',
    description: 'General assistant',
    systemPrompt: 'Be precise.',
    textProviderId: ids.textProviderId,
    imageProviderId: ids.imageProviderId,
    mcpServerIds: [ids.mcpId],
    allowedTools: ['search'],
    blockedTools: ['delete'],
    toolApprovalMode: 'confirm_risky',
    maxToolCalls: 8,
    temperature: 0.2,
    context: { maxMessages: 50, maxOutputTokens: 4000 },
    enabled: true,
    isDefault: true,
    ...overrides,
  }
}

test('agent service creates a ready default agent with provider and MCP links', () => {
  const context = setup()
  const agent = context.service.create(agentInput(context))
  assert.equal(agent.configurationStatus, 'ready')
  assert.equal(agent.isDefault, true)
  assert.deepEqual(agent.providers, { text: context.textProviderId, image: context.imageProviderId })
  assert.deepEqual(agent.mcpServerIds, [context.mcpId])
  context.db.close()
})

test('agent service reports disabled provider dependencies as incomplete', () => {
  const context = setup()
  const agent = context.service.create(
    agentInput(context, {
      name: 'Video Agent',
      videoProviderId: context.disabledVideoProviderId,
      isDefault: false,
    }),
  )
  assert.equal(agent.configurationStatus, 'incomplete')
  assert.match(agent.issues.join(' '), /Video is disabled/i)
  assert.throws(() => context.service.getSnapshot(agent.id), (error) => {
    return error instanceof AIServiceError && error.detail.code === 'configuration_incomplete'
  })
  context.db.close()
})

test('agent snapshots remain immutable after the source configuration changes', () => {
  const context = setup()
  const agent = context.service.create(agentInput(context))
  const snapshot = context.service.getSnapshot(agent.id)
  assert.equal(snapshot.providers.text.model, 'chat')
  assert.equal(snapshot.capturedAt, '2026-07-18T03:00:00.000Z')
  context.db.prepare("UPDATE ai_providers SET text_model = 'new-chat' WHERE id = ?").run(context.textProviderId)
  context.service.update(agent.id, agentInput(context, { systemPrompt: 'Changed prompt.' }))
  assert.equal(snapshot.systemPrompt, 'Be precise.')
  assert.equal(snapshot.providers.text.model, 'chat')
  context.db.close()
})

test('agent service rejects overlapping allow and block tool sets', () => {
  const context = setup()
  assert.throws(
    () => context.service.create(agentInput(context, { allowedTools: ['delete'] })),
    (error) => error instanceof AIServiceError && error.detail.code === 'invalid_input',
  )
  context.db.close()
})

test('agent copy is independent, disabled, and never becomes default', () => {
  const context = setup()
  const original = context.service.create(agentInput(context))
  const copy = context.service.copy(original.id)
  assert.equal(copy.name, 'Assistant Copy')
  assert.equal(copy.enabled, false)
  assert.equal(copy.isDefault, false)
  assert.deepEqual(copy.mcpServerIds, [context.mcpId])
  context.db.close()
})

test('default agent cannot be disabled or deleted without a ready replacement', () => {
  const context = setup()
  const original = context.service.create(agentInput(context))
  assert.throws(() => context.service.setEnabled(original.id, false), /cannot be disabled/i)
  assert.throws(() => context.service.delete(original.id), /without a ready replacement/i)
  const replacement = context.service.create(agentInput(context, { name: 'Replacement', isDefault: false }))
  assert.equal(context.service.delete(original.id), true)
  assert.equal(context.service.get(replacement.id).isDefault, true)
  context.db.close()
})

test('agent updates replace MCP links atomically and reject missing servers', () => {
  const context = setup()
  const agent = context.service.create(agentInput(context))
  assert.throws(
    () => context.service.update(agent.id, agentInput(context, { mcpServerIds: [999] })),
    /MCP server 999 does not exist/,
  )
  assert.deepEqual(context.service.get(agent.id).mcpServerIds, [context.mcpId])
  context.db.close()
})

test('agent configuration status can be repaired after provider recovery', () => {
  const context = setup()
  const agent = context.service.create(
    agentInput(context, {
      name: 'Recoverable',
      videoProviderId: context.disabledVideoProviderId,
      isDefault: false,
    }),
  )
  assert.equal(agent.configurationStatus, 'incomplete')
  context.db.prepare('UPDATE ai_providers SET enabled = 1 WHERE id = ?').run(context.disabledVideoProviderId)
  assert.equal(context.service.recomputeConfigurationStatus(agent.id).configurationStatus, 'ready')
  context.db.close()
})
