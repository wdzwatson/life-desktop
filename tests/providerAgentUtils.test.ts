import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PROVIDER_AGENT_PRESETS,
  appendCustomAgentName,
  createCustomAgentSystemPrompt,
  createProviderLinkedAgentDraft,
  toggleProviderAgentPreset,
} from '../src/views/ai/providerAgentUtils.ts'

test('provider agent presets expose four stable everyday roles', () => {
  assert.deepEqual(PROVIDER_AGENT_PRESETS.map((preset) => preset.id), [
    'general',
    'writing',
    'research',
    'coding',
  ])
  assert.equal(new Set(PROVIDER_AGENT_PRESETS.map((preset) => preset.systemPrompt)).size, 4)
})

test('provider preset selection toggles without mutating the current selection', () => {
  const current = ['general'] as const
  assert.deepEqual(toggleProviderAgentPreset([...current], 'writing'), ['general', 'writing'])
  assert.deepEqual(toggleProviderAgentPreset([...current], 'general'), [])
  assert.deepEqual(current, ['general'])
})

test('custom assistant names trim and reject local or persisted duplicates', () => {
  assert.deepEqual(appendCustomAgentName([], '  Planner  '), ['Planner'])
  assert.deepEqual(appendCustomAgentName(['Planner'], 'planner'), ['Planner'])
  assert.deepEqual(appendCustomAgentName([], 'Writer', ['writer']), [])
})

test('provider-linked agent drafts inherit every supported media capability', () => {
  const draft = createProviderLinkedAgentDraft({
    providerId: 7,
    name: 'Researcher',
    description: 'Checks evidence',
    systemPrompt: 'Verify sources.',
    capabilities: ['text', 'image', 'video'],
    enabled: true,
    isDefault: true,
  })
  assert.equal(draft.textProviderId, '7')
  assert.equal(draft.imageProviderId, '7')
  assert.equal(draft.videoProviderId, '7')
  assert.equal(draft.isDefault, true)
  assert.match(createCustomAgentSystemPrompt('Planner'), /You are Planner/)
})
