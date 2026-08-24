import assert from 'node:assert/strict'
import test from 'node:test'
import {
  agentToDraft,
  buildAgentPayload,
  parseAgentToolNames,
  type AgentSummary,
} from '../src/views/ai/agentUtils.ts'

const agent: AgentSummary = {
  id: 7,
  name: 'Researcher',
  description: 'Research assistant',
  systemPrompt: 'Verify sources.',
  providers: { text: 2, image: 2 },
  textModel: 'chat-pro',
  mcpServerIds: [4],
  allowedTools: ['search.read'],
  blockedTools: ['files.delete'],
  toolApprovalMode: 'confirm_risky',
  maxToolCalls: 8,
  temperature: 0.2,
  context: { maxMessages: 50, maxOutputTokens: 4000 },
  enabled: true,
  isDefault: true,
  configurationStatus: 'ready',
  issues: [],
  createdAt: '2026-07-18T00:00:00Z',
  updatedAt: '2026-07-18T00:00:00Z',
}

test('agent drafts round-trip providers, behavior, context, and tools', () => {
  const payload = buildAgentPayload(agentToDraft(agent))
  assert.equal(payload.textProviderId, 2)
  assert.equal(payload.textModel, 'chat-pro')
  assert.equal(payload.imageProviderId, 2)
  assert.equal('videoProviderId' in payload, false)
  assert.deepEqual(payload.mcpServerIds, [4])
  assert.equal(payload.temperature, 0.2)
  assert.deepEqual(payload.context, { maxMessages: 50, maxOutputTokens: 4000 })
  assert.deepEqual(payload.allowedTools, ['search.read'])
  assert.equal(payload.enabled, true)
  assert.equal(payload.isDefault, true)
})

test('agent tool names normalize and reject allow/block overlap', () => {
  assert.deepEqual(parseAgentToolNames('search.read, files.list\nsearch.read'), ['search.read', 'files.list'])
  assert.throws(
    () => buildAgentPayload({ ...agentToDraft(agent), allowedToolsText: 'search', blockedToolsText: 'search' }),
    /both allowed and blocked/,
  )
})
