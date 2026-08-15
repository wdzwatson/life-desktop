import fs from 'node:fs'
import path from 'node:path'
import { inspect } from 'node:util'

export type ApplicationLogLevel = 'debug' | 'warn' | 'error'

export interface ApplicationLogEntry {
  level: ApplicationLogLevel
  source: string
  details: unknown[]
  timestamp?: Date
}

const LOG_FILE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})\.log$/
const MAX_DETAIL_LENGTH = 1_000_000

function pad(value: number) {
  return String(value).padStart(2, '0')
}

export function toLocalDateKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function toLocalIsoTimestamp(date: Date) {
  const offsetMinutes = -date.getTimezoneOffset()
  const offsetSign = offsetMinutes >= 0 ? '+' : '-'
  const absoluteOffset = Math.abs(offsetMinutes)
  const milliseconds = String(date.getMilliseconds()).padStart(3, '0')
  return `${toLocalDateKey(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${milliseconds}${offsetSign}${pad(Math.floor(absoluteOffset / 60))}:${pad(absoluteOffset % 60)}`
}

function subtractCalendarMonth(date: Date) {
  const result = new Date(date)
  const targetMonth = result.getMonth() - 1
  const originalDay = result.getDate()
  result.setDate(1)
  result.setMonth(targetMonth)
  const lastDayOfTargetMonth = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate()
  result.setDate(Math.min(originalDay, lastDayOfTargetMonth))
  return result
}

function normalizeUserId(userId: string) {
  const normalized = userId.trim().replace(/[^a-zA-Z0-9_.-]/g, '_')
  return normalized || 'guest'
}

export function normalizeLogSource(source: string, lineNumber?: number) {
  let normalized = source.trim()
  try {
    if (/^[a-z]+:\/\//i.test(normalized)) {
      const url = new URL(normalized)
      normalized = decodeURIComponent(url.pathname)
    }
  } catch {
    // Keep non-standard source identifiers unchanged.
  }

  normalized = normalized.replace(/[?#].*$/, '').replace(/\\/g, '/')
  if (/^\/[a-zA-Z]:\//.test(normalized)) normalized = normalized.slice(1)
  const cwd = process.cwd().replace(/\\/g, '/').replace(/\/$/, '')
  if (normalized.startsWith(`${cwd}/`)) normalized = normalized.slice(cwd.length + 1)
  normalized = normalized.replace(/^\/+/, '') || 'unknown'

  if (lineNumber && lineNumber > 0 && !/:\d+(?::\d+)?$/.test(normalized)) {
    return `${normalized}:${lineNumber}`
  }
  return normalized
}

export function findLogSourceInStack(stack: string | undefined) {
  if (!stack) return 'unknown'
  for (const line of stack.split(/\r?\n/).slice(1)) {
    if (line.includes('/logging/service.') || line.includes('\\logging\\service.')) continue
    const match = line.match(/(?:\(|at\s+)((?:file:\/\/\/)?[^()]+?:\d+:\d+)\)?\s*$/)
    if (match) return normalizeLogSource(match[1])
  }
  return 'unknown'
}

function serializeDetail(value: unknown) {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.stack || `${value.name}: ${value.message}`
  return inspect(value, {
    depth: 8,
    maxArrayLength: 200,
    maxStringLength: 100_000,
    breakLength: Infinity,
    compact: true,
  })
}

function serializeDetails(details: unknown[]) {
  const serialized = details.map(serializeDetail).join(' ')
  const singleLine = serialized.replace(/\r?\n/g, '\\n')
  if (singleLine.length <= MAX_DETAIL_LENGTH) return singleLine
  return `${singleLine.slice(0, MAX_DETAIL_LENGTH)}... [truncated]`
}

export function formatApplicationLogEntry(entry: ApplicationLogEntry) {
  const timestamp = entry.timestamp || new Date()
  const source = entry.source.trim() || 'unknown'
  return `${toLocalIsoTimestamp(timestamp)} [${entry.level.toUpperCase()}] [${source}] ${serializeDetails(entry.details)}\n`
}

export class ApplicationLogService {
  private lastCleanupKey = ''

  constructor(
    private readonly baseDir: string,
    private readonly getActiveUserId: () => string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  getLogDirectory() {
    return path.join(this.baseDir, 'users', normalizeUserId(this.getActiveUserId()), 'logs')
  }

  ensureLogDirectory() {
    const logDir = this.getLogDirectory()
    fs.mkdirSync(logDir, { recursive: true })
    return logDir
  }

  write(entry: Omit<ApplicationLogEntry, 'timestamp'> & { timestamp?: Date }) {
    try {
      const timestamp = entry.timestamp || this.now()
      const logDir = this.ensureLogDirectory()
      const dateKey = toLocalDateKey(timestamp)
      const cleanupKey = `${normalizeUserId(this.getActiveUserId())}:${dateKey}`
      if (this.lastCleanupKey !== cleanupKey) {
        this.cleanupExpiredLogs(timestamp)
        this.lastCleanupKey = cleanupKey
      }
      fs.appendFileSync(
        path.join(logDir, `${dateKey}.log`),
        formatApplicationLogEntry({ ...entry, timestamp }),
        'utf8',
      )
    } catch {
      // Logging must never interrupt the application flow it is observing.
    }
  }

  cleanupExpiredLogs(referenceDate = this.now()) {
    try {
      const logDir = this.ensureLogDirectory()
      const cutoffKey = toLocalDateKey(subtractCalendarMonth(referenceDate))
      let deletedCount = 0

      for (const fileName of fs.readdirSync(logDir)) {
        const match = LOG_FILE_PATTERN.exec(fileName)
        if (!match || match[0].slice(0, 10) >= cutoffKey) continue
        fs.rmSync(path.join(logDir, fileName), { force: true })
        deletedCount += 1
      }

      return deletedCount
    } catch {
      return 0
    }
  }

  listLogFiles() {
    const logDir = this.ensureLogDirectory()
    return fs
      .readdirSync(logDir)
      .filter((fileName) => LOG_FILE_PATTERN.test(fileName))
      .sort()
      .map((fileName) => path.join(logDir, fileName))
  }
}

export function installConsoleFileLogging(service: ApplicationLogService) {
  const originals = {
    debug: console.debug.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  }

  for (const level of ['debug', 'warn', 'error'] as const) {
    console[level] = (...details: unknown[]) => {
      service.write({
        level,
        source: findLogSourceInStack(new Error().stack),
        details,
      })
      originals[level](...details)
    }
  }

  return () => {
    console.debug = originals.debug
    console.warn = originals.warn
    console.error = originals.error
  }
}
