import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const component = readFileSync(path.resolve('src/views/ai/AIOnboarding.tsx'), 'utf8')
const shell = readFileSync(path.resolve('src/views/ai/AIChat.tsx'), 'utf8')
const css = readFileSync(path.resolve('src/views/ai/AIChat.css'), 'utf8')
const appCss = readFileSync(path.resolve('src/index.css'), 'utf8')
const toolbox = readFileSync(path.resolve('src/views/Toolbox.tsx'), 'utf8')

test('AI onboarding uses a wide cinematic heading and the approved AIDA structure', () => {
  assert.match(component, /ai-onboarding-hero/)
  assert.match(component, /ai-onboarding-interest/)
  assert.match(component, /ai-onboarding-desire/)
  assert.match(component, /ai-onboarding-action/)
  assert.match(css, /\.ai-onboarding-hero h2[\s\S]*max-width:\s*72rem[\s\S]*font-size:\s*clamp\(42px, 5vw, 84px\)/)
  assert.doesNotMatch(component, /SECTION 0|QUESTION 0|ABOUT US/)
})

test('AI onboarding bento fills all twelve cells with dense flow', () => {
  assert.match(css, /\.ai-onboarding-bento\s*\{[\s\S]*grid-template-columns:\s*repeat\(6,[\s\S]*grid-template-rows:\s*repeat\(2,[\s\S]*grid-auto-flow:\s*dense/)
  assert.match(css, /\.ai-onboarding-bento__card\.is-architecture\s*\{[\s\S]*grid-column:\s*span 3[\s\S]*grid-row:\s*span 2/)
  assert.match(css, /\.ai-onboarding-bento__card\.is-boundary\s*\{[\s\S]*grid-column:\s*span 3[\s\S]*grid-row:\s*span 1/)
  assert.match(css, /\.ai-onboarding-bento__card\.is-provider,[\s\S]*\.is-agent,[\s\S]*\.is-mcp\s*\{[\s\S]*grid-column:\s*span 1[\s\S]*grid-row:\s*span 1/)
})

test('onboarding responds at 1180, 960, and 800 without page overflow', () => {
  assert.match(css, /\.ai-chat-shell\s*\{[\s\S]*height:\s*100%[\s\S]*min-height:\s*0/)
  assert.match(css, /\.ai-onboarding\s*\{[\s\S]*max-width:\s*100%[\s\S]*overflow-x:\s*hidden/)
  assert.match(css, /@media \(max-width:\s*1180px\)/)
  assert.match(css, /@media \(max-width:\s*960px\)/)
  assert.match(css, /@media \(max-width:\s*800px\)/)
})

test('AI toolbox mode owns the available pane height without an outer page scroll', () => {
  assert.match(toolbox, /className=\{`toolbox-view \$\{toolTab === 'ai' \? 'is-ai' : ''\}`\}/)
  assert.match(toolbox, /toolbox-view__header/)
  assert.match(toolbox, /toolbox-view__body/)
  assert.match(appCss, /\.content-pane:has\(\.toolbox-view\.is-ai\)[\s\S]*overflow:\s*hidden/)
  assert.match(appCss, /\.screen-transition:has\(> \.toolbox-view\)[\s\S]*height:\s*100%[\s\S]*min-height:\s*0/)
})

test('saving the first provider exits onboarding into the daily chat workspace', () => {
  assert.match(shell, /onboardingTransitionRef\.current = true/)
  assert.match(shell, /providers\.data\?\.length[\s\S]*onboardingTransitionRef\.current[\s\S]*setActiveView\('chat'\)/)
  assert.match(shell, /activeView === 'chat' && !hasProvider[\s\S]*<AIOnboarding/)
  assert.match(shell, /activeView === 'chat' && hasProvider[\s\S]*<ChatWorkspace/)
})
