import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const read = (file: string) => readFileSync(path.resolve(file), 'utf8')

test('Toolbox exposes the localized web-like workspace', () => {
  const toolbox = read('src/views/Toolbox.tsx')
  const component = read('src/views/WebLike.tsx')
  const styles = read('src/views/WebLike.css')
  const zh = JSON.parse(read('src/locales/zh-CN.json'))
  const en = JSON.parse(read('src/locales/en-US.json'))
  assert.match(toolbox, /toolTab === 'web-like'/)
  assert.match(toolbox, /tab_web_like/)
  assert.match(toolbox, /<WebLike \/>/)
  assert.equal(zh.toolbox.tab_web_like, '网页点赞')
  assert.equal(en.toolbox.tab_web_like, 'Web Like')
  assert.match(component, /executeWebLike\(url, preferredTabId\)/)
  assert.match(component, /type="url"/)
  assert.match(styles, /@media \(max-width: 640px\)/)
})

test('browser control keeps script execution fixed behind narrow Electron IPC', () => {
  const preload = read('electron/preload.ts')
  const extension = read('extensions/lifeos-chrome/background.js')
  const manifest = JSON.parse(read('extensions/lifeos-chrome/manifest.json'))
  assert.match(preload, /executeWebLike: \(url: string, preferredTabId\?: number\)/)
  assert.doesNotMatch(preload, /executeWebLike[^\n]+script/)
  assert.match(extension, /console\.log\('741852963'\)/)
  assert.match(extension, /chrome\.debugger\.attach/)
  assert.deepEqual(manifest.permissions.sort(), ['debugger', 'nativeMessaging', 'storage', 'tabs'])
})

test('native host allowlist matches the stable Chrome extension ID', () => {
  const manifest = JSON.parse(read('extensions/lifeos-chrome/manifest.json'))
  const constants = read('electron/browserControl/constants.ts')
  const digest = crypto.createHash('sha256').update(Buffer.from(manifest.key, 'base64')).digest().subarray(0, 16)
  const alphabet = 'abcdefghijklmnop'
  const extensionId = [...digest]
    .map((byte) => `${alphabet[byte >> 4]}${alphabet[byte & 15]}`)
    .join('')

  assert.match(constants, new RegExp(`LIFEOS_CHROME_EXTENSION_ID = '${extensionId}'`))
})

test('browser control is included in packaged Windows, macOS and Linux builds', () => {
  const packageJson = JSON.parse(read('package.json'))
  const vite = read('vite.config.ts')
  assert.ok(packageJson.build.win)
  assert.ok(packageJson.build.mac)
  assert.deepEqual(packageJson.build.linux.target, ['AppImage', 'deb'])
  assert.equal(packageJson.build.extraResources[0].from, 'extensions/lifeos-chrome')
  assert.match(vite, /entry: 'electron\/browserControl\/bootstrap\.ts'/)
  assert.match(vite, /entryFileNames: 'main\.js'/)
})
