import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  ApplicationLogService,
  formatApplicationLogEntry,
  normalizeLogSource,
} from '../electron/logging/service'

test('application logs are written per user and date with source and details', (t) => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeos-logs-'))
  t.after(() => fs.rmSync(baseDir, { recursive: true, force: true }))
  const timestamp = new Date(2026, 7, 16, 9, 30, 0)
  const service = new ApplicationLogService(
    baseDir,
    () => 'user-one',
    () => timestamp,
  )

  service.write({
    level: 'error',
    source: 'src/views/Settings.tsx:42',
    details: ['Export failed', new Error('disk full')],
  })

  const logPath = path.join(baseDir, 'users', 'user-one', 'logs', '2026-08-16.log')
  const content = fs.readFileSync(logPath, 'utf8')
  assert.match(content, /^2026-08-16T/)
  assert.match(content, /\[ERROR\] \[src\/views\/Settings\.tsx:42\]/)
  assert.match(content, /Export failed Error: disk full/)
  assert.match(content, /\\n\s+at /)
})

test('expired daily logs are deleted using a one-calendar-month cutoff', (t) => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeos-logs-'))
  t.after(() => fs.rmSync(baseDir, { recursive: true, force: true }))
  const service = new ApplicationLogService(baseDir, () => 'guest')
  const logDir = service.ensureLogDirectory()
  fs.writeFileSync(path.join(logDir, '2026-02-27.log'), 'old')
  fs.writeFileSync(path.join(logDir, '2026-02-28.log'), 'cutoff')
  fs.writeFileSync(path.join(logDir, '2026-03-31.log'), 'current')
  fs.writeFileSync(path.join(logDir, 'notes.txt'), 'keep')

  const deletedCount = service.cleanupExpiredLogs(new Date(2026, 2, 31, 12, 0, 0))

  assert.equal(deletedCount, 1)
  assert.equal(fs.existsSync(path.join(logDir, '2026-02-27.log')), false)
  assert.equal(fs.existsSync(path.join(logDir, '2026-02-28.log')), true)
  assert.equal(fs.existsSync(path.join(logDir, 'notes.txt')), true)
})

test('daily cleanup runs independently when the active user changes', (t) => {
  const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeos-logs-'))
  t.after(() => fs.rmSync(baseDir, { recursive: true, force: true }))
  const timestamp = new Date(2026, 7, 16, 9, 30, 0)
  let activeUserId = 'first-user'
  const service = new ApplicationLogService(
    baseDir,
    () => activeUserId,
    () => timestamp,
  )

  for (const userId of ['first-user', 'second-user']) {
    const logDir = path.join(baseDir, 'users', userId, 'logs')
    fs.mkdirSync(logDir, { recursive: true })
    fs.writeFileSync(path.join(logDir, '2026-06-01.log'), 'old')
  }

  service.write({ level: 'debug', source: 'first.ts:1', details: ['first'] })
  activeUserId = 'second-user'
  service.write({ level: 'debug', source: 'second.ts:1', details: ['second'] })

  assert.equal(
    fs.existsSync(path.join(baseDir, 'users', 'first-user', 'logs', '2026-06-01.log')),
    false,
  )
  assert.equal(
    fs.existsSync(path.join(baseDir, 'users', 'second-user', 'logs', '2026-06-01.log')),
    false,
  )
})

test('log formatting keeps each entry on one line and normalizes source URLs', () => {
  const timestamp = new Date(2026, 7, 16, 1, 2, 3)
  const entry = formatApplicationLogEntry({
    level: 'warn',
    source: 'worker.ts:8',
    details: ['first\nsecond', { attempt: 2 }],
    timestamp,
  })

  assert.match(
    entry,
    /^2026-08-16T01:02:03\.000[+-]\d{2}:\d{2} \[WARN\] \[worker\.ts:8\] first\\nsecond \{ attempt: 2 \}\n$/,
  )
  assert.equal(
    normalizeLogSource('http://localhost:5173/src/views/Settings.tsx?t=123', 55),
    'src/views/Settings.tsx:55',
  )
})
