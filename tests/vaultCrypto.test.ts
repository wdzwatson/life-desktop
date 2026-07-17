import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_VAULT_SCRYPT_PARAMS,
  VAULT_CIPHER_VERSION,
  VAULT_KEY_BYTES,
  VaultCryptoError,
  createVaultVerifier,
  decryptVaultSecret,
  deriveVaultKey,
  destroyVaultKey,
  encryptVaultSecret,
  generateVaultId,
  generateVaultSalt,
  verifyVaultKey,
} from '../electron/vault/crypto.ts'

async function createTestKey(password = 'correct horse battery staple') {
  return deriveVaultKey(password, Buffer.alloc(16, 7), DEFAULT_VAULT_SCRYPT_PARAMS)
}

function expectVaultError(code: string) {
  return (error: unknown) => error instanceof VaultCryptoError && error.code === code
}

test('deriveVaultKey is deterministic for the same password and salt', async () => {
  const first = await createTestKey()
  const second = await createTestKey()
  const different = await createTestKey('different password')

  assert.equal(first.length, VAULT_KEY_BYTES)
  assert.deepEqual(first, second)
  assert.notDeepEqual(first, different)

  destroyVaultKey(first)
  destroyVaultKey(second)
  destroyVaultKey(different)
})

test('vault secret encryption round-trips password and notes', async () => {
  const key = await createTestKey()
  const encrypted = encryptVaultSecret(key, 42, {
    password: 'p@ssword-value',
    notes: 'private note',
  })

  assert.equal(encrypted.version, VAULT_CIPHER_VERSION)
  assert.notEqual(encrypted.ciphertext, Buffer.from('p@ssword-value').toString('base64'))
  assert.doesNotMatch(JSON.stringify(encrypted), /p@ssword-value|private note/)
  assert.deepEqual(decryptVaultSecret(key, 42, encrypted), {
    password: 'p@ssword-value',
    notes: 'private note',
  })

  destroyVaultKey(key)
})

test('vault encryption generates a fresh IV for every payload', async () => {
  const key = await createTestKey()
  const first = encryptVaultSecret(key, 42, { password: 'same-secret' })
  const second = encryptVaultSecret(key, 42, { password: 'same-secret' })

  assert.notEqual(first.iv, second.iv)
  assert.notEqual(first.ciphertext, second.ciphertext)
  destroyVaultKey(key)
})

test('wrong keys and modified ciphertext are rejected', async () => {
  const key = await createTestKey()
  const wrongKey = await createTestKey('wrong password')
  const encrypted = encryptVaultSecret(key, 9, { password: 'secret' })

  assert.throws(() => decryptVaultSecret(wrongKey, 9, encrypted), expectVaultError('CORRUPT_DATA'))

  const ciphertext = Buffer.from(encrypted.ciphertext, 'base64')
  ciphertext[0] ^= 1
  assert.throws(
    () =>
      decryptVaultSecret(key, 9, {
        ...encrypted,
        ciphertext: ciphertext.toString('base64'),
      }),
    expectVaultError('CORRUPT_DATA'),
  )

  destroyVaultKey(key)
  destroyVaultKey(wrongKey)
})

test('credential AAD prevents moving ciphertext between rows', async () => {
  const key = await createTestKey()
  const encrypted = encryptVaultSecret(key, 12, { password: 'row-bound' })

  assert.throws(() => decryptVaultSecret(key, 13, encrypted), expectVaultError('CORRUPT_DATA'))
  destroyVaultKey(key)
})

test('unsupported payload versions are rejected explicitly', async () => {
  const key = await createTestKey()
  const encrypted = encryptVaultSecret(key, 3, { password: 'versioned' })

  assert.throws(
    () => decryptVaultSecret(key, 3, { ...encrypted, version: 999 }),
    expectVaultError('UNSUPPORTED_VERSION'),
  )
  destroyVaultKey(key)
})

test('vault verifier accepts the correct key and rejects the wrong key', async () => {
  const key = await createTestKey()
  const wrongKey = await createTestKey('wrong password')
  const verifier = createVaultVerifier(key, generateVaultId())

  assert.equal(verifyVaultKey(key, verifier), true)
  assert.throws(() => verifyVaultKey(wrongKey, verifier), expectVaultError('INVALID_PASSWORD'))

  destroyVaultKey(key)
  destroyVaultKey(wrongKey)
})

test('destroyVaultKey overwrites key material', async () => {
  const key = await deriveVaultKey('temporary key', generateVaultSalt())
  destroyVaultKey(key)
  assert.deepEqual(key, Buffer.alloc(VAULT_KEY_BYTES))
})

test('invalid KDF inputs fail before invoking scrypt', async () => {
  await assert.rejects(() => deriveVaultKey('', generateVaultSalt()), expectVaultError('INVALID_INPUT'))
  await assert.rejects(
    () => deriveVaultKey('password', Buffer.alloc(4)),
    expectVaultError('INVALID_INPUT'),
  )
  await assert.rejects(
    () =>
      deriveVaultKey('password', generateVaultSalt(), {
        ...DEFAULT_VAULT_SCRYPT_PARAMS,
        N: 12345,
      }),
    expectVaultError('INVALID_INPUT'),
  )
})
