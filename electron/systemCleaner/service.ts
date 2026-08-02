import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const PLAN_TTL_MS = 15 * 60 * 1000
const SAFE_FILE_AGE_MS = 7 * 24 * 60 * 60 * 1000
const MAX_CATEGORY_FILES = 100_000

export type SystemCleanerCategoryId = 'crash_dumps' | 'npm_cache' | 'vscode_vsix_cache' | 'chrome_cache'
export type SystemCleanerCategory = {
  id: SystemCleanerCategoryId
  risk: 'safe' | 'optional'
  title: string
  description: string
  requiresClosedApp?: string
  fileCount: number
  bytes: number
  incomplete: boolean
  unavailableReason?: string
}

export type SystemCleanerProgress = {
  taskId: string
  phase: 'scanning' | 'previewing' | 'cleaning' | 'completed' | 'cancelled' | 'failed'
  categoryId?: SystemCleanerCategoryId
  currentLabel: string
  processedFiles: number
  totalFiles?: number
  processedBytes: number
  skippedFiles: number
  failedFiles: number
  elapsedMs: number
}
export type SystemCleanerAuditRecord = {
  at: string
  categoryIds: SystemCleanerCategoryId[]
  deletedFiles: number
  deletedBytes: number
  skippedFiles: number
  failedFiles: number
}

type FileSnapshot = { filePath: string; size: number; mtimeMs: number }
export type SystemCleanerCategoryRule = Omit<SystemCleanerCategory, 'fileCount' | 'bytes' | 'incomplete' | 'unavailableReason'> & {
  roots: string[]
  minimumAgeMs?: number
  appProcessNames?: string[]
}
type ScanTask = {
  id: string
  startedAt: number
  state: 'scanning' | 'completed' | 'cancelled' | 'failed'
  controller: AbortController
  categories: Map<SystemCleanerCategoryId, { category: SystemCleanerCategory; files: FileSnapshot[]; rule: SystemCleanerCategoryRule }>
  disks: Array<{ path: string; totalBytes: number; freeBytes: number }>
  error?: string
}
type CleanupPlan = {
  hash: string
  taskId: string
  createdAt: number
  categoryIds: SystemCleanerCategoryId[]
  files: Array<FileSnapshot & { categoryId: SystemCleanerCategoryId }>
}

function isWindows() { return process.platform === 'win32' }

function normalizePath(value: string) {
  const resolved = path.resolve(value)
  return isWindows() ? resolved.toLowerCase() : resolved
}

function isWithin(root: string, target: string) {
  const relative = path.relative(normalizePath(root), normalizePath(target))
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function getRules(): SystemCleanerCategoryRule[] {
  const home = os.homedir()
  const localAppData = process.env.LOCALAPPDATA ?? path.join(home, 'AppData', 'Local')
  const appData = process.env.APPDATA ?? path.join(home, 'AppData', 'Roaming')
  const chromeRoot = isWindows()
    ? path.join(localAppData, 'Google', 'Chrome', 'User Data', 'Default')
    : process.platform === 'darwin'
      ? path.join(home, 'Library', 'Caches', 'Google', 'Chrome', 'Default')
      : path.join(home, '.cache', 'google-chrome', 'Default')
  return [
    {
      id: 'crash_dumps', risk: 'safe', title: 'Crash dumps',
      description: 'Application crash reports older than seven days. They are not required to run applications.',
      roots: [path.join(localAppData, 'CrashDumps')], minimumAgeMs: SAFE_FILE_AGE_MS,
    },
    {
      id: 'npm_cache', risk: 'optional', title: 'npm download cache',
      description: 'Downloaded npm packages. Projects and node_modules are never included.',
      roots: [path.join(home, '.npm', '_cacache')],
    },
    {
      id: 'vscode_vsix_cache', risk: 'optional', title: 'VS Code extension installer cache',
      description: 'Previously downloaded VSIX installers. Installed extensions and settings are not included.',
      roots: [path.join(appData, 'Code', 'CachedExtensionVSIXs')], appProcessNames: isWindows() ? ['Code.exe'] : ['code'],
      requiresClosedApp: 'Visual Studio Code',
    },
    {
      id: 'chrome_cache', risk: 'optional', title: 'Chrome cache',
      description: 'Only Chrome Cache, Code Cache, and GPUCache. Cookies, sessions, passwords, extensions, and history are excluded.',
      roots: ['Cache', 'Code Cache', 'GPUCache'].map((name) => path.join(chromeRoot, name)),
      appProcessNames: isWindows() ? ['chrome.exe'] : ['Google Chrome', 'google-chrome', 'chrome'], requiresClosedApp: 'Google Chrome',
    },
  ]
}

async function pathHasLink(root: string, target: string) {
  const rootStat = await fs.lstat(root)
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) return true
  const relative = path.relative(root, target)
  const parts = relative.split(path.sep).filter(Boolean)
  let current = root
  for (const part of parts) {
    current = path.join(current, part)
    const stat = await fs.lstat(current)
    if (stat.isSymbolicLink()) return true
  }
  return false
}

async function collectFiles(root: string, minimumAgeMs: number | undefined, signal: AbortSignal, onFile: () => void) {
  const files: FileSnapshot[] = []
  let incomplete = false
  const now = Date.now()
  const visit = async (directory: string): Promise<void> => {
    if (signal.aborted || incomplete) return
    let entries: Awaited<ReturnType<typeof fs.readdir>>
    try { entries = await fs.readdir(directory, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (signal.aborted || incomplete) return
      const candidate = path.join(directory, entry.name)
      try {
        const stat = await fs.lstat(candidate)
        if (stat.isSymbolicLink()) continue
        if (stat.isDirectory()) { await visit(candidate); continue }
        if (!stat.isFile() || stat.nlink > 1) continue
        if (minimumAgeMs && now - stat.mtimeMs < minimumAgeMs) continue
        files.push({ filePath: candidate, size: stat.size, mtimeMs: stat.mtimeMs })
        onFile()
        if (files.length >= MAX_CATEGORY_FILES) incomplete = true
      } catch { /* Files can disappear while a read-only scan is in progress. */ }
    }
  }
  try {
    const rootStat = await fs.lstat(root)
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) return { files, incomplete, unavailableReason: 'unavailable' }
    await visit(root)
  } catch { return { files, incomplete, unavailableReason: 'unavailable' } }
  return { files, incomplete }
}

async function getDiskRoots() {
  if (isWindows()) {
    const systemDrive = process.env.SystemDrive || path.parse(process.env.SystemRoot || 'C:\\Windows').root
    return [systemDrive]
  }
  try {
    const { stdout } = await execFileAsync('df', ['-P', '-l'], { windowsHide: true, timeout: 5000 })
    const roots = stdout.split(/\r?\n/).slice(1).map((line) => line.trim().split(/\s+/).at(-1) || '')
      .filter((mount) => mount.startsWith('/') && !mount.startsWith('/dev/') && !mount.startsWith('/proc'))
    return [...new Set(roots.length ? roots : ['/'])]
  } catch { return ['/'] }
}

async function getDisks() {
  const roots = await getDiskRoots()
  const disks = [] as Array<{ path: string; totalBytes: number; freeBytes: number }>
  for (const root of roots) {
    try {
      const stat = await fs.statfs(root)
      disks.push({ path: root, totalBytes: Number(stat.blocks * stat.bsize), freeBytes: Number(stat.bavail * stat.bsize) })
    } catch { /* A mount can disappear between discovery and statfs. */ }
  }
  return disks
}

async function processIsRunning(names: string[] | undefined) {
  if (!names?.length) return false
  try {
    const result = isWindows()
      ? await execFileAsync('tasklist', ['/FO', 'CSV', '/NH'], { windowsHide: true, timeout: 5000 })
      : await execFileAsync('ps', ['-A', '-o', 'comm='], { windowsHide: true, timeout: 5000 })
    const output = result.stdout.toLowerCase()
    return names.some((name) => output.includes(name.toLowerCase()))
  } catch { return true }
}

export class SystemCleanerService {
  private readonly tasks = new Map<string, ScanTask>()
  private readonly plans = new Map<string, CleanupPlan>()
  private listeners = new Set<(event: SystemCleanerProgress) => void>()
  constructor(private readonly dependencies: {
    rules?: () => SystemCleanerCategoryRule[]
    disks?: () => Promise<Array<{ path: string; totalBytes: number; freeBytes: number }>>
    audit?: (record: SystemCleanerAuditRecord) => Promise<void> | void
  } = {}) {}

  onProgress(listener: (event: SystemCleanerProgress) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener) }
  private emit(event: SystemCleanerProgress) { for (const listener of this.listeners) listener(event) }

  startScan() {
    const id = crypto.randomUUID()
    const task: ScanTask = { id, startedAt: Date.now(), state: 'scanning', controller: new AbortController(), categories: new Map(), disks: [] }
    this.tasks.set(id, task)
    void this.runScan(task)
    return { taskId: id }
  }

  private async runScan(task: ScanTask) {
    let processedFiles = 0
    let processedBytes = 0
    try {
      task.disks = await (this.dependencies.disks?.() ?? getDisks())
      for (const rule of this.dependencies.rules?.() ?? getRules()) {
        this.emit({ taskId: task.id, phase: 'scanning', categoryId: rule.id, currentLabel: rule.title, processedFiles, processedBytes, skippedFiles: 0, failedFiles: 0, elapsedMs: Date.now() - task.startedAt })
        const files: FileSnapshot[] = []
        let incomplete = false
        let unavailable = true
        for (const root of rule.roots) {
          const result = await collectFiles(root, rule.minimumAgeMs, task.controller.signal, () => {
            processedFiles += 1
            if (processedFiles % 100 === 0) this.emit({ taskId: task.id, phase: 'scanning', categoryId: rule.id, currentLabel: rule.title, processedFiles, processedBytes, skippedFiles: 0, failedFiles: 0, elapsedMs: Date.now() - task.startedAt })
          })
          files.push(...result.files)
          processedBytes += result.files.reduce((sum, file) => sum + file.size, 0)
          incomplete ||= result.incomplete
          unavailable &&= Boolean(result.unavailableReason)
        }
        task.categories.set(rule.id, { rule, files, category: { ...rule, fileCount: files.length, bytes: files.reduce((sum, file) => sum + file.size, 0), incomplete, ...(unavailable ? { unavailableReason: 'unavailable' } : {}) } })
        if (task.controller.signal.aborted) { task.state = 'cancelled'; break }
      }
      if (task.state === 'scanning') task.state = 'completed'
      this.emit({ taskId: task.id, phase: task.state === 'cancelled' ? 'cancelled' : 'completed', currentLabel: task.state === 'cancelled' ? 'Scan cancelled' : 'Scan complete', processedFiles, processedBytes, skippedFiles: 0, failedFiles: 0, elapsedMs: Date.now() - task.startedAt })
    } catch (error) {
      task.state = 'failed'; task.error = error instanceof Error ? error.message : 'Scan failed'
      this.emit({ taskId: task.id, phase: 'failed', currentLabel: task.error, processedFiles, processedBytes, skippedFiles: 0, failedFiles: 0, elapsedMs: Date.now() - task.startedAt })
    }
  }

  getScan(taskId: unknown) {
    if (typeof taskId !== 'string') throw new Error('Invalid scan task.')
    const task = this.tasks.get(taskId)
    if (!task) throw new Error('Scan task was not found.')
    return { taskId, state: task.state, disks: task.disks, categories: [...task.categories.values()].map((entry) => entry.category), error: task.error }
  }
  cancelScan(taskId: unknown) { const task = this.tasks.get(String(taskId)); if (!task || task.state !== 'scanning') return { cancelled: false }; task.controller.abort(); return { cancelled: true } }

  async previewCleanup(input: unknown) {
    if (!input || typeof input !== 'object') throw new Error('Invalid cleanup preview.')
    const { taskId, categoryIds } = input as { taskId?: unknown; categoryIds?: unknown }
    const task = this.tasks.get(String(taskId))
    if (!task || task.state !== 'completed' || !Array.isArray(categoryIds)) throw new Error('A completed scan is required.')
    const ids = [...new Set(categoryIds)].filter((value): value is SystemCleanerCategoryId => typeof value === 'string' && task.categories.has(value as SystemCleanerCategoryId))
    if (!ids.length) throw new Error('Select at least one supported cleanup category.')
    const files: CleanupPlan['files'] = []
    const blockedCategories: SystemCleanerCategoryId[] = []
    for (const id of ids) {
      const entry = task.categories.get(id)!
      if (entry.category.incomplete) throw new Error('An incomplete category cannot be cleaned. Scan again after reducing its size.')
      if (await processIsRunning(entry.rule.appProcessNames)) blockedCategories.push(id)
      for (const file of entry.files) files.push({ ...file, categoryId: id })
    }
    const payload = { taskId: task.id, ids: [...ids].sort(), files: files.map((file) => [file.categoryId, file.filePath, file.size, file.mtimeMs]) }
    const hash = crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')
    this.plans.set(hash, { hash, taskId: task.id, createdAt: Date.now(), categoryIds: ids, files })
    return { planHash: hash, fileCount: files.length, bytes: files.reduce((sum, file) => sum + file.size, 0), categoryIds: ids, blockedCategories, expiresAt: Date.now() + PLAN_TTL_MS }
  }

  async executeCleanup(input: unknown) {
    if (!input || typeof input !== 'object' || typeof (input as { planHash?: unknown }).planHash !== 'string') throw new Error('A cleanup preview is required.')
    const plan = this.plans.get((input as { planHash: string }).planHash)
    if (!plan || Date.now() - plan.createdAt > PLAN_TTL_MS) throw new Error('The cleanup preview has expired. Review it again.')
    const task = this.tasks.get(plan.taskId)
    if (!task || task.state !== 'completed') throw new Error('The scan is no longer available.')
    for (const id of plan.categoryIds) if (await processIsRunning(task.categories.get(id)!.rule.appProcessNames)) throw new Error('Close the affected application and generate a new preview.')
    const startedAt = Date.now(); let deletedBytes = 0; let deletedFiles = 0; let skippedFiles = 0; let failedFiles = 0
    for (const [index, file] of plan.files.entries()) {
      const entry = task.categories.get(file.categoryId)!
      try {
        if (!entry.rule.roots.some((root) => isWithin(root, file.filePath))) throw new Error('Path is outside its approved root.')
        if (await pathHasLink(entry.rule.roots.find((root) => isWithin(root, file.filePath))!, file.filePath)) throw new Error('Linked paths are not allowed.')
        const stat = await fs.lstat(file.filePath)
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1 || stat.size !== file.size || stat.mtimeMs !== file.mtimeMs) { skippedFiles += 1; continue }
        await fs.unlink(file.filePath); deletedFiles += 1; deletedBytes += file.size
      } catch { failedFiles += 1 }
      if (index % 25 === 0 || index === plan.files.length - 1) this.emit({ taskId: plan.taskId, phase: 'cleaning', currentLabel: entry.category.title, processedFiles: index + 1, totalFiles: plan.files.length, processedBytes: deletedBytes, skippedFiles, failedFiles, elapsedMs: Date.now() - startedAt })
    }
    // Rebuild the in-memory summaries from the filesystem after the guarded unlink pass.
    for (const id of plan.categoryIds) {
      const entry = task.categories.get(id)!
      const retained: FileSnapshot[] = []
      for (const file of entry.files) {
        try { await fs.lstat(file.filePath); retained.push(file) } catch { /* Removed files no longer belong in the summary. */ }
      }
      entry.files = retained
      entry.category.fileCount = retained.length
      entry.category.bytes = retained.reduce((sum, file) => sum + file.size, 0)
    }
    this.plans.delete(plan.hash)
    try {
      await this.dependencies.audit?.({ at: new Date().toISOString(), categoryIds: plan.categoryIds, deletedFiles, deletedBytes, skippedFiles, failedFiles })
    } catch { /* Audit history must not turn a completed cleanup into a failed cleanup. */ }
    this.emit({ taskId: plan.taskId, phase: 'completed', currentLabel: 'Cleanup complete', processedFiles: plan.files.length, totalFiles: plan.files.length, processedBytes: deletedBytes, skippedFiles, failedFiles, elapsedMs: Date.now() - startedAt })
    return { deletedFiles, deletedBytes, skippedFiles, failedFiles, cleanupBytes: deletedBytes }
  }
}
