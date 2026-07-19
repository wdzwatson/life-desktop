import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildProviderPayload,
  appendProviderTextModel,
  createProviderDraft,
  formatProviderLastTestedAt,
  parseProviderHeaders,
  parseProviderRequestBody,
  providerToDraft,
  toggleProviderCapability,
  toggleProviderTextModel,
} from '../src/views/ai/providerUtils.ts'

test('provider drafts build normalized API payloads', () => {
  const draft = createProviderDraft()
  const payload = buildProviderPayload({
    ...draft,
    name: 'Primary',
    baseUrl: 'https://api.example.test/v1',
    apiKey: ' key ',
    textModel: ' chat ',
    textModels: [' chat ', 'chat-fast', 'chat-fast'],
    headersJson: '{"X-Tenant":"alpha"}',
  })
  assert.equal(payload.apiKey, 'key')
  assert.equal(payload.models.text, 'chat')
  assert.deepEqual(payload.models.textOptions, ['chat', 'chat-fast'])
  assert.deepEqual(payload.defaultHeaders, { 'X-Tenant': 'alpha' })
  assert.deepEqual(payload.requestBody, {})
  assert.equal(payload.timeoutMs, 60000)
})

test('editing a provider preserves masked headers until replacement is requested', () => {
  const draft = providerToDraft({
    id: 1,
    name: 'Provider',
    protocol: 'xai',
    baseUrl: 'https://x.test',
    credentialConfigured: true,
    headerNames: ['Authorization'],
    requestBody: { max_tokens: 1024 },
    capabilities: ['image'],
    models: { image: 'image-model' },
    timeoutMs: 30000,
    allowLocalNetwork: false,
    enabled: true,
    defaults: { text: false, image: true, video: false },
    connectionStatus: 'connected',
    lastTestedAt: null,
  })
  assert.equal(draft.replaceHeaders, false)
  assert.equal(draft.apiKey, '')
  assert.deepEqual(buildProviderPayload(draft).defaultHeaders, {})
  assert.deepEqual(buildProviderPayload(draft).requestBody, { max_tokens: 1024 })
})

test('provider header parsing rejects arrays and non-string values', () => {
  assert.throws(() => parseProviderHeaders('[]'), /JSON object/)
  assert.throws(() => parseProviderHeaders('{"X":1}'), /must be a string/)
})

test('provider request body parsing requires a JSON object', () => {
  assert.deepEqual(parseProviderRequestBody('{"reasoning_effort":"high"}'), { reasoning_effort: 'high' })
  assert.throws(() => parseProviderRequestBody('[]'), /JSON object/)
})

test('provider capabilities toggle without duplicates', () => {
  assert.deepEqual(toggleProviderCapability(['text'], 'image'), ['text', 'image'])
  assert.deepEqual(toggleProviderCapability(['text', 'image'], 'image'), ['text'])
})

test('provider text model selection supports presets and custom model IDs', () => {
  assert.deepEqual(toggleProviderTextModel(['chat'], 'chat-fast'), ['chat', 'chat-fast'])
  assert.deepEqual(toggleProviderTextModel(['chat', 'chat-fast'], 'chat'), ['chat-fast'])
  assert.deepEqual(appendProviderTextModel(['chat'], ' custom-model '), ['chat', 'custom-model'])
})

test('provider connection timestamps are localized only when valid', () => {
  assert.equal(formatProviderLastTestedAt(null, 'en-US'), null)
  assert.equal(formatProviderLastTestedAt('not-a-date', 'en-US'), null)
  assert.match(formatProviderLastTestedAt('2026-07-18T08:30:00.000Z', 'en-US') ?? '', /2026/)
})
