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
  now?: () => Date
}

export type CreateBackupResult = {
  filePath: string
  manifest: BackupManifest
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
    candidate
      .split(path.sep)
      .some((segment) => excludedSegments.has(segment)),
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
      externalVideoDirectory: hasExternalVideoDir ? configuredVideoDir : null,
      sensitiveVaultLegacyBackups: false,
    },
    files,
  }

  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'))
  zip.writeZip(outputPath)

  return { filePath: outputPath, manifest }
}
