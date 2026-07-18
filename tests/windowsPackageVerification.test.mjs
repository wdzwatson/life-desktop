import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { verifyWindowsPackage } from '../scripts/verify-windows-package.mjs'

function createPe(machine = 0x8664) {
  const buffer = Buffer.alloc(72)
  buffer.write('MZ', 0)
  buffer.writeUInt32LE(64, 0x3c)
  buffer.write('PE\0\0', 64)
  buffer.writeUInt16LE(machine, 68)
  return buffer
}

function createMachO() {
  const buffer = Buffer.alloc(8)
  buffer.writeUInt32LE(0xfeedfacf, 0)
  buffer.writeUInt32LE(0x01000007, 4)
  return buffer
}

const installerName = 'LifeOS-Setup-1.0.2.exe'

function writeUpdateMetadata(root, installer, overrides = {}) {
  const sha512 = crypto.createHash('sha512').update(installer).digest('base64')
  const values = {
    version: '1.0.2',
    path: installerName,
    url: installerName,
    sha512,
    fileSha512: sha512,
    size: installer.length,
    ...overrides,
  }
  fs.writeFileSync(
    path.join(root, 'latest.yml'),
    [
      `version: ${values.version}`,
      'files:',
      `  - url: ${values.url}`,
      `    sha512: ${values.fileSha512}`,
      `    size: ${values.size}`,
      `path: ${values.path}`,
      `sha512: ${values.sha512}`,
      '',
    ].join('\n'),
  )
}

function writeWindowsPackageFixture(root) {
  const nativeModulePath = path.join(
    root,
    'win-unpacked',
    'resources',
    'app.asar.unpacked',
    'node_modules',
    'better-sqlite3',
    'build',
    'Release',
    'better_sqlite3.node',
  )
  fs.mkdirSync(path.dirname(nativeModulePath), { recursive: true })
  const installer = createPe()
  fs.writeFileSync(path.join(root, installerName), installer)
  fs.writeFileSync(path.join(root, `${installerName}.blockmap`), 'blockmap')
  fs.writeFileSync(path.join(root, 'LifeOS-1.0.2-win.zip'), 'zip')
  writeUpdateMetadata(root, installer)
  fs.writeFileSync(path.join(root, 'win-unpacked', 'LifeOS.exe'), createPe())
  fs.writeFileSync(nativeModulePath, createPe())
  return { installer, nativeModulePath }
}

test('verifyWindowsPackage accepts complete PE/x64 build artifacts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeos-windows-package-'))
  try {
    writeWindowsPackageFixture(root)
    const result = verifyWindowsPackage({ outputDir: root })
    assert.equal(result.productName, 'LifeOS')
    assert.equal(result.version, '1.0.2')
    assert.equal(result.installerName, installerName)
    assert.equal(result.files.length, 6)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('verifyWindowsPackage rejects a package containing a macOS native module', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeos-windows-package-'))
  try {
    const { nativeModulePath } = writeWindowsPackageFixture(root)
    fs.writeFileSync(nativeModulePath, createMachO())
    assert.throws(
      () => verifyWindowsPackage({ outputDir: root }),
      /expected pe\/x64, found mach-o\/x64/,
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('verifyWindowsPackage rejects metadata that points to a different installer asset', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeos-windows-package-'))
  try {
    const { installer } = writeWindowsPackageFixture(root)
    writeUpdateMetadata(root, installer, { path: 'LifeOS-Setup-1.0.2-missing.exe' })
    assert.throws(
      () => verifyWindowsPackage({ outputDir: root }),
      /does not match installer LifeOS-Setup-1\.0\.2\.exe/,
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('verifyWindowsPackage rejects metadata with the wrong installer size', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeos-windows-package-'))
  try {
    const { installer } = writeWindowsPackageFixture(root)
    writeUpdateMetadata(root, installer, { size: installer.length + 1 })
    assert.throws(
      () => verifyWindowsPackage({ outputDir: root }),
      /metadata size does not match installer/,
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('verifyWindowsPackage rejects metadata with the wrong installer checksum', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeos-windows-package-'))
  try {
    const { installer } = writeWindowsPackageFixture(root)
    writeUpdateMetadata(root, installer, { fileSha512: 'wrong-checksum' })
    assert.throws(
      () => verifyWindowsPackage({ outputDir: root }),
      /metadata checksum does not match installer/,
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
