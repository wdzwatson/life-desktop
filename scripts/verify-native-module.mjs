import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const DEFAULT_NATIVE_MODULE_PATH = path.join(
  'node_modules',
  'better-sqlite3',
  'build',
  'Release',
  'better_sqlite3.node',
)

const PLATFORM_FORMATS = {
  darwin: 'mach-o',
  linux: 'elf',
  win32: 'pe',
}

function normalizeArch(arch) {
  if (arch === 'arm') return 'armv7l'
  return arch
}

function readMachOCpuType(buffer, littleEndian) {
  const cpuType = littleEndian ? buffer.readUInt32LE(4) : buffer.readUInt32BE(4)
  return (
    new Map([
      [0x00000007, 'ia32'],
      [0x01000007, 'x64'],
      [0x0000000c, 'armv7l'],
      [0x0100000c, 'arm64'],
    ]).get(cpuType) ?? 'unknown'
  )
}

function detectMachO(buffer) {
  if (buffer.length < 8) return null
  const magic = buffer.subarray(0, 4).toString('hex')
  if (magic === 'cffaedfe' || magic === 'cefaedfe') {
    return { format: 'mach-o', arch: readMachOCpuType(buffer, true) }
  }
  if (magic === 'feedfacf' || magic === 'feedface') {
    return { format: 'mach-o', arch: readMachOCpuType(buffer, false) }
  }
  if (magic === 'cafebabe' || magic === 'bebafeca') {
    return { format: 'mach-o', arch: 'universal' }
  }
  return null
}

function detectPe(buffer) {
  if (buffer.length < 64 || buffer[0] !== 0x4d || buffer[1] !== 0x5a) return null
  const peOffset = buffer.readUInt32LE(0x3c)
  if (
    peOffset + 6 > buffer.length ||
    buffer.subarray(peOffset, peOffset + 4).toString() !== 'PE\0\0'
  ) {
    return null
  }
  const machine = buffer.readUInt16LE(peOffset + 4)
  const arch =
    new Map([
      [0x014c, 'ia32'],
      [0x01c4, 'armv7l'],
      [0x8664, 'x64'],
      [0xaa64, 'arm64'],
    ]).get(machine) ?? 'unknown'
  return { format: 'pe', arch }
}

function detectElf(buffer) {
  if (
    buffer.length < 20 ||
    buffer[0] !== 0x7f ||
    buffer[1] !== 0x45 ||
    buffer[2] !== 0x4c ||
    buffer[3] !== 0x46
  ) {
    return null
  }
  const littleEndian = buffer[5] === 1
  const machine = littleEndian ? buffer.readUInt16LE(18) : buffer.readUInt16BE(18)
  const arch =
    new Map([
      [3, 'ia32'],
      [40, 'armv7l'],
      [62, 'x64'],
      [183, 'arm64'],
    ]).get(machine) ?? 'unknown'
  return { format: 'elf', arch }
}

export function detectNativeBinaryFormat(buffer) {
  return (
    detectMachO(buffer) ??
    detectPe(buffer) ??
    detectElf(buffer) ?? {
      format: 'unknown',
      arch: 'unknown',
    }
  )
}

export function verifyNativeModule({
  filePath = DEFAULT_NATIVE_MODULE_PATH,
  platform = process.platform,
  arch = process.arch,
} = {}) {
  const expectedFormat = PLATFORM_FORMATS[platform]
  if (!expectedFormat) throw new Error(`Unsupported target platform: ${platform}`)
  if (!fs.existsSync(filePath)) throw new Error(`Native module not found: ${filePath}`)

  const handle = fs.openSync(filePath, 'r')
  const buffer = Buffer.alloc(65536)
  let bytesRead = 0
  try {
    bytesRead = fs.readSync(handle, buffer, 0, buffer.length, 0)
  } finally {
    fs.closeSync(handle)
  }
  const detected = detectNativeBinaryFormat(buffer.subarray(0, bytesRead))
  const expectedArch = normalizeArch(arch)
  const archMatches = detected.arch === expectedArch || detected.arch === 'universal'
  if (detected.format !== expectedFormat || !archMatches) {
    throw new Error(
      `Native module target mismatch: expected ${expectedFormat}/${expectedArch}, ` +
        `found ${detected.format}/${detected.arch} at ${filePath}`,
    )
  }

  return { filePath, platform, arch: expectedArch, ...detected }
}

function parseArgs(args) {
  const options = {}
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (!['--path', '--platform', '--arch'].includes(argument)) {
      throw new Error(`Unknown argument: ${argument}`)
    }
    const value = args[index + 1]
    if (!value) throw new Error(`Missing value for ${argument}`)
    if (argument === '--path') options.filePath = value
    if (argument === '--platform') options.platform = value
    if (argument === '--arch') options.arch = value
    index += 1
  }
  return options
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  try {
    const result = verifyNativeModule(parseArgs(process.argv.slice(2)))
    console.log(`Native module verified: ${result.filePath} (${result.format}/${result.arch})`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
