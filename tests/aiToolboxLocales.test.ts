import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const zh = JSON.parse(readFileSync(path.resolve('src/locales/zh-CN.json'), 'utf8'))
const en = JSON.parse(readFileSync(path.resolve('src/locales/en-US.json'), 'utf8'))

test('AI toolbox localization exists in Chinese and English with matching keys', () => {
  assert.equal(zh.toolbox.tab_ai, 'AI 对话')
  assert.equal(en.toolbox.tab_ai, 'AI Chat')
  assert.deepEqual(Object.keys(zh.aiChat).sort(), Object.keys(en.aiChat).sort())
})

test('Toolbox lazy-loads the isolated AI workspace without replacing existing tools', () => {
  const toolbox = readFileSync(path.resolve('src/views/Toolbox.tsx'), 'utf8')
  assert.match(toolbox, /lazy\(\(\) => import\('\.\/ai\/AIChat'\)/)
  assert.match(toolbox, /toolTab === 'ai'/)
  for (const tab of ['pomodoro', 'converter', 'vault']) assert.match(toolbox, new RegExp(`toolTab === '${tab}'`))
})

test('AI workspace shell prevents page-level horizontal overflow', () => {
  const css = readFileSync(path.resolve('src/views/ai/AIChat.css'), 'utf8')
  assert.match(css, /\.ai-chat-shell[\s\S]*max-width:\s*100%/)
  assert.match(css, /\.ai-chat-shell[\s\S]*overflow:\s*hidden/)
  assert.match(css, /font-family:\s*'Outfit'/)
})
