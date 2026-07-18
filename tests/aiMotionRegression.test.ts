import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'

const shell = readFileSync(path.resolve('src/views/ai/AIChat.tsx'), 'utf8')
const workspace = readFileSync(path.resolve('src/views/ai/ChatWorkspace.tsx'), 'utf8')
const css = readFileSync(path.resolve('src/views/ai/AIChat.css'), 'utf8')

test('daily chat setup avoids scroll-pinning and marketing motion', () => {
  assert.doesNotMatch(shell, /AIOnboarding|ScrollTrigger|gsap/)
  assert.doesNotMatch(workspace, /ScrollTrigger|gsap|marquee|stack__card/)
  assert.match(workspace, /ai-chat-setup-banner/)
})

test('progressive setup uses static status surfaces', () => {
  const setupRule = css.match(/\.ai-chat-setup-banner\s*\{([^}]*)\}/)?.[1] ?? ''
  assert.match(setupRule, /background:/)
  assert.doesNotMatch(setupRule, /animation:/)
})
