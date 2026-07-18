import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { test } from 'node:test'
import {
  createLifeOsBackupPackage,
  inspectLifeOsBackupPackage,
  restoreLifeOsBackupPackage,
  writeBackupArchive,
} from '../electron/backup/service'

function writeFixture(filePath: string, content: string) {
  mkdirSync(path.dirname(filePath), { recursive: true })
  writeFileSync(filePath, content)
}

test('creates a manifest-backed user backup and excludes sensitive legacy vault backups', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'lifeos-backup-service-'))
  const baseDir = path.join(root, 'LifeOS')
  const outputDir = path.join(root, 'exports')
  const externalVideoDir = path.join(root, 'external-videos')
  const settingsFile = path.join(baseDir, 'config', 'settings.json')

  try {
    writeFixture(settingsFile, '{"language":"zh-CN"}')
    writeFixture(path.join(baseDir, 'users', 'guest', 'database', 'tasks.db'), 'tasks')
    writeFixture(path.join(baseDir, 'users', 'guest', 'database', 'books.db'), 'books')
    writeFixture(path.join(baseDir, 'users', 'guest', 'database', 'ai.db'), 'ai database')
    writeFixture(path.join(baseDir, 'users', 'guest', 'files', 'notes', 'today.md'), '# Today')
    writeFixture(path.join(baseDir, 'users', 'guest', 'files', 'books', 'reading.epub'), 'epub')
    writeFixture(path.join(baseDir, 'users', 'guest', 'files', 'videos', 'default.mp4'), 'video')
    writeFixture(path.join(baseDir, 'users', 'guest', 'files', 'ai-media', 'image', 'result.png'), 'ai image')
    writeFixture(path.join(baseDir, 'users', 'guest', 'config', 'ai-credentials.json'), 'encrypted but excluded')
    writeFixture(
      path.join(baseDir, 'users', 'guest', 'database', 'vault-sensitive-backups', 'legacy.db'),
      'secret',
    )
    writeFixture(path.join(externalVideoDir, 'external.mp4'), 'external')

    const result = createLifeOsBackupPackage({
      appVersion: '1.0.1',
      baseDir,
      outputDir,
      settingsFile,
      userId: 'guest',
      videoDownloadDir: externalVideoDir,
      aiSchemaVersion: 2,
      now: () => new Date('2026-07-17T08:00:00.000Z'),
    })

    assert.equal(existsSync(result.filePath), true)
    const zip = new AdmZip(result.filePath)
    const entryNames = zip.getEntries().map((entry) => entry.entryName)
    assert.deepEqual(entryNames, [
      'config/settings.json',
      'manifest.json',
      'users/guest/database/ai.db',
      'users/guest/database/books.db',
      'users/guest/database/tasks.db',
      'users/guest/files/ai-media/image/result.png',
      'users/guest/files/books/reading.epub',
      'users/guest/files/notes/today.md',
      'users/guest/files/videos/default.mp4',
    ])
    assert.equal(entryNames.some((entry) => entry.includes('vault-sensitive-backups')), false)
    assert.equal(entryNames.some((entry) => entry.includes('external.mp4')), false)
    assert.equal(entryNames.some((entry) => entry.includes('ai-credentials.json')), false)

    const manifest = JSON.parse(zip.readAsText('manifest.json'))
    assert.equal(manifest.format, 'lifeos-backup')
    assert.equal(manifest.formatVersion, 1)
    assert.equal(manifest.sourcePlatform, process.platform)
    assert.equal(manifest.userId, 'guest')
    assert.equal(manifest.includes.externalVideoDirectory, externalVideoDir)
    assert.equal(manifest.includes.sensitiveVaultLegacyBackups, false)
    assert.equal(manifest.includes.aiDatabase, true)
    assert.equal(manifest.includes.aiMediaFiles, true)
    assert.equal(manifest.includes.aiSchemaVersion, 2)
    assert.equal(manifest.includes.aiCredentials, false)
    assert.equal(manifest.files.length, 8)

    for (const file of manifest.files) {
      const content = zip.readFile(file.path)
      assert.ok(content)
      assert.equal(file.size, content.length)
      assert.equal(createHash('sha256').update(content).digest('hex'), file.sha256)
    }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('removes a partial backup archive when the destination write fails', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'lifeos-backup-write-failure-'))
  const sourceFile = path.join(root, 'tasks.db')
  const outputPath = path.join(root, 'lifeos-backup-guest.zip')

  try {
    writeFixture(sourceFile, 'tasks')
    const failingZip = {
      writeZip(targetFileName: string) {
        writeFileSync(targetFileName, 'partial archive')
        throw Object.assign(new Error('ENOSPC: no space left on device, write'), { code: 'ENOSPC' })
      },
    }

    assert.throws(
      () => writeBackupArchive(failingZip, outputPath),
      /ENOSPC/,
    )
    assert.equal(existsSync(outputPath), false)
    assert.equal(readFileSync(sourceFile, 'utf8'), 'tasks')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('standard backup validation rejects an injected AI credential file', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'lifeos-backup-ai-credential-'))
  const baseDir = path.join(root, 'LifeOS')
  const outputDir = path.join(root, 'exports')
  const settingsFile = path.join(baseDir, 'config', 'settings.json')
  try {
    writeFixture(settingsFile, '{}')
    const backup = createLifeOsBackupPackage({
      appVersion: '1.0.2',
      baseDir,
      outputDir,
      settingsFile,
      userId: 'guest',
    })
    const injectedPath = path.join(root, 'injected.zip')
    const zip = new AdmZip(backup.filePath)
    const credentialPath = 'users/guest/config/ai-credentials.json'
    const credential = Buffer.from('credential payload')
    const manifest = JSON.parse(zip.readAsText('manifest.json'))
    manifest.files.push({
      path: credentialPath,
      size: credential.length,
      sha256: createHash('sha256').update(credential).digest('hex'),
    })
    zip.addFile(credentialPath, credential)
    zip.updateFile('manifest.json', Buffer.from(JSON.stringify(manifest), 'utf8'))
    zip.writeZip(injectedPath)
    assert.throws(() => inspectLifeOsBackupPackage(injectedPath), /AI credentials cannot be restored/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('validates and restores a backup atomically while preserving sensitive recovery backups', async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'lifeos-restore-service-'))
  const sourceBaseDir = path.join(root, 'source-LifeOS')
  const targetBaseDir = path.join(root, 'target-LifeOS')
  const sourceSettingsFile = path.join(sourceBaseDir, 'config', 'settings.json')
  const targetSettingsFile = path.join(targetBaseDir, 'config', 'settings.json')
  const outputDir = path.join(root, 'exports')

  try {
    writeFixture(sourceSettingsFile, '{"lastUserId":"guest","language":"zh-CN"}')
    writeFixture(path.join(sourceBaseDir, 'users', 'guest', 'database', 'tasks.db'), 'restored tasks')
    writeFixture(path.join(sourceBaseDir, 'users', 'guest', 'files', 'notes', 'today.md'), 'restored note')
    const backup = createLifeOsBackupPackage({
      appVersion: '1.0.1',
      baseDir: sourceBaseDir,
      outputDir,
      settingsFile: sourceSettingsFile,
      userId: 'guest',
      now: () => new Date('2026-07-17T08:00:00.000Z'),
    })

    writeFixture(targetSettingsFile, '{"lastUserId":"guest","language":"en-US"}')
    writeFixture(path.join(targetBaseDir, 'users', 'guest', 'database', 'old.db'), 'old data')
    writeFixture(
      path.join(targetBaseDir, 'users', 'guest', 'database', 'vault-sensitive-backups', 'legacy.db'),
      'keep this recovery file',
    )

    const inspection = inspectLifeOsBackupPackage(backup.filePath)
    assert.equal(inspection.manifest.formatVersion, 1)
    assert.equal(inspection.fileCount, 3)

    const result = restoreLifeOsBackupPackage({
      archivePath: backup.filePath,
      baseDir: targetBaseDir,
      settingsFile: targetSettingsFile,
      targetUserId: 'guest',
    })
    assert.equal(result.restoredUserId, 'guest')
    assert.equal(readFileSync(path.join(targetBaseDir, 'users', 'guest', 'database', 'tasks.db'), 'utf8'), 'restored tasks')
    assert.equal(readFileSync(path.join(targetBaseDir, 'users', 'guest', 'files', 'notes', 'today.md'), 'utf8'), 'restored note')
    assert.equal(existsSync(path.join(targetBaseDir, 'users', 'guest', 'database', 'old.db')), false)
    assert.equal(
      readFileSync(
        path.join(targetBaseDir, 'users', 'guest', 'database', 'vault-sensitive-backups', 'legacy.db'),
        'utf8',
      ),
      'keep this recovery file',
    )

    const corruptArchivePath = path.join(root, 'corrupt.zip')
    const corruptZip = new AdmZip(backup.filePath)
    const corruptManifest = JSON.parse(corruptZip.readAsText('manifest.json'))
    corruptManifest.files[0].sha256 = '0'.repeat(64)
    corruptZip.updateFile('manifest.json', Buffer.from(JSON.stringify(corruptManifest), 'utf8'))
    corruptZip.writeZip(corruptArchivePath)

    assert.throws(
      () =>
        restoreLifeOsBackupPackage({
          archivePath: corruptArchivePath,
          baseDir: targetBaseDir,
          settingsFile: targetSettingsFile,
          targetUserId: 'guest',
        }),
      /checksum mismatch/,
    )
    assert.equal(readFileSync(targetSettingsFile, 'utf8'), '{"lastUserId":"guest","language":"zh-CN"}')
    assert.equal(
      readFileSync(
        path.join(targetBaseDir, 'users', 'guest', 'database', 'vault-sensitive-backups', 'legacy.db'),
        'utf8',
      ),
      'keep this recovery file',
    )
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
