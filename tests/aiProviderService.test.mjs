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
    models: { text: 'chat-model' },
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
  assert.deepEqual(created.headerNames, ['X-Tenant'])
  assert.equal(JSON.stringify(created).includes('secret-key'), false)
  assert.equal(JSON.stringify(created).includes('private-tenant'), false)

  const row = db.prepare('SELECT credential_ref, default_headers_json FROM ai_providers WHERE id = ?').get(created.id)
  assert.ok(row.credential_ref)
  assert.equal(row.default_headers_json, '["X-Tenant"]')
  assert.equal(credentials.entries.size, 1)
  assert.deepEqual(service.getCredentialBundle(created.id), {
    apiKey: 'secret-key',
    headers: { 'X-Tenant': 'private-tenant' },
  })
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

test('provider dependencies block deletion and disabling marks agents incomplete', () => {
  const { db, service } = setup()
  const provider = service.create(providerInput())
  db.prepare(
    `
    INSERT INTO ai_agents (
      name, text_provider_id, model_params_json, context_json,
      allowed_tools_json, blocked_tools_json
    ) VALUES ('Dependent Agent', ?, '{}', '{}', '[]', '[]')
    `,
  ).run(provider.id)
  assert.deepEqual(service.getDependencies(provider.id), [
    { agentId: 1, agentName: 'Dependent Agent', usages: ['text'] },
  ])
  assert.throws(() => service.delete(provider.id), (error) => {
    return error instanceof AIServiceError && error.detail.code === 'configuration_incomplete'
  })
  service.setEnabled(provider.id, false)
  assert.equal(db.prepare('SELECT configuration_status FROM ai_agents WHERE id = 1').get().configuration_status, 'incomplete')
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
