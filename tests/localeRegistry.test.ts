import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildLocaleResources,
  getConfiguredLocaleOptions,
} from '../src/localeRegistryUtils.ts'

test('buildLocaleResources discovers every locale JSON module from its filename', () => {
  const resources = buildLocaleResources({
    '/src/locales/zh-CN.json': { default: { common: { confirm: '确认' } } },
    '/src/locales/en-US.json': { default: { common: { confirm: 'Confirm' } } },
    '/src/locales/ja-JP.json': { default: { common: { confirm: '確認' } } },
  })

  assert.deepEqual(Object.keys(resources), ['en-US', 'ja-JP', 'zh-CN'])
  assert.deepEqual(resources['ja-JP'].translation, { common: { confirm: '確認' } })
})

test('getConfiguredLocaleOptions exposes a newly registered language without component changes', () => {
  const options = getConfiguredLocaleOptions(
    {
      'en-US': { translation: {} },
      'ja-JP': { translation: {} },
      'zh-CN': { translation: {} },
    },
    'en-US',
  )

  assert.deepEqual(
    options.map(({ code }) => code),
    ['en-US', 'ja-JP', 'zh-CN'],
  )
  assert.match(options.find(({ code }) => code === 'ja-JP')?.label || '', /Japanese|ja-JP/i)
})
