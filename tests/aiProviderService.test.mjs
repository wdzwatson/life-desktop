import assert from 'node:assert/strict'
import test from 'node:test'
import Database from 'better-sqlite3'
import { initializeAISchema } from '../electron/ai/schema.ts'
import { AIProviderService } from '../electron/ai/providerService.ts'
import { AIServiceError } from '../electron/ai/types.ts'

class FakeCredentials {
  entries = new Map()
  sequence = 0

  create(secret) {
    const ref = `cred_00000000-0000-4000-8000-${String(++this.sequence).padStart(12, '0')}`
    this.entries.set(ref, secret)
    return ref
  }

  replace(ref, secret) {
    if (!this.entries.has(ref)) throw new Error('missing credential')
    this.entries.set(ref, secret)
  }

  reveal(ref) {
    const value = this.entries.get(ref)
    if (!value) throw new Error('missing credential')
    return value
  }

  delete(ref) {
    return this.entries.delete(ref)
  }
}

function providerInput(overrides = {}) {
  return {
    name: 'Primary',
    protocol: 'openai_compatible',
    baseUrl: 'https://api.example.test/v1',
    apiKey: 'secret-key',
    defaultHeaders: { 'X-Tenant': 'private-tenant' },
    capabilities: ['text', 'streaming', 'tool_calling'],
    models: { text: 'chat-model', textOptions: ['chat-model', 'chat-model-fast'] },
    timeoutMs: 60000,
    allowLocalNetwork: false,
    enabled: true,
    ...overrides,
  }
}

function setup() {
  const db = new Database(':memory:')
  initializeAISchema(db)
  const credentials = new FakeCredentials()
  return { db, credentials, service: new AIProviderService(db, credentials) }
}

test('provider service stores secrets outside SQLite and returns a redacted list', () => {
  const { db, credentials, service } = setup()
  const created = service.create(providerInput())
  assert.equal(created.credentialConfigured, true)
  assert.deepEqual(created.models.textOptions, ['chat-model', 'chat-model-fast'])
  assert.deepEqual(created.headerNames, ['X-Tenant'])
  assert.equal(JSON.stringify(created).includes('secret-key'), false)
  assert.equal(JSON.stringify(created).includes('private-tenant'), false)

  const row = db.prepare('SELECT credential_ref, default_headers_json FROM ai_providers WHERE id = ?').get(created.id)
  assert.ok(row.credential_ref)
  assert.equal(row.default_headers_json, '["X-Tenant"]')
  assert.equal(credentials.entries.size, 1)
  assert.deepEqual(created.requestBody, {})
  assert.deepEqual(service.getCredentialBundle(created.id), {
    apiKey: 'secret-key',
    headers: { 'X-Tenant': 'private-tenant' },
  })
  db.close()
})

test('provider service saves a JSON request body without treating it as a credential', () => {
  const { db, credentials, service } = setup()
  const created = service.create(providerInput({
    requestBody: { max_tokens: 8192, response_format: { type: 'json_object' } },
  }))
  assert.deepEqual(created.requestBody, { max_tokens: 8192, response_format: { type: 'json_object' } })
  assert.equal(db.prepare('SELECT request_body_json FROM ai_providers WHERE id = ?').get(created.id).request_body_json, '{"max_tokens":8192,"response_format":{"type":"json_object"}}')
  assert.equal(credentials.entries.size, 1)
  db.close()
})

test('provider service supports search, protocol, capability, and enabled filters', () => {
  const { db, service } = setup()
  service.create(providerInput())
  service.create(
    providerInput({
      name: 'Image Lab',
      protocol: 'xai',
      apiKey: undefined,
      defaultHeaders: {},
      capabilities: ['image'],
      models: { image: 'image-model' },
      enabled: false,
    }),
  )
  assert.deepEqual(service.list({ search: 'image' }).map((item) => item.name), ['Image Lab'])
  assert.deepEqual(service.list({ protocol: 'xai' }).map((item) => item.name), ['Image Lab'])
  assert.deepEqual(service.list({ capability: 'text' }).map((item) => item.name), ['Primary'])
  assert.deepEqual(service.list({ enabled: false }).map((item) => item.name), ['Image Lab'])
  db.close()
})

test('provider defaults are unique per capability and require a usable provider', () => {
  const { db, service } = setup()
  const first = service.create(providerInput())
  const second = service.create(providerInput({ name: 'Second' }))
  assert.equal(service.setDefault(first.id, 'text').defaults.text, true)
  assert.equal(service.setDefault(second.id, 'text').defaults.text, true)
  assert.equal(service.get(first.id).defaults.text, false)
  const disabled = service.create(providerInput({ name: 'Disabled', enabled: false }))
  assert.throws(() => service.setDefault(disabled.id, 'text'), (error) => {
    return error instanceof AIServiceError && error.detail.code === 'configuration_incomplete'
  })
  assert.throws(() => service.setDefault(first.id, 'text; DROP TABLE ai_providers'), (error) => {
    return error instanceof AIServiceError && error.detail.code === 'invalid_input'
  })
  assert.equal(service.list().length, 3)
  db.close()
})

test('provider updates preserve API keys, replace headers, and clear invalid defaults', () => {
  const { db, service } = setup()
  const provider = service.create(providerInput())
  service.setDefault(provider.id, 'text')
  const updated = service.update(
    provider.id,
    providerInput({
      apiKey: undefined,
      defaultHeaders: { 'X-New': 'new-secret' },
      capabilities: ['image'],
      models: { image: 'image-model' },
    }),
  )
  assert.equal(updated.defaults.text, false)
  assert.deepEqual(updated.headerNames, ['X-New'])
  assert.deepEqual(service.getCredentialBundle(provider.id), {
    apiKey: 'secret-key',
    headers: { 'X-New': 'new-secret' },
  })
  service.update(provider.id, providerInput({ apiKey: undefined, defaultHeaders: {} }), {
    preserveHeaders: true,
  })
  assert.deepEqual(service.getCredentialBundle(provider.id).headers, { 'X-New': 'new-secret' })
  db.close()
})

test('provider copy uses an independent credential and starts disabled', () => {
  const { db, credentials, service } = setup()
  const provider = service.create(providerInput())
  const copy = service.copy(provider.id)
  assert.equal(copy.name, 'Primary Copy')
  assert.equal(copy.enabled, false)
  assert.equal(copy.credentialConfigured, true)
  assert.equal(credentials.entries.size, 2)
  service.removeCredential(copy.id)
  assert.equal(service.get(provider.id).credentialConfigured, true)
  assert.equal(service.get(copy.id).credentialConfigured, false)
  db.close()
})

test('provider deletion removes dependent profiles while preserving conversation snapshots', () => {
  const { db, credentials, service } = setup()
  const provider = service.create(providerInput())
  const agentId = Number(db.prepare(
    `
    INSERT INTO ai_agents (
      name, text_provider_id, model_params_json, context_json,
      allowed_tools_json, blocked_tools_json
    ) VALUES ('Dependent Agent', ?, '{}', '{}', '[]', '[]')
    `,
  ).run(provider.id).lastInsertRowid)
  db.prepare(`
    INSERT INTO ai_conversations (title, agent_id, agent_snapshot_json)
    VALUES ('History', ?, '{"providers":{"text":{"model":"chat-model"}}}')
  `).run(agentId)
  assert.deepEqual(service.getDependencies(provider.id), [
    { agentId, agentName: 'Dependent Agent', usages: ['text'] },
  ])
  assert.equal(service.delete(provider.id), true)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM ai_providers').get().count, 0)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM ai_agents').get().count, 0)
  assert.equal(db.prepare('SELECT agent_id FROM ai_conversations').get().agent_id, null)
  assert.equal(db.prepare('SELECT agent_snapshot_json FROM ai_conversations').get().agent_snapshot_json.includes('chat-model'), true)
  assert.equal(credentials.entries.size, 0)
  db.close()
})

test('provider deletion detaches optional image and video provider links from surviving agents', () => {
  const { db, service } = setup()
  const textProvider = service.create(providerInput({ name: 'Text source' }))
  const mediaProvider = service.create(providerInput({
    name: 'Media source',
    capabilities: ['image'],
    models: { image: 'image-model' },
  }))
  const agentId = Number(db.prepare(`
    INSERT INTO ai_agents (
      name, text_provider_id, image_provider_id, video_provider_id, model_params_json, context_json,
      allowed_tools_json, blocked_tools_json
    ) VALUES ('Mixed Agent', ?, ?, ?, '{}', '{}', '[]', '[]')
  `).run(textProvider.id, mediaProvider.id, mediaProvider.id).lastInsertRowid)

  assert.equal(service.delete(mediaProvider.id), true)
  assert.deepEqual(db.prepare('SELECT text_provider_id, image_provider_id, video_provider_id FROM ai_agents WHERE id = ?').get(agentId), {
    text_provider_id: textProvider.id,
    image_provider_id: null,
    video_provider_id: null,
  })
  db.close()
})

test('disabling a provider marks its dependent agents incomplete', () => {
  const { db, service } = setup()
  const provider = service.create(providerInput())
  const agentId = Number(db.prepare(`
    INSERT INTO ai_agents (
      name, text_provider_id, model_params_json, context_json, allowed_tools_json, blocked_tools_json
    ) VALUES ('Dependent Agent', ?, '{}', '{}', '[]', '[]')
  `).run(provider.id).lastInsertRowid)

  service.setEnabled(provider.id, false)
  assert.equal(db.prepare('SELECT configuration_status FROM ai_agents WHERE id = ?').get(agentId).configuration_status, 'incomplete')
  db.close()
})

test('provider create rolls back newly-created credentials on duplicate names', () => {
  const { db, credentials, service } = setup()
  service.create(providerInput())
  assert.throws(() => service.create(providerInput()), (error) => {
    return error instanceof AIServiceError && error.detail.code === 'invalid_input'
  })
  assert.equal(credentials.entries.size, 1)
  db.close()
})

test('provider connection status tracks the last successful test separately', () => {
  const { db, service } = setup()
  const provider = service.create(providerInput())
  const connected = service.recordConnectionStatus(provider.id, 'connected', '2026-07-18T01:00:00.000Z')
  assert.equal(connected.lastSuccessAt, '2026-07-18T01:00:00.000Z')
  const failed = service.recordConnectionStatus(provider.id, 'failed', '2026-07-18T02:00:00.000Z')
  assert.equal(failed.lastTestedAt, '2026-07-18T02:00:00.000Z')
  assert.equal(failed.lastSuccessAt, '2026-07-18T01:00:00.000Z')
  db.close()
})
