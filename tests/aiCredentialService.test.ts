import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  AICredentialService,
  isAICredentialReference,
  type AICredentialCryptoAdapter,
} from '../electron/ai/credentialService.ts'
import { AIServiceError } from '../electron/ai/types.ts'

const UUIDS = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
]

function createTestAdapter(options: { available?: boolean; failDecrypt?: boolean } = {}): AICredentialCryptoAdapter {
  return {
    isAvailable: () => options.available !== false,
    encrypt: (plaintext) => Buffer.from(`encrypted:${Buffer.from(plaintext).toString('base64')}`),
    decrypt: (ciphertext) => {
      if (options.failDecrypt) throw new Error('decrypt failed')
      const encoded = ciphertext.toString().replace(/^encrypted:/, '')
      return Buffer.from(encoded, 'base64').toString()
    },
  }
}

function createService(adapter = createTestAdapter()) {
  const dir = mkdtempSync(path.join(tmpdir(), 'lifeos-ai-credentials-'))
  const filePath = path.join(dir, 'ai-credentials.json')
  let uuidIndex = 0
  return {
    filePath,
    service: new AICredentialService(filePath, adapter, {
      now: () => new Date('2026-07-18T00:00:00.000Z'),
      randomUUID: () => UUIDS[uuidIndex++],
    }),
  }
}

test('AI credentials are encrypted on disk and revealed only through the adapter', () => {
  const { filePath, service } = createService()
  const ref = service.create('top-secret-api-key')
  assert.equal(isAICredentialReference(ref), true)
  assert.equal(service.has(ref), true)
  assert.equal(service.reveal(ref), 'top-secret-api-key')
  const stored = readFileSync(filePath, 'utf8')
  assert.equal(stored.includes('top-secret-api-key'), false)
  const parsed = JSON.parse(stored)
  assert.match(Buffer.from(parsed.entries[ref].ciphertext, 'base64').toString(), /^encrypted:/)
})

test('AI credentials can be replaced and deleted without changing references', () => {
  const { service } = createService()
  const ref = service.create('first-secret')
  service.replace(ref, 'second-secret')
  assert.equal(service.reveal(ref), 'second-secret')
  assert.equal(service.delete(ref), true)
  assert.equal(service.delete(ref), false)
  assert.equal(service.has(ref), false)
  assert.throws(() => service.reveal(ref), (error) => {
    return error instanceof AIServiceError && error.detail.code === 'not_found'
  })
})

test('AI credential service does not silently fall back when secure storage is unavailable', () => {
  const { service } = createService(createTestAdapter({ available: false }))
  assert.equal(service.isAvailable(), false)
  assert.throws(() => service.create('secret'), (error) => {
    return error instanceof AIServiceError && error.detail.code === 'credential_unavailable'
  })
})

test('AI credential service rejects invalid values and references', () => {
  const { service } = createService()
  assert.throws(() => service.create('   '), (error) => {
    return error instanceof AIServiceError && error.detail.code === 'invalid_input'
  })
  assert.throws(() => service.has('../credential'), (error) => {
    return error instanceof AIServiceError && error.detail.code === 'invalid_input'
  })
})

test('AI credential service reports corrupt files and decrypt failures without exposing secrets', () => {
  const { filePath, service } = createService()
  const ref = service.create('secret-value')
  const failingService = new AICredentialService(filePath, createTestAdapter({ failDecrypt: true }))
  assert.throws(() => failingService.reveal(ref), (error) => {
    return (
      error instanceof AIServiceError &&
      error.detail.code === 'storage_error' &&
      !error.message.includes('secret-value')
    )
  })
})

test('AI credential service clears every stored reference', () => {
  const { service } = createService()
  const first = service.create('one')
  const second = service.create('two')
  service.clear()
  assert.equal(service.has(first), false)
  assert.equal(service.has(second), false)
})
