import assert from 'node:assert/strict'
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
  fs.writeFileSync(path.join(root, 'LifeOS Setup 1.0.2.exe'), createPe())
  fs.writeFileSync(path.join(root, 'LifeOS Setup 1.0.2.exe.blockmap'), 'blockmap')
  fs.writeFileSync(path.join(root, 'LifeOS-1.0.2-win.zip'), 'zip')
  fs.writeFileSync(
    path.join(root, 'latest.yml'),
    'version: 1.0.2\npath: LifeOS-Setup-1.0.2.exe\nsha512: checksum\n',
  )
  fs.writeFileSync(path.join(root, 'win-unpacked', 'LifeOS.exe'), createPe())
  fs.writeFileSync(nativeModulePath, createPe())
  return nativeModulePath
}

test('verifyWindowsPackage accepts complete PE/x64 build artifacts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeos-windows-package-'))
  try {
    writeWindowsPackageFixture(root)
    const result = verifyWindowsPackage({ outputDir: root })
    assert.equal(result.productName, 'LifeOS')
    assert.equal(result.version, '1.0.2')
    assert.equal(result.files.length, 6)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('verifyWindowsPackage rejects a package containing a macOS native module', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeos-windows-package-'))
  try {
    const nativeModulePath = writeWindowsPackageFixture(root)
    fs.writeFileSync(nativeModulePath, createMachO())
    assert.throws(
      () => verifyWindowsPackage({ outputDir: root }),
      /expected pe\/x64, found mach-o\/x64/,
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
