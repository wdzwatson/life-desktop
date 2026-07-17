import assert from 'node:assert/strict'
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
    assert.deepEqual(service.revealCredential(created.id), {
      password: 'plain secret',
      notes: 'private note',
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

test('generic vault SQL is blocked by the direct database access policy', () => {
  assert.equal(isDirectDbAccessBlocked('vault'), true)
  assert.equal(isDirectDbAccessBlocked('tasks'), false)
  assert.match(getDirectDbAccessError('vault') ?? '', /dedicated vault API/)
  assert.equal(getDirectDbAccessError('tasks'), null)
})
