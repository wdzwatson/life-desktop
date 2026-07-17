import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scrypt,
  timingSafeEqual,
} from 'node:crypto'

export const VAULT_CIPHER_VERSION = 1
export const VAULT_KEY_BYTES = 32
export const VAULT_IV_BYTES = 12
export const VAULT_TAG_BYTES = 16
export const VAULT_SALT_BYTES = 16

export const DEFAULT_VAULT_SCRYPT_PARAMS = Object.freeze({
  N: 32768,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
})

export type VaultScryptParams = {
  N: number
  r: number
  p: number
  maxmem: number
}

export type VaultSecret = {
  password: string
  notes?: string
}

export type VaultEncryptedPayload = {
  version: number
  ciphertext: string
  iv: string
  tag: string
}

export type VaultVerifier = VaultEncryptedPayload & {
  vaultId: string
}

export type VaultCryptoErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_PASSWORD'
  | 'CORRUPT_DATA'
  | 'UNSUPPORTED_VERSION'

export class VaultCryptoError extends Error {
  code: VaultCryptoErrorCode

  constructor(code: VaultCryptoErrorCode, message: string) {
    super(message)
    this.name = 'VaultCryptoError'
    this.code = code
  }
}

function assertPositiveInteger(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new VaultCryptoError('INVALID_INPUT', `${name} must be a positive integer.`)
  }
}

function validateScryptParams(params: VaultScryptParams) {
  assertPositiveInteger(params.N, 'scrypt N')
  assertPositiveInteger(params.r, 'scrypt r')
  assertPositiveInteger(params.p, 'scrypt p')
  assertPositiveInteger(params.maxmem, 'scrypt maxmem')

  if ((params.N & (params.N - 1)) !== 0 || params.N < 16384 || params.N > 1048576) {
    throw new VaultCryptoError('INVALID_INPUT', 'scrypt N must be a supported power of two.')
  }
  if (params.r > 32 || params.p > 16) {
    throw new VaultCryptoError('INVALID_INPUT', 'scrypt parameters exceed supported bounds.')
  }
  if (params.maxmem < 32 * 1024 * 1024 || params.maxmem > 1024 * 1024 * 1024) {
    throw new VaultCryptoError('INVALID_INPUT', 'scrypt maxmem exceeds supported bounds.')
  }
}

function assertKey(key: Buffer) {
  if (!Buffer.isBuffer(key) || key.length !== VAULT_KEY_BYTES) {
    throw new VaultCryptoError('INVALID_INPUT', `Vault key must be ${VAULT_KEY_BYTES} bytes.`)
  }
}

function decodeBase64(value: string, expectedBytes: number | null, field: string) {
  if (!value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new VaultCryptoError('CORRUPT_DATA', `${field} is not valid base64.`)
  }

  const decoded = Buffer.from(value, 'base64')
  if (decoded.toString('base64') !== value) {
    throw new VaultCryptoError('CORRUPT_DATA', `${field} is not canonical base64.`)
  }
  if (expectedBytes !== null && decoded.length !== expectedBytes) {
    throw new VaultCryptoError('CORRUPT_DATA', `${field} has an invalid length.`)
  }
  return decoded
}

function getCredentialAad(credentialId: number | string) {
  const normalizedId = String(credentialId).trim()
  if (!normalizedId) {
    throw new VaultCryptoError('INVALID_INPUT', 'Credential ID is required.')
  }
  return Buffer.from(`lifeos-vault:v${VAULT_CIPHER_VERSION}:credential:${normalizedId}`, 'utf8')
}

function getVerifierAad(vaultId: string) {
  const normalizedId = vaultId.trim()
  if (!normalizedId) {
    throw new VaultCryptoError('INVALID_INPUT', 'Vault ID is required.')
  }
  return Buffer.from(`lifeos-vault:v${VAULT_CIPHER_VERSION}:verifier:${normalizedId}`, 'utf8')
}

function getVerifierValue(vaultId: string) {
  return Buffer.from(`lifeos-vault-verifier:v${VAULT_CIPHER_VERSION}:${vaultId}`, 'utf8')
}

function encryptBytes(key: Buffer, plaintext: Buffer, aad: Buffer): VaultEncryptedPayload {
  assertKey(key)
  const iv = randomBytes(VAULT_IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: VAULT_TAG_BYTES })
  cipher.setAAD(aad)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])

  return {
    version: VAULT_CIPHER_VERSION,
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  }
}

function decryptBytes(key: Buffer, payload: VaultEncryptedPayload, aad: Buffer) {
  assertKey(key)
  if (payload.version !== VAULT_CIPHER_VERSION) {
    throw new VaultCryptoError(
      'UNSUPPORTED_VERSION',
      `Unsupported vault cipher version: ${payload.version}`,
    )
  }

  const ciphertext = decodeBase64(payload.ciphertext, null, 'Ciphertext')
  const iv = decodeBase64(payload.iv, VAULT_IV_BYTES, 'IV')
  const tag = decodeBase64(payload.tag, VAULT_TAG_BYTES, 'Authentication tag')

  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv, {
      authTagLength: VAULT_TAG_BYTES,
    })
    decipher.setAAD(aad)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(ciphertext), decipher.final()])
  } catch {
    throw new VaultCryptoError('CORRUPT_DATA', 'Vault payload authentication failed.')
  }
}

export function generateVaultSalt() {
  return randomBytes(VAULT_SALT_BYTES)
}

export function generateVaultId() {
  return randomBytes(16).toString('base64url')
}

export async function deriveVaultKey(
  masterPassword: string,
  salt: Buffer,
  params: VaultScryptParams = DEFAULT_VAULT_SCRYPT_PARAMS,
) {
  if (!masterPassword) {
    throw new VaultCryptoError('INVALID_INPUT', 'Master password is required.')
  }
  if (!Buffer.isBuffer(salt) || salt.length !== VAULT_SALT_BYTES) {
    throw new VaultCryptoError('INVALID_INPUT', `Vault salt must be ${VAULT_SALT_BYTES} bytes.`)
  }
  validateScryptParams(params)

  return new Promise<Buffer>((resolve, reject) => {
    scrypt(masterPassword, salt, VAULT_KEY_BYTES, params, (error, derivedKey) => {
      if (error) {
        reject(new VaultCryptoError('INVALID_INPUT', 'Vault key derivation failed.'))
        return
      }
      resolve(derivedKey)
    })
  })
}

export function encryptVaultSecret(
  key: Buffer,
  credentialId: number | string,
  secret: VaultSecret,
) {
  if (
    typeof secret.password !== 'string' ||
    (typeof secret.notes !== 'string' && secret.notes !== undefined)
  ) {
    throw new VaultCryptoError('INVALID_INPUT', 'Vault secret contains invalid fields.')
  }

  const plaintext = Buffer.from(
    JSON.stringify({
      version: VAULT_CIPHER_VERSION,
      password: secret.password,
      notes: secret.notes ?? '',
    }),
    'utf8',
  )
  try {
    return encryptBytes(key, plaintext, getCredentialAad(credentialId))
  } finally {
    plaintext.fill(0)
  }
}

export function decryptVaultSecret(
  key: Buffer,
  credentialId: number | string,
  payload: VaultEncryptedPayload,
): VaultSecret {
  const plaintext = decryptBytes(key, payload, getCredentialAad(credentialId))

  try {
    const decoded = JSON.parse(plaintext.toString('utf8')) as Record<string, unknown>
    if (
      decoded.version !== VAULT_CIPHER_VERSION ||
      typeof decoded.password !== 'string' ||
      typeof decoded.notes !== 'string'
    ) {
      throw new Error('Invalid payload shape')
    }
    return { password: decoded.password, notes: decoded.notes }
  } catch {
    throw new VaultCryptoError('CORRUPT_DATA', 'Vault payload is not valid.')
  } finally {
    plaintext.fill(0)
  }
}

export function createVaultVerifier(key: Buffer, vaultId: string): VaultVerifier {
  const verifierValue = getVerifierValue(vaultId)
  const payload = encryptBytes(key, verifierValue, getVerifierAad(vaultId))
  verifierValue.fill(0)
  return { ...payload, vaultId }
}

export function verifyVaultKey(key: Buffer, verifier: VaultVerifier) {
  try {
    const decrypted = decryptBytes(key, verifier, getVerifierAad(verifier.vaultId))
    const expected = getVerifierValue(verifier.vaultId)
    const isValid = decrypted.length === expected.length && timingSafeEqual(decrypted, expected)
    decrypted.fill(0)
    expected.fill(0)
    if (!isValid) {
      throw new VaultCryptoError('INVALID_PASSWORD', 'Vault password verification failed.')
    }
    return true
  } catch (error) {
    if (error instanceof VaultCryptoError && error.code === 'UNSUPPORTED_VERSION') {
      throw error
    }
    throw new VaultCryptoError('INVALID_PASSWORD', 'Vault password verification failed.')
  }
}

export function destroyVaultKey(key: Buffer | null | undefined) {
  if (Buffer.isBuffer(key)) key.fill(0)
}
