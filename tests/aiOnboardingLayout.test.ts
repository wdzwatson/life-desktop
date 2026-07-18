import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const shell = readFileSync(path.resolve('src/views/ai/AIChat.tsx'), 'utf8')
const workspace = readFileSync(path.resolve('src/views/ai/ChatWorkspace.tsx'), 'utf8')
const css = readFileSync(path.resolve('src/views/ai/AIChat.css'), 'utf8')
const appCss = readFileSync(path.resolve('src/index.css'), 'utf8')
const toolbox = readFileSync(path.resolve('src/views/Toolbox.tsx'), 'utf8')
const app = readFileSync(path.resolve('src/App.tsx'), 'utf8')
const sidebar = readFileSync(path.resolve('src/components/Sidebar.tsx'), 'utf8')

test('AI always renders the conversation workspace instead of a marketing onboarding page', () => {
  assert.doesNotMatch(shell, /AIOnboarding/)
  assert.doesNotMatch(css, /ai-onboarding/)
  assert.match(shell, /mode === 'chat'[\s\S]*<ChatWorkspace[\s\S]*hasProvider=\{hasProvider\}/)
  assert.match(workspace, /className="ai-chat-setup-banner"/)
  assert.match(workspace, /disabled=\{submitting \|\| !chatReady\}/)
})

test('progressive setup keeps the conversation canvas responsive without page overflow', () => {
  assert.match(css, /\.ai-chat-shell\s*\{[\s\S]*height:\s*100%[\s\S]*min-height:\s*0/)
  assert.match(css, /\.ai-chat-stage\.has-setup[\s\S]*grid-template-rows:\s*auto auto minmax\(0, 1fr\) auto auto/)
  assert.match(css, /\.ai-chat-setup-banner[\s\S]*grid-template-columns:\s*auto minmax\(0, 1fr\) auto/)
  assert.match(css, /@media \(max-width:\s*960px\)/)
  assert.match(css, /@media \(max-width:\s*640px\)/)
})

test('AI is a first-level screen that owns the available pane height', () => {
  assert.match(app, /const AIChat = lazy\(\(\) => import\('\.\/views\/ai\/AIChat'\)/)
  assert.match(app, /case 'ai':[\s\S]*<AIChatBoundary>[\s\S]*<AIChat \/>/)
  assert.match(sidebar, /activeScreen === 'ai'[\s\S]*handleNavClick\('ai'\)[\s\S]*sidebar\.ai/)
  assert.doesNotMatch(toolbox, /toolTab === 'ai'|<AIChat/)
  assert.match(appCss, /\.content-pane:has\(\.ai-chat-shell\)[\s\S]*overflow:\s*hidden/)
  assert.match(appCss, /\.screen-transition:has\(> \.ai-chat-shell\)[\s\S]*height:\s*100%[\s\S]*min-height:\s*0/)
})

test('saving the first provider returns progressive setup to the chat workspace', () => {
  assert.match(shell, /setupTransitionRef\.current = true/)
  assert.match(shell, /providers\.data\?\.length[\s\S]*setupTransitionRef\.current[\s\S]*setMode\('chat'\)/)
  assert.match(shell, /onOpenProviders=\{\(\) => \{[\s\S]*openSettings\('providers'\)/)
})

test('chat and configuration use separate workspace modes', () => {
  assert.match(shell, /type AIMode = 'chat' \| 'settings'/)
  assert.match(shell, /className="ai-settings-back"[\s\S]*setMode\('chat'\)/)
  assert.match(shell, /className="ai-settings-shell"[\s\S]*className="ai-settings-nav"[\s\S]*className="ai-settings-content"/)
  assert.match(css, /\.ai-chat-shell[\s\S]*grid-template-rows:\s*auto minmax\(0, 1fr\)/)
  assert.match(css, /\.ai-settings-shell[\s\S]*grid-template-columns:\s*190px minmax\(0, 1fr\)/)
})
