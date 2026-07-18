import crypto from 'node:crypto'
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

function expandNsisArtifactName(pattern, { productName, version }) {
  const artifactName = pattern.replace(/\$\{(productName|version|ext)\}/g, (_, key) => {
    if (key === 'productName') return productName
    if (key === 'version') return version
    return 'exe'
  })
  if (artifactName.includes('${')) {
    throw new Error(`Unsupported NSIS artifactName pattern: ${pattern}`)
  }
  if (path.basename(artifactName) !== artifactName || /[\\/]/.test(artifactName)) {
    throw new Error(`NSIS artifactName must not contain a directory: ${pattern}`)
  }
  if (!/^[0-9A-Za-z._-]+$/.test(artifactName)) {
    throw new Error(`NSIS artifactName must be safe for a GitHub Release asset: ${artifactName}`)
  }
  return artifactName
}

function parseYamlScalar(rawValue) {
  const value = rawValue.trim()
  if (value.startsWith('"') && value.endsWith('"')) return JSON.parse(value)
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replaceAll("''", "'")
  }
  return value
}

function getTopLevelYamlValue(contents, key) {
  const line = contents.split(/\r?\n/).find((candidate) => candidate.startsWith(`${key}:`))
  if (!line) return null
  return parseYamlScalar(line.slice(key.length + 1))
}

function getYamlFileEntries(contents) {
  const entries = []
  let inFiles = false
  let currentEntry = null

  for (const line of contents.split(/\r?\n/)) {
    if (line === 'files:') {
      inFiles = true
      continue
    }
    if (!inFiles) continue
    if (line && !/^\s/.test(line)) break

    const urlMatch = line.match(/^\s*-\s+url:\s*(.+)$/)
    if (urlMatch) {
      currentEntry = { url: parseYamlScalar(urlMatch[1]) }
      entries.push(currentEntry)
      continue
    }
    if (!currentEntry) continue

    const propertyMatch = line.match(/^\s+(sha512|size):\s*(.+)$/)
    if (propertyMatch) currentEntry[propertyMatch[1]] = parseYamlScalar(propertyMatch[2])
  }

  return entries
}

function computeSha512(filePath) {
  return crypto.createHash('sha512').update(fs.readFileSync(filePath)).digest('base64')
}

export function verifyWindowsPackage({ outputDir = 'dist_electron' } = {}) {
  const packageMetadata = readPackageMetadata()
  const productName = packageMetadata.build?.productName || packageMetadata.name
  const version = packageMetadata.version
  const installerPattern =
    packageMetadata.build?.nsis?.artifactName || '${productName} Setup ${version}.${ext}'
  const installerName = expandNsisArtifactName(installerPattern, { productName, version })
  const installerPath = path.join(outputDir, installerName)
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
  if (getTopLevelYamlValue(updateMetadata, 'version') !== version) {
    throw new Error(`Windows update metadata version does not match package version ${version}.`)
  }

  const metadataPath = getTopLevelYamlValue(updateMetadata, 'path')
  if (metadataPath !== installerName) {
    throw new Error(
      `Windows update metadata path ${metadataPath || '<missing>'} does not match installer ${installerName}.`,
    )
  }

  const installerFileEntry = getYamlFileEntries(updateMetadata).find(
    (entry) => entry.url === installerName,
  )
  if (!installerFileEntry) {
    throw new Error(`Windows update metadata files do not reference installer ${installerName}.`)
  }

  const actualInstallerSize = fs.statSync(installerPath).size
  if (Number(installerFileEntry.size) !== actualInstallerSize) {
    throw new Error(
      `Windows update metadata size does not match installer ${installerName}: expected ${actualInstallerSize}, found ${installerFileEntry.size || '<missing>'}.`,
    )
  }

  const actualInstallerSha512 = computeSha512(installerPath)
  const topLevelSha512 = getTopLevelYamlValue(updateMetadata, 'sha512')
  if (
    installerFileEntry.sha512 !== actualInstallerSha512 ||
    topLevelSha512 !== actualInstallerSha512
  ) {
    throw new Error(`Windows update metadata checksum does not match installer ${installerName}.`)
  }

  return { productName, version, outputDir, installerName, files }
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
