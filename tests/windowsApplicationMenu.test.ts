import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const main = readFileSync(path.resolve('electron/main.ts'), 'utf8')

test('Windows application menu exposes only Reload under View', () => {
  assert.match(main, /if \(process\.platform !== 'win32'\) return/)
  assert.match(main, /label: 'View',[\s\S]*submenu: \[\{ role: 'reload', label: 'Reload' \}\]/)
  assert.match(main, /configureApplicationMenu\(\)/)
})
