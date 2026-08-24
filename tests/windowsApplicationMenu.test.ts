import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const main = readFileSync(path.resolve('electron/main.ts'), 'utf8')

test('Windows application menu is removed and desktop main windows use the themed title bar', () => {
  assert.match(main, /if \(process\.platform !== 'win32'\) return/)
  assert.match(main, /Menu\.setApplicationMenu\(null\)/)
  assert.match(main, /const useCustomTitlebar = \['win32', 'linux'\]\.includes\(process\.platform\)/)
  assert.match(main, /frame: !useCustomTitlebar/)
  assert.match(main, /mainWindow\.setMenuBarVisibility\(false\)/)
  assert.match(main, /configureApplicationMenu\(\)/)
})
