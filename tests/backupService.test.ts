import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { test } from 'node:test'
import { createLifeOsBackupPackage } from '../electron/backup/service'

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
    writeFixture(path.join(baseDir, 'users', 'guest', 'files', 'notes', 'today.md'), '# Today')
    writeFixture(path.join(baseDir, 'users', 'guest', 'files', 'books', 'reading.epub'), 'epub')
    writeFixture(path.join(baseDir, 'users', 'guest', 'files', 'videos', 'default.mp4'), 'video')
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
      now: () => new Date('2026-07-17T08:00:00.000Z'),
    })

    assert.equal(existsSync(result.filePath), true)
    const zip = new AdmZip(result.filePath)
    const entryNames = zip.getEntries().map((entry) => entry.entryName)
    assert.deepEqual(entryNames, [
      'config/settings.json',
      'manifest.json',
      'users/guest/database/books.db',
      'users/guest/database/tasks.db',
      'users/guest/files/books/reading.epub',
      'users/guest/files/notes/today.md',
      'users/guest/files/videos/default.mp4',
    ])
    assert.equal(entryNames.some((entry) => entry.includes('vault-sensitive-backups')), false)
    assert.equal(entryNames.some((entry) => entry.includes('external.mp4')), false)

    const manifest = JSON.parse(zip.readAsText('manifest.json'))
    assert.equal(manifest.format, 'lifeos-backup')
    assert.equal(manifest.formatVersion, 1)
    assert.equal(manifest.sourcePlatform, process.platform)
    assert.equal(manifest.userId, 'guest')
    assert.equal(manifest.includes.externalVideoDirectory, externalVideoDir)
    assert.equal(manifest.includes.sensitiveVaultLegacyBackups, false)
    assert.equal(manifest.files.length, 6)

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
