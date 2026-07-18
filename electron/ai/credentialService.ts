import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { AIServiceError } from './types'

const CREDENTIAL_FILE_VERSION = 1
const CREDENTIAL_REF_PATTERN = /^cred_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type AICredentialCryptoAdapter = {
  isAvailable: () => boolean
  encrypt: (plaintext: string) => Buffer
  decrypt: (ciphertext: Buffer) => string
}

type CredentialFileEntry = {
  ciphertext: string
  updatedAt: string
}

type CredentialFile = {
  version: 1
  entries: Record<string, CredentialFileEntry>
}

type AICredentialServiceOptions = {
  now?: () => Date
  randomUUID?: () => string
}

function createEmptyFile(): CredentialFile {
  return { version: CREDENTIAL_FILE_VERSION, entries: {} }
}

function credentialError(
  code: 'invalid_input' | 'credential_unavailable' | 'not_found' | 'storage_error',
  message: string,
  retryable = false,
) {
  return new AIServiceError({ code, message, retryable })
}

function assertCredentialRef(ref: string) {
  if (!CREDENTIAL_REF_PATTERN.test(ref)) {
    throw credentialError('invalid_input', 'Invalid AI credential reference.')
  }
}

function assertSecret(secret: string) {
  if (typeof secret !== 'string' || !secret.trim() || secret.length > 64_000 || secret.includes('\0')) {
    throw credentialError('invalid_input', 'AI credential value is invalid.')
  }
}

export class AICredentialService {
  private readonly filePath: string
  private readonly cryptoAdapter: AICredentialCryptoAdapter
  private readonly now: () => Date
  private readonly randomUUID: () => string

  constructor(
    filePath: string,
    cryptoAdapter: AICredentialCryptoAdapter,
    options: AICredentialServiceOptions = {},
  ) {
    this.filePath = filePath
    this.cryptoAdapter = cryptoAdapter
    this.now = options.now ?? (() => new Date())
    this.randomUUID = options.randomUUID ?? crypto.randomUUID
  }

  isAvailable() {
    return this.cryptoAdapter.isAvailable()
  }

  create(secret: string) {
    this.assertAvailable()
    assertSecret(secret)
    const ref = `cred_${this.randomUUID()}`
    assertCredentialRef(ref)
    const file = this.readFile()
    file.entries[ref] = this.encryptEntry(secret)
    this.writeFile(file)
    return ref
  }

  replace(ref: string, secret: string) {
    this.assertAvailable()
    assertCredentialRef(ref)
    assertSecret(secret)
    const file = this.readFile()
    if (!file.entries[ref]) throw credentialError('not_found', 'AI credential was not found.')
    file.entries[ref] = this.encryptEntry(secret)
    this.writeFile(file)
  }

  reveal(ref: string) {
    this.assertAvailable()
    assertCredentialRef(ref)
    const entry = this.readFile().entries[ref]
    if (!entry) throw credentialError('not_found', 'AI credential was not found.')
    try {
      return this.cryptoAdapter.decrypt(Buffer.from(entry.ciphertext, 'base64'))
    } catch {
      throw credentialError('storage_error', 'AI credential could not be decrypted.')
    }
  }

  has(ref: string) {
    assertCredentialRef(ref)
    return Boolean(this.readFile().entries[ref])
  }

  delete(ref: string) {
    assertCredentialRef(ref)
    const file = this.readFile()
    if (!file.entries[ref]) return false
    delete file.entries[ref]
    this.writeFile(file)
    return true
  }

  clear() {
    this.writeFile(createEmptyFile())
  }

  private assertAvailable() {
    if (!this.cryptoAdapter.isAvailable()) {
      throw credentialError(
        'credential_unavailable',
        'Secure credential storage is unavailable on this system.',
      )
    }
  }

  private encryptEntry(secret: string): CredentialFileEntry {
    try {
      return {
        ciphertext: this.cryptoAdapter.encrypt(secret).toString('base64'),
        updatedAt: this.now().toISOString(),
      }
    } catch {
      throw credentialError('storage_error', 'AI credential could not be encrypted.')
    }
  }

  private readFile(): CredentialFile {
    if (!fs.existsSync(this.filePath)) return createEmptyFile()
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8')) as unknown
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('invalid file')
      const file = parsed as Partial<CredentialFile>
      if (file.version !== CREDENTIAL_FILE_VERSION || !file.entries || typeof file.entries !== 'object') {
        throw new Error('unsupported file')
      }
      for (const [ref, entry] of Object.entries(file.entries)) {
        if (!CREDENTIAL_REF_PATTERN.test(ref)) throw new Error('invalid reference')
        if (
          !entry ||
          typeof entry !== 'object' ||
          typeof entry.ciphertext !== 'string' ||
          typeof entry.updatedAt !== 'string'
        ) {
          throw new Error('invalid entry')
        }
      }
      return file as CredentialFile
    } catch {
      throw credentialError('storage_error', 'AI credential storage is corrupt or unsupported.')
    }
  }

  private writeFile(file: CredentialFile) {
    const parent = path.dirname(this.filePath)
    const temporaryPath = `${this.filePath}.tmp-${process.pid}-${crypto.randomBytes(6).toString('hex')}`
    try {
      fs.mkdirSync(parent, { recursive: true, mode: 0o700 })
      fs.writeFileSync(temporaryPath, JSON.stringify(file, null, 2), { mode: 0o600 })
      fs.renameSync(temporaryPath, this.filePath)
      try {
        fs.chmodSync(this.filePath, 0o600)
      } catch {
        // Windows does not implement POSIX modes consistently; encryption remains mandatory.
      }
    } catch {
      try {
        fs.rmSync(temporaryPath, { force: true })
      } catch {
        // Best-effort cleanup must not replace the original storage error.
      }
      throw credentialError('storage_error', 'AI credential storage could not be written.', true)
    }
  }
}

export function isAICredentialReference(value: string) {
  return CREDENTIAL_REF_PATTERN.test(value)
}
