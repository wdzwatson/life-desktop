import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const settings = readFileSync(path.resolve('src/views/Settings.tsx'), 'utf8')
const css = readFileSync(path.resolve('src/index.css'), 'utf8')

test('settings navigation renders labels independently of the collapsed primary sidebar', () => {
  assert.equal((settings.match(/className="settings-nav-label"/g) || []).length, 6)
  assert.doesNotMatch(settings, /className="nav-label">\{t\('settings\./)
  assert.match(css, /\.settings-nav-label\s*\{[\s\S]*opacity:\s*1;/)
})
