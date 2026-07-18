import assert from 'node:assert/strict'
import test from 'node:test'
import {
  agentToDraft,
  buildAgentPayload,
  createAgentDraft,
  getAgentProviderNames,
  getAgentProviderOptions,
  parseAgentToolNames,
  toggleAgentMcpServer,
  type AgentSummary,
} from '../src/views/ai/agentUtils.ts'
import type { ProviderSummary } from '../src/views/ai/providerUtils.ts'

const providers: ProviderSummary[] = [
  {
    id: 1,
    name: 'Secondary Text',
    protocol: 'openai_compatible',
    baseUrl: 'https://secondary.test',
    credentialConfigured: true,
    headerNames: [],
    capabilities: ['text'],
    models: { text: 'chat-small' },
    timeoutMs: 60000,
    allowLocalNetwork: false,
    enabled: true,
    defaults: { text: false, image: false, video: false },
    connectionStatus: 'untested',
    lastTestedAt: null,
  },
  {
    id: 2,
    name: 'Primary Multimodal',
    protocol: 'xai',
    baseUrl: 'https://primary.test',
    credentialConfigured: true,
    headerNames: [],
    capabilities: ['text', 'image'],
    models: { text: 'chat', image: 'imagine' },
    timeoutMs: 60000,
    allowLocalNetwork: false,
    enabled: true,
    defaults: { text: true, image: true, video: false },
    connectionStatus: 'connected',
    lastTestedAt: null,
  },
]

const agent: AgentSummary = {
  id: 7,
  name: 'Researcher',
  description: 'Research assistant',
  systemPrompt: 'Verify sources.',
  providers: { text: 2, image: 2 },
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

test('agent provider options prefer enabled capability defaults', () => {
  assert.deepEqual(getAgentProviderOptions(providers, 'text').map((provider) => provider.id), [2, 1])
  assert.deepEqual(getAgentProviderOptions(providers, 'image').map((provider) => provider.id), [2])
  assert.deepEqual(getAgentProviderOptions(providers, 'video'), [])
})

test('agent drafts round-trip providers, behavior, context, and tools', () => {
  const payload = buildAgentPayload(agentToDraft(agent))
  assert.equal(payload.textProviderId, 2)
  assert.equal(payload.imageProviderId, 2)
  assert.equal(payload.temperature, 0.2)
  assert.deepEqual(payload.context, { maxMessages: 50, maxOutputTokens: 4000 })
  assert.deepEqual(payload.allowedTools, ['search.read'])
})

test('new agent drafts use safe approval defaults', () => {
  const draft = createAgentDraft(2, true)
  assert.equal(draft.textProviderId, '2')
  assert.equal(draft.toolApprovalMode, 'confirm_risky')
  assert.equal(draft.isDefault, true)
})

test('agent tool names normalize and reject allow/block overlap', () => {
  assert.deepEqual(parseAgentToolNames('search.read, files.list\nsearch.read'), ['search.read', 'files.list'])
  assert.throws(
    () => buildAgentPayload({ ...createAgentDraft(2), allowedToolsText: 'search', blockedToolsText: 'search' }),
    /both allowed and blocked/,
  )
})

test('agent MCP selection stays sorted and provider summaries retain missing references', () => {
  assert.deepEqual(toggleAgentMcpServer([5], 2), [2, 5])
  assert.deepEqual(toggleAgentMcpServer([2, 5], 2), [5])
  assert.deepEqual(getAgentProviderNames(agent, providers), { text: 'Primary Multimodal', image: 'Primary Multimodal' })
  assert.equal(getAgentProviderNames({ ...agent, providers: { text: 99 } }, providers).text, '#99')
})
