import AdmZip from 'adm-zip'
import crypto from 'crypto'
import fs from 'fs'
import path from 'path'

export type BackupFileEntry = {
  path: string
  size: number
  sha256: string
}

export type BackupManifest = {
  format: 'lifeos-backup'
  formatVersion: 1
  appVersion: string
  sourcePlatform: NodeJS.Platform
  createdAt: string
  userId: string
  includes: {
    settings: boolean
    databases: boolean
    noteFiles: boolean
    bookFiles: boolean
    defaultVideoFiles: boolean
    aiDatabase: boolean
    aiMediaFiles: boolean
    aiSchemaVersion: number | null
    aiCredentials: false
    externalVideoDirectory: string | null
    sensitiveVaultLegacyBackups: false
  }
  files: BackupFileEntry[]
}

export type CreateBackupInput = {
  appVersion: string
  sourcePlatform?: NodeJS.Platform
  baseDir: string
  outputDir: string
  settingsFile: string
  userId: string
  videoDownloadDir?: string
  aiSchemaVersion?: number
  now?: () => Date
}

export type CreateBackupResult = {
  filePath: string
  manifest: BackupManifest
}

export type BackupInspection = {
  manifest: BackupManifest
  fileCount: number
}

export type RestoreBackupInput = {
  archivePath: string
  baseDir: string
  settingsFile: string
  targetUserId: string
}

export type RestoreBackupResult = {
  manifest: BackupManifest
  restoredUserId: string
  restoredFileCount: number
}

function toArchivePath(filePath: string) {
  return filePath.split(path.sep).join('/')
}

function hashFile(filePath: string) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

function walkFiles(root: string, shouldExclude: (filePath: string) => boolean) {
  if (!fs.existsSync(root)) return []
  const results: string[] = []
  const stack = [root]

  while (stack.length > 0) {
    const current = stack.pop() as string
    if (shouldExclude(current)) continue
    const stat = fs.statSync(current)
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(current)) {
        stack.push(path.join(current, entry))
      }
    } else if (stat.isFile()) {
      results.push(current)
    }
  }

  return results.sort((left, right) => left.localeCompare(right))
}

function isInside(child: string, parent: string) {
  const relative = path.relative(parent, child)
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function getTimestamp(date: Date) {
  return date.toISOString().replace(/[:.]/g, '-')
}

function assertSafeArchivePath(value: string) {
  if (
    !value ||
    value.includes('\\') ||
    value.includes('\0') ||
    path.posix.isAbsolute(value) ||
    path.posix.normalize(value) !== value ||
    value === '.' ||
    value.startsWith('../')
  ) {
    throw new Error(`Unsafe backup path: ${value}`)
  }
}

function assertSafeUserId(userId: string) {
  if (!userId || userId === '.' || userId === '..' || path.basename(userId) !== userId) {
    throw new Error('Invalid backup user ID.')
  }
}

function readValidatedBackupArchive(archivePath: string) {
  if (!fs.existsSync(archivePath)) throw new Error('Backup file not found.')

  const zip = new AdmZip(archivePath)
  const manifestEntry = zip.getEntry('manifest.json')
  if (!manifestEntry) throw new Error('Backup manifest is missing.')

  let manifest: BackupManifest
  try {
    manifest = JSON.parse(manifestEntry.getData().toString('utf8')) as BackupManifest
  } catch {
    throw new Error('Backup manifest is invalid JSON.')
  }

  if (manifest.format !== 'lifeos-backup') {
    throw new Error('Unsupported backup format.')
  }
  if (manifest.formatVersion !== 1) {
    throw new Error(`Unsupported backup version: ${String(manifest.formatVersion)}`)
  }
  assertSafeUserId(manifest.userId)
  if (!Array.isArray(manifest.files)) throw new Error('Backup manifest file list is invalid.')

  const expectedPaths = new Set<string>()
  const userPrefix = `users/${manifest.userId}/`
  for (const file of manifest.files) {
    if (
      !file ||
      typeof file.path !== 'string' ||
      !Number.isInteger(file.size) ||
      file.size < 0 ||
      typeof file.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(file.sha256)
    ) {
      throw new Error('Backup manifest contains an invalid file entry.')
    }
    assertSafeArchivePath(file.path)
    if (file.path === 'manifest.json' || expectedPaths.has(file.path)) {
      throw new Error(`Duplicate or reserved backup path: ${file.path}`)
    }
    if (file.path !== 'config/settings.json' && !file.path.startsWith(userPrefix)) {
      throw new Error(`Backup file is outside the supported boundary: ${file.path}`)
    }
    if (file.path.includes('/vault-sensitive-backups/')) {
      throw new Error('Sensitive vault backups cannot be restored.')
    }
    if (path.posix.basename(file.path) === 'ai-credentials.json') {
      throw new Error('AI credentials cannot be restored from a standard backup.')
    }

    const entry = zip.getEntry(file.path)
    if (!entry || entry.isDirectory) throw new Error(`Backup file is missing: ${file.path}`)
    const content = entry.getData()
    if (content.length !== file.size) throw new Error(`Backup size mismatch: ${file.path}`)
    const checksum = crypto.createHash('sha256').update(content).digest('hex')
    if (checksum !== file.sha256) throw new Error(`Backup checksum mismatch: ${file.path}`)
    expectedPaths.add(file.path)
  }

  for (const entry of zip.getEntries()) {
    if (entry.entryName === 'manifest.json') continue
    assertSafeArchivePath(entry.entryName)
    if (entry.isDirectory || !expectedPaths.has(entry.entryName)) {
      throw new Error(`Unexpected backup entry: ${entry.entryName}`)
    }
  }

  return { zip, manifest }
}

export function inspectLifeOsBackupPackage(archivePath: string): BackupInspection {
  const { manifest } = readValidatedBackupArchive(archivePath)
  return { manifest, fileCount: manifest.files.length }
}

export function writeBackupArchive(zip: Pick<AdmZip, 'writeZip'>, outputPath: string) {
  try {
    zip.writeZip(outputPath)
  } catch (error) {
    fs.rmSync(outputPath, { force: true })
    throw error
  }
}

export function restoreLifeOsBackupPackage(input: RestoreBackupInput): RestoreBackupResult {
  assertSafeUserId(input.targetUserId)
  const { zip, manifest } = readValidatedBackupArchive(input.archivePath)
  const stageRoot = fs.mkdtempSync(path.join(input.baseDir, '.lifeos-restore-staging-'))
  const rollbackRoot = path.join(input.baseDir, `.lifeos-restore-rollback-${Date.now()}`)
  const stagedUserDir = path.join(stageRoot, 'users', input.targetUserId)
  const stagedSettingsFile = path.join(stageRoot, 'config', 'settings.json')
  const targetUserDir = path.join(input.baseDir, 'users', input.targetUserId)
  const targetSensitiveDir = path.join(targetUserDir, 'database', 'vault-sensitive-backups')
  const rollbackUserDir = path.join(rollbackRoot, 'users', input.targetUserId)
  const preservedSensitiveDir = path.join(rollbackRoot, 'preserved-vault-sensitive-backups')
  const rollbackSettingsFile = path.join(rollbackRoot, 'config', 'settings.json')
  const userPrefix = `users/${manifest.userId}/`
  let settingsMoved = false
  let userMoved = false
  let userInstalled = false
  let settingsInstalled = false
  let sensitiveInstalled = false

  const restoreRollback = () => {
    if (sensitiveInstalled && fs.existsSync(targetSensitiveDir)) {
      fs.mkdirSync(path.dirname(preservedSensitiveDir), { recursive: true })
      fs.renameSync(targetSensitiveDir, preservedSensitiveDir)
    }
    if (settingsInstalled && fs.existsSync(input.settingsFile)) {
      fs.rmSync(input.settingsFile, { force: true })
    }
    if (userInstalled && fs.existsSync(targetUserDir)) {
      fs.rmSync(targetUserDir, { recursive: true, force: true })
    }
    if (settingsMoved && fs.existsSync(rollbackSettingsFile)) {
      fs.mkdirSync(path.dirname(input.settingsFile), { recursive: true })
      fs.renameSync(rollbackSettingsFile, input.settingsFile)
    }
    if (userMoved && fs.existsSync(rollbackUserDir)) {
      fs.mkdirSync(path.dirname(targetUserDir), { recursive: true })
      fs.renameSync(rollbackUserDir, targetUserDir)
    }
    if (fs.existsSync(preservedSensitiveDir)) {
      fs.mkdirSync(path.dirname(targetSensitiveDir), { recursive: true })
      fs.renameSync(preservedSensitiveDir, targetSensitiveDir)
    }
  }

  try {
    fs.mkdirSync(stagedUserDir, { recursive: true })
    for (const file of manifest.files) {
      const entry = zip.getEntry(file.path)
      if (!entry) throw new Error(`Backup file is missing: ${file.path}`)
      const destination =
        file.path === 'config/settings.json'
          ? stagedSettingsFile
          : path.join(stagedUserDir, file.path.slice(userPrefix.length))
      if (!destination.startsWith(stageRoot + path.sep)) {
        throw new Error(`Backup file escaped restore staging: ${file.path}`)
      }
      fs.mkdirSync(path.dirname(destination), { recursive: true })
      fs.writeFileSync(destination, entry.getData())
    }

    fs.mkdirSync(rollbackRoot, { recursive: true })
    if (fs.existsSync(input.settingsFile)) {
      fs.mkdirSync(path.dirname(rollbackSettingsFile), { recursive: true })
      fs.renameSync(input.settingsFile, rollbackSettingsFile)
      settingsMoved = true
    }
    if (fs.existsSync(targetUserDir)) {
      fs.mkdirSync(path.dirname(rollbackUserDir), { recursive: true })
      fs.renameSync(targetUserDir, rollbackUserDir)
      userMoved = true
      const oldSensitiveDir = path.join(rollbackUserDir, 'database', 'vault-sensitive-backups')
      if (fs.existsSync(oldSensitiveDir)) fs.renameSync(oldSensitiveDir, preservedSensitiveDir)
    }

    fs.mkdirSync(path.dirname(targetUserDir), { recursive: true })
    fs.renameSync(stagedUserDir, targetUserDir)
    userInstalled = true
    if (fs.existsSync(stagedSettingsFile)) {
      fs.mkdirSync(path.dirname(input.settingsFile), { recursive: true })
      fs.renameSync(stagedSettingsFile, input.settingsFile)
      settingsInstalled = true
    }
    if (fs.existsSync(preservedSensitiveDir)) {
      fs.mkdirSync(path.dirname(targetSensitiveDir), { recursive: true })
      fs.renameSync(preservedSensitiveDir, targetSensitiveDir)
      sensitiveInstalled = true
    }

    fs.rmSync(rollbackRoot, { recursive: true, force: true })
    return {
      manifest,
      restoredUserId: input.targetUserId,
      restoredFileCount: manifest.files.length,
    }
  } catch (error) {
    try {
      restoreRollback()
    } catch (rollbackError) {
      throw new Error(
        `Restore failed and rollback could not complete: ${String(rollbackError)}`,
        { cause: rollbackError },
      )
    }
    throw error
  } finally {
    fs.rmSync(stageRoot, { recursive: true, force: true })
    fs.rmSync(rollbackRoot, { recursive: true, force: true })
  }
}

export function createLifeOsBackupPackage(input: CreateBackupInput): CreateBackupResult {
  const createdAt = input.now?.() ?? new Date()
  const userDir = path.join(input.baseDir, 'users', input.userId)
  const defaultVideoDir = path.join(userDir, 'files', 'videos')
  const configuredVideoDir = input.videoDownloadDir?.trim() || ''
  const hasExternalVideoDir =
    configuredVideoDir &&
    path.resolve(configuredVideoDir) !== path.resolve(defaultVideoDir) &&
    !isInside(path.resolve(configuredVideoDir), path.resolve(defaultVideoDir))

  fs.mkdirSync(input.outputDir, { recursive: true })
  const fileName = `lifeos-backup-${input.userId}-${getTimestamp(createdAt)}.zip`
  const outputPath = path.join(input.outputDir, fileName)
  const zip = new AdmZip()
  const files: BackupFileEntry[] = []

  const addFile = (absolutePath: string, archivePath: string) => {
    const stat = fs.statSync(absolutePath)
    zip.addLocalFile(absolutePath, path.dirname(archivePath), path.basename(archivePath))
    files.push({
      path: toArchivePath(archivePath),
      size: stat.size,
      sha256: hashFile(absolutePath),
    })
  }

  if (fs.existsSync(input.settingsFile)) {
    addFile(input.settingsFile, 'config/settings.json')
  }

  const excludedSegments = new Set(['vault-sensitive-backups'])
  for (const filePath of walkFiles(userDir, (candidate) =>
    candidate.split(path.sep).some((segment) => excludedSegments.has(segment))
      || path.basename(candidate) === 'ai-credentials.json',
  )) {
    addFile(filePath, path.join('users', input.userId, path.relative(userDir, filePath)))
  }

  const manifest: BackupManifest = {
    format: 'lifeos-backup',
    formatVersion: 1,
    appVersion: input.appVersion,
    sourcePlatform: input.sourcePlatform ?? process.platform,
    createdAt: createdAt.toISOString(),
    userId: input.userId,
    includes: {
      settings: fs.existsSync(input.settingsFile),
      databases: fs.existsSync(path.join(userDir, 'database')),
      noteFiles: fs.existsSync(path.join(userDir, 'files', 'notes')),
      bookFiles: fs.existsSync(path.join(userDir, 'files', 'books')),
      defaultVideoFiles: fs.existsSync(defaultVideoDir),
      aiDatabase: fs.existsSync(path.join(userDir, 'database', 'ai.db')),
      aiMediaFiles: fs.existsSync(path.join(userDir, 'files', 'ai-media')),
      aiSchemaVersion: fs.existsSync(path.join(userDir, 'database', 'ai.db'))
        ? input.aiSchemaVersion ?? null
        : null,
      aiCredentials: false,
      externalVideoDirectory: hasExternalVideoDir ? configuredVideoDir : null,
      sensitiveVaultLegacyBackups: false,
    },
    files,
  }

  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'))
  writeBackupArchive(zip, outputPath)

  return { filePath: outputPath, manifest }
}
