import os from 'node:os'
import path from 'node:path'
import { LIFEOS_NATIVE_HOST_NAME } from './constants'

type BrowserControlEnvironment = Record<string, string | undefined>

export function getBrowserControlIntegrationDir(
  platform: NodeJS.Platform = process.platform,
  environment: BrowserControlEnvironment = process.env,
  homeDir = os.homedir(),
) {
  if (platform === 'win32') {
    const localAppData = environment.LOCALAPPDATA || path.join(homeDir, 'AppData', 'Local')
    return path.join(localAppData, 'LifeOS', 'BrowserControl')
  }
  if (platform === 'darwin') {
    return path.join(homeDir, 'Library', 'Application Support', 'LifeOS', 'BrowserControl')
  }
  const configHome = environment.XDG_CONFIG_HOME || path.join(homeDir, '.config')
  return path.join(configHome, 'lifeos', 'browser-control')
}

export function getBrowserControlBridgeConfigPath(
  platform: NodeJS.Platform = process.platform,
  environment: BrowserControlEnvironment = process.env,
  homeDir = os.homedir(),
) {
  return path.join(getBrowserControlIntegrationDir(platform, environment, homeDir), 'bridge.json')
}

export function getBrowserControlInstallMarkerPath(
  platform: NodeJS.Platform = process.platform,
  environment: BrowserControlEnvironment = process.env,
  homeDir = os.homedir(),
) {
  return path.join(getBrowserControlIntegrationDir(platform, environment, homeDir), 'native-host-installed')
}

export function getChromeNativeHostManifestPath(
  platform: NodeJS.Platform = process.platform,
  environment: BrowserControlEnvironment = process.env,
  homeDir = os.homedir(),
) {
  if (platform === 'win32') {
    return path.join(getBrowserControlIntegrationDir(platform, environment, homeDir), `${LIFEOS_NATIVE_HOST_NAME}.json`)
  }
  if (platform === 'darwin') {
    return path.join(
      homeDir,
      'Library',
      'Application Support',
      'Google',
      'Chrome',
      'NativeMessagingHosts',
      `${LIFEOS_NATIVE_HOST_NAME}.json`,
    )
  }
  const configHome = environment.XDG_CONFIG_HOME || path.join(homeDir, '.config')
  return path.join(configHome, 'google-chrome', 'NativeMessagingHosts', `${LIFEOS_NATIVE_HOST_NAME}.json`)
}
