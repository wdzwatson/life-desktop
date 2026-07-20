import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const conversationList = readFileSync(path.resolve('src/views/ai/ConversationList.tsx'), 'utf8')
const css = readFileSync(path.resolve('src/views/ai/AIChat.css'), 'utf8')

test('conversation create button keeps a stable icon target on narrow layouts', () => {
  assert.match(conversationList, /className="ai-conversation-new__label"[\s\S]*new_conversation/)
  assert.match(css, /\.ai-conversation-new\s*\{[\s\S]*min-width:\s*0/)
  assert.match(css, /@media \(max-width:\s*960px\)[\s\S]*\.ai-conversation-new\s*\{[\s\S]*width:\s*34px[\s\S]*height:\s*34px/)
  assert.match(css, /@media \(max-width:\s*960px\)[\s\S]*\.ai-conversation-new__label\s*\{[\s\S]*display:\s*none/)
  assert.doesNotMatch(css, /\.ai-conversation-new\s*\{[\s\S]*color:\s*transparent/)
})
