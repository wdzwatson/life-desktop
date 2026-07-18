import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { verifyNativeModule } from './verify-native-module.mjs'

function readPackageMetadata() {
  return JSON.parse(fs.readFileSync('package.json', 'utf8'))
}

function assertNonemptyFile(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Windows package artifact is missing: ${filePath}`)
  const stat = fs.statSync(filePath)
  if (!stat.isFile() || stat.size === 0) {
    throw new Error(`Windows package artifact is empty: ${filePath}`)
  }
  return stat.size
}

export function verifyWindowsPackage({ outputDir = 'dist_electron' } = {}) {
  const packageMetadata = readPackageMetadata()
  const productName = packageMetadata.build?.productName || packageMetadata.name
  const version = packageMetadata.version
  const installerPath = path.join(outputDir, `${productName} Setup ${version}.exe`)
  const unpackedExecutablePath = path.join(outputDir, 'win-unpacked', `${productName}.exe`)
  const nativeModulePath = path.join(
    outputDir,
    'win-unpacked',
    'resources',
    'app.asar.unpacked',
    'node_modules',
    'better-sqlite3',
    'build',
    'Release',
    'better_sqlite3.node',
  )
  const requiredFiles = [
    installerPath,
    `${installerPath}.blockmap`,
    path.join(outputDir, `${productName}-${version}-win.zip`),
    path.join(outputDir, 'latest.yml'),
    unpackedExecutablePath,
    nativeModulePath,
  ]

  const files = requiredFiles.map((filePath) => ({
    filePath,
    size: assertNonemptyFile(filePath),
  }))

  verifyNativeModule({ filePath: unpackedExecutablePath, platform: 'win32', arch: 'x64' })
  verifyNativeModule({ filePath: nativeModulePath, platform: 'win32', arch: 'x64' })

  const updateMetadataPath = path.join(outputDir, 'latest.yml')
  const updateMetadata = fs.readFileSync(updateMetadataPath, 'utf8')
  if (!new RegExp(`^version: ${version.replaceAll('.', '\\.')}$`, 'm').test(updateMetadata)) {
    throw new Error(`Windows update metadata version does not match package version ${version}.`)
  }
  if (!/^path: .+\.exe$/m.test(updateMetadata) || !/^sha512: \S+/m.test(updateMetadata)) {
    throw new Error('Windows update metadata is missing its executable path or checksum.')
  }

  return { productName, version, outputDir, files }
}

function parseArgs(args) {
  const options = {}
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== '--output') throw new Error(`Unknown argument: ${args[index]}`)
    if (!args[index + 1]) throw new Error('Missing value for --output')
    options.outputDir = args[index + 1]
    index += 1
  }
  return options
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  try {
    const result = verifyWindowsPackage(parseArgs(process.argv.slice(2)))
    console.log(
      `Windows package verified: ${result.productName} ${result.version} (${result.files.length} artifacts)`,
    )
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}
