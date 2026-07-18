import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { AI_CONFIG_CHANNELS, createAIConfigHandlers } from '../electron/ai/ipc.ts'

test('AI configuration IPC exposes only the approved channel whitelist', () => {
  assert.equal(AI_CONFIG_CHANNELS.length, 28)
  assert.equal(new Set(AI_CONFIG_CHANNELS).size, AI_CONFIG_CHANNELS.length)
  assert.equal(
    AI_CONFIG_CHANNELS.some((channel) => /runtime|credential:reveal|shell|sql/i.test(channel)),
    false,
  )
})

test('preload exposes structured AI methods without runtime credentials or generic execution', () => {
  const preload = readFileSync(path.resolve('electron/preload.ts'), 'utf8')
  for (const method of [
    'listAIProviders',
    'createAIProvider',
    'listAIAgents',
    'listAIMcpServers',
  ]) {
    assert.match(preload, new RegExp(`${method}:`))
  }
  assert.doesNotMatch(preload, /getAIMcpRuntime|getAIProviderCredential|executeAICommand|ai:sql/)
})

test('AI IPC serializes invalid IDs and capabilities instead of invoking services', async () => {
  let opened = 0
  const handlers = createAIConfigHandlers({
    getDb: () => {
      opened += 1
      throw new Error('should not open database')
    },
    getCredentialFilePath: () => '/tmp/unused',
    getCredentialCryptoAdapter: () => ({
      isAvailable: () => true,
      encrypt: (value) => Buffer.from(value),
      decrypt: (value) => value.toString(),
    }),
  })
  const invalidId = await handlers['ai:providers:get']({}, { id: 0 })
  assert.deepEqual(invalidId, {
    success: false,
    error: { code: 'invalid_input', message: 'Invalid id.', retryable: false },
  })
  const invalidCapability = await handlers['ai:providers:setDefault'](
    {},
    { id: 1, capability: 'sql' },
  )
  assert.equal(invalidCapability.success, false)
  assert.equal(invalidCapability.error.code, 'invalid_input')
  assert.equal(opened, 0)
})

test('AI IPC returns actionable validation issues without leaking credential fields', async () => {
  const fakeDb = { pragma: () => undefined } as any
  const handlers = createAIConfigHandlers({
    getDb: () => fakeDb,
    getCredentialFilePath: () => '/tmp/unused',
    getCredentialCryptoAdapter: () => ({
      isAvailable: () => true,
      encrypt: (value) => Buffer.from(value),
      decrypt: (value) => value.toString(),
    }),
  })
  const result = await handlers['ai:providers:create']({}, { name: '' })
  assert.equal(result.success, false)
  assert.equal(result.error.code, 'invalid_input')
  assert.equal(Array.isArray(result.error.issues), true)
  assert.doesNotMatch(JSON.stringify(result), /apiKey|Authorization/)
})
