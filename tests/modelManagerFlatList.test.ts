import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const manager = readFileSync(path.resolve('src/views/ai/ModelManager.tsx'), 'utf8')

test('the model catalog renders every model as an equal flat list item', () => {
  assert.match(manager, /className="ai-model-list" role="list"/)
  assert.match(manager, /className="ai-model-card" key=\{model\.id\} role="listitem"/)
  assert.doesNotMatch(manager, /model\.children|parentModel|childModel/)
})
