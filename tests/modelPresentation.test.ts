import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const css = readFileSync(path.resolve('src/views/ai/AIChat.css'), 'utf8')
const modelManager = readFileSync(path.resolve('src/views/ai/ModelManager.tsx'), 'utf8')
const providerManager = readFileSync(path.resolve('src/views/ai/ProviderManager.tsx'), 'utf8')

test('provider model choices are one-level rows with readable text', () => {
  const optionsRule = css.match(/\.ai-provider-model-options\s*\{[\s\S]*?\n\}/)?.[0] ?? ''
  const labelRule = css.match(/\.ai-provider-model-options label\s*\{[\s\S]*?\n\}/)?.[0] ?? ''
  assert.match(optionsRule, /grid-template-columns:\s*minmax\(0, 1fr\)/)
  assert.doesNotMatch(optionsRule, /grid-auto-flow:\s*dense/)
  assert.match(labelRule, /color:\s*var\(--text-main\)/)
})

test('model catalog exposes categories without nesting model rows', () => {
  assert.match(modelManager, /categoryFilter/)
  assert.match(modelManager, /ai-model-card__category/)
  assert.doesNotMatch(modelManager, /parentModel|childModel|model\.children/)
  assert.match(providerManager, /requestBodyJson/)
})
