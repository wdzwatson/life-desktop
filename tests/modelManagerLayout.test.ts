import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const css = readFileSync(path.resolve('src/views/ai/AIChat.css'), 'utf8')
const manager = readFileSync(path.resolve('src/views/ai/ModelManager.tsx'), 'utf8')

test('the model catalog keeps its controls visible and scrolls long model lists', () => {
  assert.match(css, /\.ai-model-manager\s*\{[\s\S]*height:\s*100%[\s\S]*display:\s*flex[\s\S]*flex-direction:\s*column/)
  assert.match(css, /\.ai-model-list\s*\{[\s\S]*min-height:\s*0[\s\S]*flex:\s*1 1 auto[\s\S]*overflow-y:\s*auto[\s\S]*scrollbar-gutter:\s*stable/)
  assert.match(css, /@media \(max-width: 640px\)[\s\S]*\.ai-model-card\s*\{[\s\S]*grid-template-columns:\s*minmax\(0, 1fr\)/)
  assert.doesNotMatch(manager, /ai-model-hero|catalog_title|catalog_desc/)
  assert.match(manager, /ai-model-toolbar__add/)
})
