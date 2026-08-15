import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const css = readFileSync(path.resolve('src/views/ai/AIChat.css'), 'utf8')
const manager = readFileSync(path.resolve('src/views/ai/ModelManager.tsx'), 'utf8')
const providerManager = readFileSync(path.resolve('src/views/ai/ProviderManager.tsx'), 'utf8')

test('the model catalog keeps its controls visible and scrolls long model lists', () => {
  assert.match(css, /\.ai-model-manager\s*\{[\s\S]*height:\s*100%[\s\S]*display:\s*flex[\s\S]*flex-direction:\s*column/)
  assert.match(css, /\.ai-model-list\s*\{[\s\S]*min-height:\s*0[\s\S]*flex:\s*1 1 auto[\s\S]*overflow-y:\s*auto[\s\S]*scrollbar-gutter:\s*stable/)
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.ai-model-card\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/)
  assert.doesNotMatch(manager, /ai-model-hero|catalog_title|catalog_desc/)
  assert.match(manager, /ai-model-toolbar__add/)
})

test('provider rows show complete data and keep actions in a stable header toolbar', () => {
  assert.match(providerManager, /className="ai-provider-card__header"/)
  assert.match(providerManager, /className="ai-provider-card__actions" role="group"/)
  assert.match(providerManager, /className="ai-provider-url" title=\{provider\.baseUrl\}/)
  assert.match(providerManager, /<strong title=\{provider\.models\[kind\]\}>/)
  assert.match(css, /\.ai-provider-url\s*\{[^}]*overflow-wrap:\s*anywhere[^}]*word-break:\s*break-word/)
  assert.doesNotMatch(css, /\.ai-provider-url\s*\{[^}]*white-space:\s*nowrap/)
  assert.match(css, /\.ai-provider-card__actions\s*\{[\s\S]*grid-template-columns:\s*repeat\(4, 34px\)/)
  assert.match(css, /\.ai-provider-card\s*\{[^}]*flex:\s*0 0 auto[^}]*max-height:\s*none[^}]*overflow:\s*visible/)
  assert.doesNotMatch(css, /@container \(max-width: 590px\)[\s\S]*\.ai-provider-card__header\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/)
  assert.doesNotMatch(css, /\.ai-provider-toolbar \.dropdown\s*\{\s*display:\s*none/)
})
