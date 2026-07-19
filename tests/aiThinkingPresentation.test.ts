import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const workspace = readFileSync(path.resolve('src/views/ai/ChatWorkspace.tsx'), 'utf8')

test('chat toolbar uses the first hard-coded level for model changes and restores valid saved selections', () => {
  assert.match(workspace, /getAIThinkingLevels\(activeModel\?\.textModel\)/)
  assert.match(workspace, /const nextThinkingLevel = getAIThinkingLevels\(nextModel\.textModel\)\[0\]/)
  assert.match(workspace, /getAIChatConversationSelection\(activeConversation\)/)
  assert.match(workspace, /persistConversationSelection\(activeConversationId, agentId, nextThinkingLevel\)/)
  assert.match(workspace, /handleThinkingChange/)
  assert.match(workspace, /ai-chat-stage__selector--thinking/)
  assert.match(workspace, /thinkingLevel,/)
})
