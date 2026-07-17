import type Database from 'better-sqlite3'
import {
  DEFAULT_VAULT_SCRYPT_PARAMS,
  VAULT_CIPHER_VERSION,
  VaultCryptoError,
  createVaultVerifier,
  decryptVaultSecret,
  deriveVaultKey,
  destroyVaultKey,
  encryptVaultSecret,
  generateVaultId,
  generateVaultSalt,
  verifyVaultKey,
  type VaultScryptParams,
} from './crypto'

const VAULT_SCHEMA_VERSION = 2
const DEFAULT_AUTO_LOCK_MS = 15 * 60 * 1000
const MAX_UNLOCK_FAILURES = 5
const INITIAL_RATE_LIMIT_MS = 30 * 1000

export type VaultStatus =
  | 'not_configured'
  | 'locked'
  | 'unlocked'
  | 'migration_required'
  | 'failed'
  | 'unsupported'

export type VaultCredentialInput = {
  websiteName: string
  url?: string
  username?: string
  password: string
  notes?: string
}

export type VaultCredentialSummary = {
  id: number
  websiteName: string
  url: string
  username: string
  createdAt: string
  updatedAt: string
}

export type VaultServiceErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_PASSWORD'
  | 'VAULT_LOCKED'
  | 'VAULT_NOT_CONFIGURED'
  | 'MIGRATION_REQUIRED'
  | 'CORRUPT_DATA'
  | 'UNSUPPORTED_VERSION'
  | 'RATE_LIMITED'
  | 'STORAGE_ERROR'
  | 'NOT_FOUND'

export class VaultServiceError extends Error {
  code: VaultServiceErrorCode
  retryAt?: number

  constructor(code: VaultServiceErrorCode, message: string, retryAt?: number) {
    super(message)
    this.name = 'VaultServiceError'
    this.code = code
    this.retryAt = retryAt
  }
}

type VaultMetaRow = {
  schema_version: number
  cipher_version: number
  kdf_name: string
  kdf_salt: string
  kdf_n: number
  kdf_r: number
  kdf_p: number
  kdf_maxmem: number
  vault_id: string
  verifier_ciphertext: string
  verifier_iv: string
  verifier_tag: string
  migration_state: 'legacy' | 'ready' | 'failed'
}

type VaultServiceOptions = {
  autoLockMs?: number
  now?: () => number
}

function mapCryptoError(error: unknown): VaultServiceError {
  if (error instanceof VaultServiceError) return error
  if (error instanceof VaultCryptoError) {
    const code = error.code === 'INVALID_INPUT' ? 'INVALID_INPUT' : error.code
    return new VaultServiceError(code, error.message)
  }
  return new VaultServiceError('STORAGE_ERROR', 'Vault operation failed.')
}

export class VaultService {
  private db: Database.Database
  private key: Buffer | null = null
  private autoLockTimer: ReturnType<typeof setTimeout> | null = null
  private autoLockMs: number
  private now: () => number
  private failedUnlocks = 0
  private blockedUntil = 0

  constructor(db: Database.Database, options: VaultServiceOptions = {}) {
    this.db = db
    this.autoLockMs = options.autoLockMs ?? DEFAULT_AUTO_LOCK_MS
    this.now = options.now ?? Date.now
  }

  getStatus(): VaultStatus {
    const meta = this.getMeta()
    if (!meta) {
      const row = this.db.prepare('SELECT COUNT(*) AS count FROM vault').get() as { count: number }
      return row.count > 0 ? 'migration_required' : 'not_configured'
    }
    if (meta.schema_version > VAULT_SCHEMA_VERSION || meta.cipher_version > VAULT_CIPHER_VERSION) {
      return 'unsupported'
    }
    if (meta.migration_state === 'legacy') return 'migration_required'
    if (meta.migration_state === 'failed') return 'failed'
    return this.key ? 'unlocked' : 'locked'
  }

  async setup(masterPassword: string) {
    if (this.getStatus() === 'migration_required') {
      throw new VaultServiceError('MIGRATION_REQUIRED', 'Legacy vault migration is required.')
    }
    if (this.getMeta()) {
      throw new VaultServiceError('INVALID_INPUT', 'Vault is already configured.')
    }
    if (masterPassword.length < 8) {
      throw new VaultServiceError('INVALID_INPUT', 'Master password must contain at least 8 characters.')
    }

    const salt = generateVaultSalt()
    let candidateKey: Buffer | null = null
    try {
      candidateKey = await deriveVaultKey(masterPassword, salt)
      const vaultId = generateVaultId()
      const verifier = createVaultVerifier(candidateKey, vaultId)
      this.db
        .prepare(
          `
          INSERT INTO vault_meta (
            id, schema_version, cipher_version, kdf_name, kdf_salt,
            kdf_n, kdf_r, kdf_p, kdf_maxmem, vault_id,
            verifier_ciphertext, verifier_iv, verifier_tag, migration_state
          ) VALUES (1, ?, ?, 'scrypt', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready')
          `,
        )
        .run(
          VAULT_SCHEMA_VERSION,
          VAULT_CIPHER_VERSION,
          salt.toString('base64'),
          DEFAULT_VAULT_SCRYPT_PARAMS.N,
          DEFAULT_VAULT_SCRYPT_PARAMS.r,
          DEFAULT_VAULT_SCRYPT_PARAMS.p,
          DEFAULT_VAULT_SCRYPT_PARAMS.maxmem,
          vaultId,
          verifier.ciphertext,
          verifier.iv,
          verifier.tag,
        )
      this.installKey(candidateKey)
      candidateKey = null
      return { status: this.getStatus() }
    } catch (error) {
      throw mapCryptoError(error)
    } finally {
      salt.fill(0)
      destroyVaultKey(candidateKey)
    }
  }

  async unlock(masterPassword: string) {
    const status = this.getStatus()
    if (status === 'not_configured') {
      throw new VaultServiceError('VAULT_NOT_CONFIGURED', 'Vault is not configured.')
    }
    if (status === 'migration_required') {
      throw new VaultServiceError('MIGRATION_REQUIRED', 'Legacy vault migration is required.')
    }
    if (status === 'unsupported') {
      throw new VaultServiceError('UNSUPPORTED_VERSION', 'Vault version is not supported.')
    }
    if (status === 'failed') {
      throw new VaultServiceError('CORRUPT_DATA', 'Vault migration previously failed.')
    }
    if (this.blockedUntil > this.now()) {
      throw new VaultServiceError('RATE_LIMITED', 'Vault unlock is temporarily blocked.', this.blockedUntil)
    }

    const meta = this.getMeta()
    if (!meta) throw new VaultServiceError('VAULT_NOT_CONFIGURED', 'Vault is not configured.')
    if (meta.kdf_name !== 'scrypt') {
      throw new VaultServiceError('UNSUPPORTED_VERSION', 'Vault KDF is not supported.')
    }

    let candidateKey: Buffer | null = null
    let salt: Buffer | null = null
    try {
      salt = Buffer.from(meta.kdf_salt, 'base64')
      const params: VaultScryptParams = {
        N: meta.kdf_n,
        r: meta.kdf_r,
        p: meta.kdf_p,
        maxmem: meta.kdf_maxmem,
      }
      candidateKey = await deriveVaultKey(masterPassword, salt, params)
      verifyVaultKey(candidateKey, {
        version: meta.cipher_version,
        vaultId: meta.vault_id,
        ciphertext: meta.verifier_ciphertext,
        iv: meta.verifier_iv,
        tag: meta.verifier_tag,
      })
      this.failedUnlocks = 0
      this.blockedUntil = 0
      this.installKey(candidateKey)
      candidateKey = null
      return { status: this.getStatus() }
    } catch (error) {
      if (error instanceof VaultCryptoError && error.code === 'INVALID_PASSWORD') {
        this.failedUnlocks += 1
        if (this.failedUnlocks >= MAX_UNLOCK_FAILURES) {
          const multiplier = Math.min(this.failedUnlocks - MAX_UNLOCK_FAILURES + 1, 10)
          this.blockedUntil = this.now() + INITIAL_RATE_LIMIT_MS * multiplier
        }
      }
      throw mapCryptoError(error)
    } finally {
      salt?.fill(0)
      destroyVaultKey(candidateKey)
    }
  }

  lock() {
    if (this.autoLockTimer) clearTimeout(this.autoLockTimer)
    this.autoLockTimer = null
    destroyVaultKey(this.key)
    this.key = null
    return { status: this.getStatus() }
  }

  listCredentials(): VaultCredentialSummary[] {
    this.requireKey()
    const rows = this.db
      .prepare(
        `
        SELECT id, website_name, url, username, created_at, updated_at
        FROM vault
        WHERE secret_ciphertext IS NOT NULL
        ORDER BY created_at DESC, id DESC
        `,
      )
      .all() as Array<{
      id: number
      website_name: string
      url: string | null
      username: string | null
      created_at: string
      updated_at: string | null
    }>
    this.touch()
    return rows.map((row) => ({
      id: row.id,
      websiteName: row.website_name,
      url: row.url ?? '',
      username: row.username ?? '',
      createdAt: row.created_at,
      updatedAt: row.updated_at ?? row.created_at,
    }))
  }

  createCredential(input: VaultCredentialInput) {
    const key = this.requireKey()
    const websiteName = input.websiteName.trim()
    if (!websiteName || !input.password) {
      throw new VaultServiceError('INVALID_INPUT', 'Website and password are required.')
    }

    const transaction = this.db.transaction(() => {
      const insert = this.db
        .prepare(
          `
          INSERT INTO vault (
            website_name, url, username, password_encrypted, notes_encrypted, iv, tag
          ) VALUES (?, ?, ?, '', '', '', '')
          `,
        )
        .run(websiteName, input.url?.trim() ?? '', input.username?.trim() ?? '')
      const id = Number(insert.lastInsertRowid)
      const encrypted = encryptVaultSecret(key, id, {
        password: input.password,
        notes: input.notes ?? '',
      })
      this.db
        .prepare(
          `
          UPDATE vault
          SET secret_ciphertext = ?, secret_iv = ?, secret_tag = ?, secret_version = ?,
              updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
          `,
        )
        .run(encrypted.ciphertext, encrypted.iv, encrypted.tag, encrypted.version, id)
      return id
    })

    try {
      const id = transaction()
      this.touch()
      return { id }
    } catch (error) {
      throw mapCryptoError(error)
    }
  }

  revealCredential(id: number) {
    const key = this.requireKey()
    const row = this.db
      .prepare(
        `
        SELECT secret_ciphertext, secret_iv, secret_tag, secret_version
        FROM vault WHERE id = ?
        `,
      )
      .get(id) as
      | {
          secret_ciphertext: string | null
          secret_iv: string | null
          secret_tag: string | null
          secret_version: number | null
        }
      | undefined
    if (!row) throw new VaultServiceError('NOT_FOUND', 'Credential was not found.')
    if (!row.secret_ciphertext || !row.secret_iv || !row.secret_tag || !row.secret_version) {
      throw new VaultServiceError('MIGRATION_REQUIRED', 'Credential requires migration.')
    }

    try {
      const secret = decryptVaultSecret(key, id, {
        version: row.secret_version,
        ciphertext: row.secret_ciphertext,
        iv: row.secret_iv,
        tag: row.secret_tag,
      })
      this.touch()
      return secret
    } catch (error) {
      throw mapCryptoError(error)
    }
  }

  deleteCredential(id: number) {
    this.requireKey()
    const result = this.db.prepare('DELETE FROM vault WHERE id = ?').run(id)
    if (result.changes === 0) {
      throw new VaultServiceError('NOT_FOUND', 'Credential was not found.')
    }
    this.touch()
    return { success: true }
  }

  dispose() {
    this.lock()
  }

  private getMeta() {
    return this.db.prepare('SELECT * FROM vault_meta WHERE id = 1').get() as VaultMetaRow | undefined
  }

  private requireKey() {
    if (!this.key) throw new VaultServiceError('VAULT_LOCKED', 'Vault is locked.')
    return this.key
  }

  private installKey(key: Buffer) {
    this.lock()
    this.key = key
    this.touch()
  }

  private touch() {
    if (!this.key) return
    if (this.autoLockTimer) clearTimeout(this.autoLockTimer)
    this.autoLockTimer = setTimeout(() => this.lock(), this.autoLockMs)
    this.autoLockTimer.unref?.()
  }
}

export function serializeVaultError(error: unknown) {
  const mapped = mapCryptoError(error)
  return {
    success: false as const,
    error: {
      code: mapped.code,
      message: mapped.message,
      retryAt: mapped.retryAt,
    },
  }
}
