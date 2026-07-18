import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { detectNativeBinaryFormat, verifyNativeModule } from '../scripts/verify-native-module.mjs'

function createMachO(cpuType) {
  const buffer = Buffer.alloc(8)
  buffer.writeUInt32LE(0xfeedfacf, 0)
  buffer.writeUInt32LE(cpuType, 4)
  return buffer
}

function createPe(machine) {
  const buffer = Buffer.alloc(72)
  buffer.write('MZ', 0)
  buffer.writeUInt32LE(64, 0x3c)
  buffer.write('PE\0\0', 64)
  buffer.writeUInt16LE(machine, 68)
  return buffer
}

function createElf(machine) {
  const buffer = Buffer.alloc(20)
  buffer.set([0x7f, 0x45, 0x4c, 0x46, 2, 1], 0)
  buffer.writeUInt16LE(machine, 18)
  return buffer
}

test('detectNativeBinaryFormat recognizes supported desktop formats and architectures', () => {
  assert.deepEqual(detectNativeBinaryFormat(createMachO(0x01000007)), {
    format: 'mach-o',
    arch: 'x64',
  })
  assert.deepEqual(detectNativeBinaryFormat(createPe(0xaa64)), {
    format: 'pe',
    arch: 'arm64',
  })
  assert.deepEqual(detectNativeBinaryFormat(createElf(62)), {
    format: 'elf',
    arch: 'x64',
  })
})

test('verifyNativeModule accepts a matching platform and architecture', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeos-native-format-'))
  const filePath = path.join(root, 'better_sqlite3.node')
  try {
    fs.writeFileSync(filePath, createPe(0x8664))
    assert.deepEqual(verifyNativeModule({ filePath, platform: 'win32', arch: 'x64' }), {
      filePath,
      platform: 'win32',
      format: 'pe',
      arch: 'x64',
    })
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('verifyNativeModule rejects a host module packaged for another platform', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lifeos-native-format-'))
  const filePath = path.join(root, 'better_sqlite3.node')
  try {
    fs.writeFileSync(filePath, createMachO(0x01000007))
    assert.throws(
      () => verifyNativeModule({ filePath, platform: 'win32', arch: 'x64' }),
      /expected pe\/x64, found mach-o\/x64/,
    )
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
