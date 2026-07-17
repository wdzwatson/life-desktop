import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import Database from 'better-sqlite3'
import { initializeVaultSchema } from '../electron/vault/schema.ts'
import { VaultService, VaultServiceError } from '../electron/vault/service.ts'
import { getDirectDbAccessError, isDirectDbAccessBlocked } from '../electron/db/accessPolicy.ts'

function createVaultDatabase() {
  const db = new Database(':memory:')
  initializeVaultSchema(db)
  return db
}

function createVaultFileDatabase(dir) {
  const dbPath = path.join(dir, 'vault.db')
  const db = new Database(dbPath)
  initializeVaultSchema(db)
  return { db, dbPath }
}

test('vault setup unlocks, locks, and unlocks a configured vault', async () => {
  const db = createVaultDatabase()
  const service = new VaultService(db, { autoLockMs: 1000 })
  try {
    assert.equal(service.getStatus(), 'not_configured')

    assert.deepEqual(await service.setup('correct horse battery staple'), { status: 'unlocked' })
    assert.equal(service.getStatus(), 'unlocked')

    assert.deepEqual(service.lock(), { status: 'locked' })
    assert.equal(service.getStatus(), 'locked')

    assert.deepEqual(await service.unlock('correct horse battery staple'), { status: 'unlocked' })
    assert.equal(service.getStatus(), 'unlocked')
  } finally {
    service.dispose()
    db.close()
  }
})

test('vault rejects wrong passwords and rate limits repeated failures', async () => {
  let now = 1000
  const db = createVaultDatabase()
  const service = new VaultService(db, { now: () => now })
  try {
    await service.setup('correct horse battery staple')
    service.lock()

    for (let index = 0; index < 4; index += 1) {
      await assert.rejects(
        () => service.unlock('wrong password'),
        (error) => error instanceof VaultServiceError && error.code === 'INVALID_PASSWORD',
      )
    }

    await assert.rejects(
      () => service.unlock('wrong password'),
      (error) => error instanceof VaultServiceError && error.code === 'INVALID_PASSWORD',
    )
    await assert.rejects(
      () => service.unlock('correct horse battery staple'),
      (error) =>
        error instanceof VaultServiceError &&
        error.code === 'RATE_LIMITED' &&
        error.retryAt === 31000,
    )

    now = 31001
    assert.deepEqual(await service.unlock('correct horse battery staple'), { status: 'unlocked' })
  } finally {
    service.dispose()
    db.close()
  }
})

test('vault auto-locks after inactivity', async () => {
  const db = createVaultDatabase()
  const service = new VaultService(db, { autoLockMs: 20 })
  try {
    await service.setup('correct horse battery staple')
    assert.equal(service.getStatus(), 'unlocked')
    await delay(40)
    assert.equal(service.getStatus(), 'locked')
  } finally {
    service.dispose()
    db.close()
  }
})

test('vault stores encrypted secrets and reveals them on demand', async () => {
  const db = createVaultDatabase()
  const service = new VaultService(db)
  try {
    await service.setup('correct horse battery staple')
    const created = service.createCredential({
      websiteName: 'Example',
      url: 'https://example.com',
      username: 'alice',
      password: 'plain secret',
      notes: 'private note',
    })

    const rows = db.prepare('SELECT * FROM vault').all()
    assert.equal(rows.length, 1)
    assert.equal(rows[0].website_name, 'Example')
    assert.notEqual(rows[0].secret_ciphertext, 'plain secret')
    assert.equal(JSON.stringify(rows).includes('plain secret'), false)
    assert.equal(JSON.stringify(rows).includes('private note'), false)

    assert.deepEqual(service.listCredentials(), [
      {
        id: created.id,
        websiteName: 'Example',
        url: 'https://example.com',
        username: 'alice',
        createdAt: rows[0].created_at,
        updatedAt: rows[0].updated_at,
      },
    ])
    assert.equal(JSON.stringify(service.listCredentials()).includes('plain secret'), false)
    assert.equal(JSON.stringify(service.listCredentials()).includes('private note'), false)
    assert.deepEqual(service.revealCredential(created.id), {
      password: 'plain secret',
      notes: 'private note',
    })
  } finally {
    service.dispose()
    db.close()
  }
})

test('vault rejects empty credential passwords', async () => {
  const db = createVaultDatabase()
  const service = new VaultService(db)
  try {
    await service.setup('correct horse battery staple')
    assert.throws(
      () =>
        service.createCredential({
          websiteName: 'Example',
          password: '',
        }),
      (error) => error instanceof VaultServiceError && error.code === 'INVALID_INPUT',
    )
  } finally {
    service.dispose()
    db.close()
  }
})

test('vault locks sensitive operations and recovers after unlock', async () => {
  const db = createVaultDatabase()
  const service = new VaultService(db)
  try {
    await service.setup('correct horse battery staple')
    const created = service.createCredential({
      websiteName: 'Example',
      password: 'plain secret',
    })

    service.lock()
    for (const operation of [
      () => service.listCredentials(),
      () => service.revealCredential(created.id),
      () => service.createCredential({ websiteName: 'Other', password: 'other secret' }),
    ]) {
      assert.throws(
        operation,
        (error) => error instanceof VaultServiceError && error.code === 'VAULT_LOCKED',
      )
    }

    await service.unlock('correct horse battery staple')
    assert.deepEqual(service.revealCredential(created.id), {
      password: 'plain secret',
      notes: '',
    })
  } finally {
    service.dispose()
    db.close()
  }
})

test('vault rejects tampered encrypted payloads', async () => {
  const db = createVaultDatabase()
  const service = new VaultService(db)
  try {
    await service.setup('correct horse battery staple')
    const created = service.createCredential({
      websiteName: 'Example',
      password: 'plain secret',
    })
    db.prepare('UPDATE vault SET secret_ciphertext = ? WHERE id = ?').run('AAAA', created.id)

    assert.throws(
      () => service.revealCredential(created.id),
      (error) => error instanceof VaultServiceError && error.code === 'CORRUPT_DATA',
    )
  } finally {
    service.dispose()
    db.close()
  }
})

test('legacy rows report migration required before setup', () => {
  const db = createVaultDatabase()
  try {
    db.prepare(
      `
      INSERT INTO vault (website_name, password_encrypted, iv, tag)
      VALUES ('Legacy', 'plaintext', 'iv', 'tag')
      `,
    ).run()
    const service = new VaultService(db)
    assert.equal(service.getStatus(), 'migration_required')
  } finally {
    db.close()
  }
})

test('vault migrates legacy plaintext rows into encrypted payloads with a sensitive backup', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lifeos-vault-migration-'))
  const backupDir = path.join(dir, 'backups')
  const { db, dbPath } = createVaultFileDatabase(dir)
  const service = new VaultService(db, {
    backupDir,
    dbPath,
    now: () => Date.UTC(2026, 6, 17, 12, 0, 0),
  })
  let backupDb
  try {
    db.prepare(
      `
      INSERT INTO vault (website_name, url, username, password_encrypted, notes_encrypted, iv, tag)
      VALUES ('Legacy', 'https://example.com', 'alice', 'legacy secret', 'legacy note', 'iv_mock', 'tag_mock')
      `,
    ).run()

    assert.equal(service.getStatus(), 'migration_required')
    const result = await service.migrateLegacy('correct horse battery staple')
    assert.equal(result.status, 'unlocked')
    assert.equal(result.migratedCount, 1)
    assert.ok(result.backupPath.startsWith(backupDir))
    assert.equal(existsSync(result.backupPath), true)

    const row = db.prepare('SELECT * FROM vault').get()
    assert.equal(row.password_encrypted, '')
    assert.equal(row.notes_encrypted, '')
    assert.equal(row.iv, '')
    assert.equal(row.tag, '')
    assert.equal(JSON.stringify(row).includes('legacy secret'), false)
    assert.equal(JSON.stringify(row).includes('legacy note'), false)

    assert.deepEqual(service.revealCredential(row.id), {
      password: 'legacy secret',
      notes: 'legacy note',
    })
    assert.equal(service.listCredentials()[0].websiteName, 'Legacy')

    backupDb = new Database(result.backupPath, { readonly: true })
    const backupRow = backupDb.prepare('SELECT password_encrypted, notes_encrypted FROM vault').get()
    assert.deepEqual(backupRow, {
      password_encrypted: 'legacy secret',
      notes_encrypted: 'legacy note',
    })

    assert.deepEqual(await service.migrateLegacy('correct horse battery staple'), {
      status: 'unlocked',
      migratedCount: 0,
      backupPath: null,
    })
  } finally {
    backupDb?.close()
    service.dispose()
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('failed legacy migration rolls back encrypted writes and metadata', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lifeos-vault-migration-fail-'))
  const backupDir = path.join(dir, 'backups')
  const { db, dbPath } = createVaultFileDatabase(dir)
  const service = new VaultService(db, { backupDir, dbPath })
  try {
    db.prepare(
      `
      INSERT INTO vault (website_name, password_encrypted, notes_encrypted, iv, tag)
      VALUES ('Legacy', 'legacy secret', 'legacy note', 'iv_mock', 'tag_mock')
      `,
    ).run()
    db.exec(`
      CREATE TRIGGER fail_vault_migration_update
      BEFORE UPDATE ON vault
      BEGIN
        SELECT RAISE(ABORT, 'forced migration rollback');
      END;
    `)

    await assert.rejects(
      () => service.migrateLegacy('correct horse battery staple'),
      (error) => error instanceof VaultServiceError && error.code === 'STORAGE_ERROR',
    )

    assert.equal(service.getStatus(), 'migration_required')
    assert.deepEqual(db.prepare('SELECT COUNT(*) AS count FROM vault_meta').get(), { count: 0 })
    assert.deepEqual(
      db
        .prepare('SELECT password_encrypted, notes_encrypted, secret_ciphertext FROM vault')
        .get(),
      {
        password_encrypted: 'legacy secret',
        notes_encrypted: 'legacy note',
        secret_ciphertext: null,
      },
    )
    assert.equal(existsSync(backupDir), true)
  } finally {
    service.dispose()
    db.close()
    rmSync(dir, { recursive: true, force: true })
  }
})

test('generic vault SQL is blocked by the direct database access policy', () => {
  assert.equal(isDirectDbAccessBlocked('vault'), true)
  assert.equal(isDirectDbAccessBlocked('tasks'), false)
  assert.match(getDirectDbAccessError('vault') ?? '', /dedicated vault API/)
  assert.equal(getDirectDbAccessError('tasks'), null)
})
