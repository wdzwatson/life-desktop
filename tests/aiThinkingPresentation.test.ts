import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const workspace = readFileSync(path.resolve('src/views/ai/ChatWorkspace.tsx'), 'utf8')

test('chat toolbar resets the thinking selector to the first hard-coded level for each model', () => {
  assert.match(workspace, /getAIThinkingLevels\(activeModel\?\.textModel\)/)
  assert.match(workspace, /setThinkingLevel\(thinkingLevels\[0\]\)/)
  assert.match(workspace, /ai-chat-stage__selector--thinking/)
  assert.match(workspace, /thinkingLevel,/)
})
