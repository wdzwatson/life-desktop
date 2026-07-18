import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const zh = JSON.parse(readFileSync(path.resolve('src/locales/zh-CN.json'), 'utf8'))
const en = JSON.parse(readFileSync(path.resolve('src/locales/en-US.json'), 'utf8'))

test('AI localization exists in Chinese and English with matching keys', () => {
  assert.equal(zh.sidebar.ai, 'AI 对话')
  assert.equal(en.sidebar.ai, 'AI Chat')
  assert.deepEqual(Object.keys(zh.aiChat).sort(), Object.keys(en.aiChat).sort())
  assert.deepEqual(Object.keys(zh.aiChat.chat).sort(), Object.keys(en.aiChat.chat).sort())
  assert.deepEqual(Object.keys(zh.aiChat.images).sort(), Object.keys(en.aiChat.images).sort())
  assert.deepEqual(Object.keys(zh.aiChat.videos).sort(), Object.keys(en.aiChat.videos).sort())
  assert.deepEqual(Object.keys(zh.aiChat.media).sort(), Object.keys(en.aiChat.media).sort())
  assert.deepEqual(Object.keys(zh.aiChat.storage).sort(), Object.keys(en.aiChat.storage).sort())
})

test('Toolbox and chat labels describe distinct actions and units', () => {
  assert.deepEqual(
    [zh.toolbox.tab_pomodoro, zh.toolbox.tab_converter, zh.toolbox.tab_vault],
    ['番茄计时器', '单位换算', '密码库'],
  )
  assert.deepEqual(
    [en.toolbox.tab_pomodoro, en.toolbox.tab_converter, en.toolbox.tab_vault],
    ['Pomodoro Timer', 'Unit Converter', 'Password Vault'],
  )
  assert.equal(zh.toolbox.btn_start_focus, '开始专注')
  assert.equal(en.toolbox.btn_start_focus, 'Start Focus')
  assert.deepEqual(
    [zh.toolbox.btn_5_min_break, zh.toolbox.btn_15_min_break],
    ['5 分钟休息', '15 分钟休息'],
  )
  assert.deepEqual(
    [en.toolbox.btn_5_min_break, en.toolbox.btn_15_min_break],
    ['5 Min Break', '15 Min Break'],
  )
  assert.deepEqual(
    [zh.toolbox.converter_tab_rate, zh.toolbox.converter_tab_length, zh.toolbox.converter_tab_weight],
    ['汇率换算', '长度换算', '重量换算'],
  )
  assert.deepEqual(
    [en.toolbox.converter_tab_rate, en.toolbox.converter_tab_length, en.toolbox.converter_tab_weight],
    ['Currency', 'Length', 'Weight'],
  )
  assert.equal(zh.aiChat.chat.role_assistant, 'AI 助手')
  assert.equal(en.aiChat.chat.role_assistant, 'Assistant')
})

test('AI video chat renders a visible processing state and controlled local playback card', () => {
  const workspace = readFileSync(path.resolve('src/views/ai/ChatWorkspace.tsx'), 'utf8')
  const chatUtils = readFileSync(path.resolve('src/views/ai/chatUtils.ts'), 'utf8')
  const renderer = readFileSync(path.resolve('src/views/ai/MessageRenderer.tsx'), 'utf8')
  const video = readFileSync(path.resolve('src/views/ai/VideoMessage.tsx'), 'utf8')
  assert.match(workspace, /createOptimisticMediaMessages/)
  assert.match(chatUtils, /type: 'media_task',[\s\S]*mediaType: input\.mediaType/)
  assert.match(renderer, /ai-message__media-task/)
  assert.match(video, /life-ai-asset:\/\/asset\/\$\{video\.assetId\}/)
  assert.match(video, /<video[^>]+controls[^>]+preload="metadata"/)
})

test('AI storage view is a dense settings surface with preview confirmation', () => {
  const shell = readFileSync(path.resolve('src/views/ai/AIChat.tsx'), 'utf8')
  const storage = readFileSync(path.resolve('src/views/ai/StorageManager.tsx'), 'utf8')
  const css = readFileSync(path.resolve('src/views/ai/AIChat.css'), 'utf8')
  assert.match(shell, /nav_storage/)
  assert.match(storage, /previewAIStorageCleanup/)
  assert.match(storage, /window\.confirm/)
  assert.match(storage, /className="ai-storage-summary-grid"/)
  assert.match(storage, /className="ai-storage-settings-grid"/)
  assert.match(storage, /className="ai-storage-impact-grid"/)
  assert.doesNotMatch(storage, /useGSAP|ScrollTrigger|gsap|ai-storage-hero|ai-storage-marquee/)
  assert.match(css, /\.ai-storage-summary-grid[\s\S]*grid-template-columns:\s*repeat\(4,[\s\S]*grid-auto-flow:\s*dense/)
  assert.match(css, /\.ai-storage-settings-grid[\s\S]*grid-template-columns:\s*minmax\(220px, 0\.72fr\) minmax\(0, 1\.28fr\)/)
  assert.match(css, /\.ai-storage-scope-grid[\s\S]*grid-auto-flow:\s*dense/)
  assert.doesNotMatch(storage, /SECTION 0|QUESTION 0/)
})

test('Toolbox retains only utility tabs while App lazy-loads AI as a first-level screen', () => {
  const toolbox = readFileSync(path.resolve('src/views/Toolbox.tsx'), 'utf8')
  const app = readFileSync(path.resolve('src/App.tsx'), 'utf8')
  assert.match(app, /lazy\(\(\) => import\('\.\/views\/ai\/AIChat'\)/)
  assert.doesNotMatch(toolbox, /toolTab === 'ai'|<AIChat/)
  for (const tab of ['pomodoro', 'converter', 'vault']) assert.match(toolbox, new RegExp(`toolTab === '${tab}'`))
})

test('AI workspace shell prevents page-level horizontal overflow', () => {
  const css = readFileSync(path.resolve('src/views/ai/AIChat.css'), 'utf8')
  assert.match(css, /\.ai-chat-shell[\s\S]*max-width:\s*100%/)
  assert.match(css, /\.ai-chat-shell[\s\S]*overflow:\s*hidden/)
  assert.match(css, /font-family:\s*'Cabinet Grotesk',\s*'Outfit'/)
  assert.match(css, /\.ai-chat-workspace[\s\S]*grid-auto-flow:\s*dense/)
})
