import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildProviderPayload,
  createProviderDraft,
  formatProviderLastTestedAt,
  parseProviderHeaders,
  providerToDraft,
  toggleProviderCapability,
} from '../src/views/ai/providerUtils.ts'

test('provider drafts build normalized API payloads', () => {
  const draft = createProviderDraft()
  const payload = buildProviderPayload({
    ...draft,
    name: 'Primary',
    baseUrl: 'https://api.example.test/v1',
    apiKey: ' key ',
    textModel: ' chat ',
    headersJson: '{"X-Tenant":"alpha"}',
  })
  assert.equal(payload.apiKey, 'key')
  assert.equal(payload.models.text, 'chat')
  assert.deepEqual(payload.defaultHeaders, { 'X-Tenant': 'alpha' })
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
})

test('provider header parsing rejects arrays and non-string values', () => {
  assert.throws(() => parseProviderHeaders('[]'), /JSON object/)
  assert.throws(() => parseProviderHeaders('{"X":1}'), /must be a string/)
})

test('provider capabilities toggle without duplicates', () => {
  assert.deepEqual(toggleProviderCapability(['text'], 'image'), ['text', 'image'])
  assert.deepEqual(toggleProviderCapability(['text', 'image'], 'image'), ['text'])
})

test('provider connection timestamps are localized only when valid', () => {
  assert.equal(formatProviderLastTestedAt(null, 'en-US'), null)
  assert.equal(formatProviderLastTestedAt('not-a-date', 'en-US'), null)
  assert.match(formatProviderLastTestedAt('2026-07-18T08:30:00.000Z', 'en-US') ?? '', /2026/)
})
