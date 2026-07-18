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
  assert.deepEqual(Object.keys(zh.aiChat.chat).sort(), Object.keys(en.aiChat.chat).sort())
  assert.deepEqual(Object.keys(zh.aiChat.images).sort(), Object.keys(en.aiChat.images).sort())
  assert.deepEqual(Object.keys(zh.aiChat.videos).sort(), Object.keys(en.aiChat.videos).sort())
  assert.deepEqual(Object.keys(zh.aiChat.storage).sort(), Object.keys(en.aiChat.storage).sort())
})

test('AI video chat renders a visible processing state and controlled local playback card', () => {
  const workspace = readFileSync(path.resolve('src/views/ai/ChatWorkspace.tsx'), 'utf8')
  const renderer = readFileSync(path.resolve('src/views/ai/MessageRenderer.tsx'), 'utf8')
  const video = readFileSync(path.resolve('src/views/ai/VideoMessage.tsx'), 'utf8')
  assert.match(workspace, /type: 'media_task', mediaType: 'video'/)
  assert.match(renderer, /ai-message__media-task/)
  assert.match(video, /life-ai-asset:\/\/asset\/\$\{video\.assetId\}/)
  assert.match(video, /<video[^>]+controls[^>]+preload="metadata"/)
})

test('AI storage view keeps dense capacity layout, preview confirmation, and reduced-motion support', () => {
  const shell = readFileSync(path.resolve('src/views/ai/AIChat.tsx'), 'utf8')
  const storage = readFileSync(path.resolve('src/views/ai/StorageManager.tsx'), 'utf8')
  const css = readFileSync(path.resolve('src/views/ai/AIChat.css'), 'utf8')
  assert.match(shell, /nav_storage/)
  assert.match(storage, /previewAIStorageCleanup/)
  assert.match(storage, /window\.confirm/)
  assert.match(storage, /ScrollTrigger\.create/)
  assert.match(css, /\.ai-storage-hero h2[\s\S]*max-width:\s*64rem/)
  assert.match(css, /\.ai-storage-bento[\s\S]*grid-template-columns:\s*repeat\(6,[\s\S]*grid-auto-flow:\s*dense/)
  assert.match(css, /prefers-reduced-motion:[\s\S]*\.ai-storage-marquee > div[\s\S]*animation:\s*none/)
  assert.doesNotMatch(storage, /SECTION 0|QUESTION 0/)
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
  assert.match(css, /font-family:\s*'Cabinet Grotesk',\s*'Outfit'/)
  assert.match(css, /\.ai-chat-workspace[\s\S]*grid-auto-flow:\s*dense/)
})
