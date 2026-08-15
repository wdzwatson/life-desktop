import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import {
  LIFEOS_CHROME_EXTENSION_ORIGIN,
  LIFEOS_NATIVE_HOST_NAME,
} from './constants'
import {
  getBrowserControlInstallMarkerPath,
  getChromeNativeHostManifestPath,
} from './paths'

const execFileAsync = promisify(execFile)
const WINDOWS_REGISTRY_KEY = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\${LIFEOS_NATIVE_HOST_NAME}`

type RegistrationOptions = {
  executablePath: string
  packaged: boolean
  platform?: NodeJS.Platform
}

export type BrowserControlRegistrationStatus = {
  registered: boolean
  supported: boolean
  requiresPackagedApp: boolean
  manifestPath: string
  executablePath: string
}

function nativeHostManifest(executablePath: string) {
  return {
    name: LIFEOS_NATIVE_HOST_NAME,
    description: 'LifeOS browser native messaging host',
    path: executablePath,
    type: 'stdio',
    allowed_origins: [LIFEOS_CHROME_EXTENSION_ORIGIN],
  }
}

export function resolveNativeHostExecutablePath(
  executablePath = process.execPath,
  platform: NodeJS.Platform = process.platform,
  environment = process.env,
) {
  if (platform === 'linux' && environment.APPIMAGE) return path.resolve(environment.APPIMAGE)
  return path.resolve(executablePath)
}

async function readManifest(manifestPath: string) {
  try {
    return JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

async function windowsRegistryMatches(manifestPath: string) {
  try {
    const { stdout } = await execFileAsync('reg.exe', ['QUERY', WINDOWS_REGISTRY_KEY, '/ve'], {
      windowsHide: true,
    })
    return stdout.toLowerCase().includes(path.resolve(manifestPath).toLowerCase())
  } catch {
    return false
  }
}

export async function getBrowserControlRegistrationStatus(options: RegistrationOptions) {
  const platform = options.platform ?? process.platform
  const executablePath = resolveNativeHostExecutablePath(options.executablePath, platform)
  const manifestPath = getChromeNativeHostManifestPath(platform)
  const manifest = await readManifest(manifestPath)
  const manifestMatches =
    manifest?.name === LIFEOS_NATIVE_HOST_NAME &&
    manifest?.path === executablePath &&
    Array.isArray(manifest?.allowed_origins) &&
    manifest.allowed_origins.includes(LIFEOS_CHROME_EXTENSION_ORIGIN)
  const registryMatches = platform !== 'win32' || (await windowsRegistryMatches(manifestPath))

  return {
    registered: Boolean(options.packaged && manifestMatches && registryMatches),
    supported: platform === 'win32' || platform === 'darwin' || platform === 'linux',
    requiresPackagedApp: !options.packaged,
    manifestPath,
    executablePath,
  } satisfies BrowserControlRegistrationStatus
}

export async function installBrowserControlNativeHost(options: RegistrationOptions) {
  const platform = options.platform ?? process.platform
  if (!['win32', 'darwin', 'linux'].includes(platform)) {
    throw new Error(`Browser control is not supported on ${platform}.`)
  }
  if (!options.packaged) {
    return getBrowserControlRegistrationStatus(options)
  }

  const executablePath = resolveNativeHostExecutablePath(options.executablePath, platform)
  const manifestPath = getChromeNativeHostManifestPath(platform)
  await fs.mkdir(path.dirname(manifestPath), { recursive: true })
  await fs.writeFile(manifestPath, `${JSON.stringify(nativeHostManifest(executablePath), null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
  if (platform === 'win32') {
    await execFileAsync(
      'reg.exe',
      ['ADD', WINDOWS_REGISTRY_KEY, '/ve', '/t', 'REG_SZ', '/d', manifestPath, '/f'],
      { windowsHide: true },
    )
  }
  const markerPath = getBrowserControlInstallMarkerPath(platform)
  await fs.mkdir(path.dirname(markerPath), { recursive: true })
  await fs.writeFile(markerPath, `${Date.now()}\n`, { encoding: 'utf8', mode: 0o600 })
  return getBrowserControlRegistrationStatus(options)
}

export async function repairBrowserControlNativeHostIfInstalled(options: RegistrationOptions) {
  try {
    await fs.access(getBrowserControlInstallMarkerPath(options.platform ?? process.platform))
  } catch {
    return null
  }
  return installBrowserControlNativeHost(options)
}
