import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const zh = JSON.parse(readFileSync(path.resolve('src/locales/zh-CN.json'), 'utf8')).aiChat
const en = JSON.parse(readFileSync(path.resolve('src/locales/en-US.json'), 'utf8')).aiChat

function flatten(value: unknown, prefix = ''): Array<[string, string]> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [[prefix, String(value ?? '')]]
  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) =>
    flatten(item, prefix ? `${prefix}.${key}` : key),
  )
}

function interpolationTokens(value: string) {
  return [...value.matchAll(/\{\{\s*([^}\s]+)\s*\}\}/g)].map((match) => match[1]).sort()
}

test('Chinese and English AI resources have identical complete key sets', () => {
  const zhEntries = flatten(zh)
  const enEntries = flatten(en)
  assert.deepEqual(zhEntries.map(([key]) => key).sort(), enEntries.map(([key]) => key).sort())
})

test('localized AI copy preserves interpolation contracts and nonblank values', () => {
  const zhMap = new Map(flatten(zh))
  const enMap = new Map(flatten(en))
  for (const [key, zhValue] of zhMap) {
    const enValue = enMap.get(key) ?? ''
    assert.ok(zhValue.trim(), `Blank Chinese AI locale: ${key}`)
    assert.ok(enValue.trim(), `Blank English AI locale: ${key}`)
    assert.deepEqual(interpolationTokens(zhValue), interpolationTokens(enValue), key)
  }
})
