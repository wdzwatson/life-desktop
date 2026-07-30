import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const main = readFileSync(path.resolve('electron/main.ts'), 'utf8')
const settings = readFileSync(path.resolve('src/views/Settings.tsx'), 'utf8')
const zh = readFileSync(path.resolve('src/locales/zh-CN.json'), 'utf8')
const en = readFileSync(path.resolve('src/locales/en-US.json'), 'utf8')

test('startup preference defaults to enabled and synchronizes Electron login settings', () => {
  assert.match(main, /openAtLogin:\s*true/)
  assert.match(main, /function applyOpenAtLoginSetting\(enabled: boolean\)/)
  assert.match(main, /app\.setLoginItemSettings\(options\)/)
  assert.match(main, /applyOpenAtLoginSetting\(getSettings\(\)\.openAtLogin !== false\)/)
  assert.match(main, /openAtLoginResult/)
})

test('settings exposes and persists the startup preference in both supported locales', () => {
  assert.match(settings, /const \[openAtLogin, setOpenAtLogin\] = useState\(true\)/)
  assert.match(settings, /handleToggleOpenAtLogin/)
  assert.match(settings, /openAtLogin: enabled/)
  assert.match(settings, /settings\.open_at_login/)
  assert.match(zh, /"open_at_login": "开机时自动启动 LifeOS"/)
  assert.match(en, /"open_at_login": "Start LifeOS when I sign in"/)
})
