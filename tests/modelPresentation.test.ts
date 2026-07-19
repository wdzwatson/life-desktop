import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const css = readFileSync(path.resolve('src/views/ai/AIChat.css'), 'utf8')
const modelManager = readFileSync(path.resolve('src/views/ai/ModelManager.tsx'), 'utf8')
const providerManager = readFileSync(path.resolve('src/views/ai/ProviderManager.tsx'), 'utf8')

test('provider model choices are one flat list with readable text', () => {
  const optionsRule = css.match(/\.ai-provider-model-options\s*\{[\s\S]*?\n\}/)?.[0] ?? ''
  const labelRule = css.match(/\.ai-provider-model-options label\s*\{[\s\S]*?\n\}/)?.[0] ?? ''
  assert.match(optionsRule, /grid-template-columns:\s*minmax\(0, 1fr\)/)
  assert.doesNotMatch(optionsRule, /grid-auto-flow:\s*dense/)
  assert.match(labelRule, /color:\s*var\(--text-main\)/)
  assert.match(providerManager, /catalogModels\.map\(\(model\)/)
  assert.doesNotMatch(providerManager, /catalogModels\.filter\(\(model\) => model\.capabilities\.includes\(kind\)\)\.map/)
})

test('model catalog exposes categories without nesting model rows', () => {
  assert.match(modelManager, /categoryFilter/)
  assert.match(modelManager, /ai-model-card__category/)
  assert.doesNotMatch(modelManager, /parentModel|childModel|model\.children/)
  assert.match(providerManager, /requestBodyJson/)
})

test('model catalog rows use one stable visual state', () => {
  const cardRule = css.match(/\.ai-model-card\s*\{[\s\S]*?\n\}/)?.[0] ?? ''
  assert.match(cardRule, /opacity:\s*1/)
  assert.match(cardRule, /transform:\s*none/)
  assert.doesNotMatch(css, /\.ai-model-card\.is-disabled/)
})
