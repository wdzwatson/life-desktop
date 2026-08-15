import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import {
  getBrowserControlBridgeConfigPath,
  getBrowserControlIntegrationDir,
  getChromeNativeHostManifestPath,
} from '../electron/browserControl/paths.ts'
import { resolveNativeHostExecutablePath } from '../electron/browserControl/registration.ts'

test('browser control uses stable per-user directories on each platform', () => {
  assert.equal(
    getBrowserControlIntegrationDir('win32', { LOCALAPPDATA: 'C:\\Users\\A\\AppData\\Local' }, 'C:\\Users\\A'),
    path.join('C:\\Users\\A\\AppData\\Local', 'LifeOS', 'BrowserControl'),
  )
  assert.equal(
    getBrowserControlBridgeConfigPath('darwin', {}, '/Users/a'),
    path.join('/Users/a', 'Library', 'Application Support', 'LifeOS', 'BrowserControl', 'bridge.json'),
  )
  assert.equal(
    getChromeNativeHostManifestPath('linux', { XDG_CONFIG_HOME: '/home/a/.config' }, '/home/a'),
    path.join('/home/a/.config', 'google-chrome', 'NativeMessagingHosts', 'com.lifeos.browser.json'),
  )
})

test('Linux AppImage registration keeps the persistent AppImage path', () => {
  assert.equal(
    resolveNativeHostExecutablePath('/tmp/.mount_lifeos/lifeos', 'linux', { APPIMAGE: '/opt/LifeOS.AppImage' }),
    path.resolve('/opt/LifeOS.AppImage'),
  )
})
